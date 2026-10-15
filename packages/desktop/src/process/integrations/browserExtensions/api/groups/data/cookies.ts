/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.cookies` (docs/platform/repotopackage-design.md sections 12.3 and 15.1): `get`, `getAll`, `set`, `remove`
 * and `onChanged`, over the cookies of the Browser profile session only.
 *
 * - The port is built on the Browser profile session by the wiring, which refuses the default session; this file has
 *   no way to name a session.
 * - Every call needs the `cookies` permission, and every cookie it reads, writes, removes or reports needs a host
 *   permission (required or granted later) that covers the cookie's URL: `https` when the cookie is secure, `http`
 *   otherwise, as Chrome does. A cookie outside the host permissions is absent.
 * - `set` with a `domain` needs the host permission for that domain too, and the domain must contain the URL's host,
 *   so an extension cannot plant a cookie on a site it has no access to.
 * - Calls are written to the audit log by name and outcome; cookie names and values never reach the log.
 * - Only the default cookie store (`"0"`) exists: there is no incognito store.
 */

import { z } from 'zod';
import { urlCoveredBy } from '@process/integrations/browserExtensions/api/matchPattern';
import { broadcast } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import type { ExtensionGrants } from '@process/integrations/browserExtensions/api/grants';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type SameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict';

export type PortCookie = Readonly<{
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  session: boolean;
  sameSite: SameSite;
  expirationDate?: number;
}>;

export type CookieFilter = Readonly<{
  url?: string;
  name?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  session?: boolean;
}>;

export type CookieSetDetails = Readonly<{
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: SameSite;
  expirationDate?: number;
}>;

export type CookieChange = Readonly<{
  cookie: PortCookie;
  removed: boolean;
  /** Electron's cause: `explicit`, `overwrite`, `expired`, `evicted` or `expired-overwrite`. */
  cause: string;
}>;

/** The cookie jar of the Browser profile session. */
export type CookiesPort = Readonly<{
  get: (filter: CookieFilter) => Promise<readonly PortCookie[]>;
  set: (details: CookieSetDetails) => Promise<void>;
  remove: (url: string, name: string) => Promise<void>;
  subscribe: (listener: (change: CookieChange) => void) => () => void;
}>;

const COOKIES = ['cookies'] as const;
const MAX_RESULTS = 1000;
const MAX_COOKIE_BYTES = 4096;
const DEFAULT_STORE = '0';

const hasControl = (value: string, forbidden = ''): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || forbidden.includes(char);
  });

const storeId = z.literal(DEFAULT_STORE).optional();
const urlText = z.string().min(1).max(2048);
const cookieName = z
  .string()
  .max(1024)
  // Names and values that carry separators or control characters are how cookie injection works.
  .refine((value) => !hasControl(value, ';=') && !/\s/.test(value));
const cookieValue = z
  .string()
  .max(MAX_COOKIE_BYTES)
  .refine((value) => !hasControl(value, ';'));
const domainText = z
  .string()
  .max(255)
  .regex(/^\.?[a-z0-9.-]+$/i);
const pathText = z
  .string()
  .max(1024)
  .startsWith('/')
  .refine((value) => !hasControl(value, ';'));
const sameSite = z.enum(['unspecified', 'no_restriction', 'lax', 'strict']);

const getSchema = z.object({ url: urlText, name: cookieName, storeId }).strict();
const getAllSchema = z
  .object({
    url: urlText.optional(),
    name: cookieName.optional(),
    domain: domainText.optional(),
    path: pathText.optional(),
    secure: z.boolean().optional(),
    session: z.boolean().optional(),
    storeId,
  })
  .strict();
const setSchema = z
  .object({
    url: urlText,
    name: cookieName.optional(),
    value: cookieValue.optional(),
    domain: domainText.optional(),
    path: pathText.optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    sameSite: sameSite.optional(),
    expirationDate: z.number().finite().positive().optional(),
    storeId,
  })
  .strict();

const hostOfUrl = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/** The URL Chrome checks the host permission against for a cookie. */
const cookieUrl = (cookie: Readonly<{ domain: string; path: string; secure: boolean }>): string | undefined => {
  const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  if (host === '' || !cookie.path.startsWith('/')) return undefined;
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`;
};

const hostAllowed = (grants: ExtensionGrants, url: string | undefined): boolean =>
  url !== undefined && urlCoveredBy(grants.granted().origins, url);

const domainContains = (domain: string, host: string): boolean => {
  const bare = (domain.startsWith('.') ? domain.slice(1) : domain).toLowerCase();
  return host === bare || host.endsWith(`.${bare}`);
};

const toChromeCookie = (cookie: PortCookie): Record<string, unknown> => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain,
  hostOnly: cookie.hostOnly,
  path: cookie.path,
  secure: cookie.secure,
  httpOnly: cookie.httpOnly,
  sameSite: cookie.sameSite,
  session: cookie.session,
  storeId: DEFAULT_STORE,
  ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
});

const CAUSES: Readonly<Record<string, string>> = {
  explicit: 'explicit',
  overwrite: 'overwrite',
  expired: 'expired',
  evicted: 'evicted',
  'expired-overwrite': 'expired_overwrite',
};

export const createCookiesApi = (context: GroupContext, port: CookiesPort | undefined): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;

  const need = (): CookiesPort => {
    if (port === undefined)
      throw new ApiError('UNSUPPORTED', 'chrome.cookies is not available: the Browser is not wired.');
    return port;
  };
  const requireUrl = (grants: ExtensionGrants, url: string): void => {
    if (hostOfUrl(url) === undefined) throw new ApiError('INVALID_ARGUMENTS', 'The URL is not a web address.');
    if (!hostAllowed(grants, url)) {
      throw new ApiError('PERMISSION_DENIED', `The extension has no host permission for ${new URL(url).origin}.`);
    }
  };

  const methods = [
    defineApiMethod({
      name: 'cookies.get',
      callers: both,
      requires: COOKIES,
      audit: true,
      args: z.tuple([getSchema]),
      handle: async (call, [details]) => {
        const jar = need();
        requireUrl(call.grants, details.url);
        const found = await jar.get({ url: details.url, name: details.name });
        // The longest path wins, as in Chrome.
        const best = [...found].toSorted((a, b) => b.path.length - a.path.length)[0];
        return best === undefined ? null : toChromeCookie(best);
      },
    }),
    defineApiMethod({
      name: 'cookies.getAll',
      callers: both,
      requires: COOKIES,
      audit: true,
      args: z.tuple([getAllSchema]),
      handle: async (call, [details]) => {
        const jar = need();
        if (details.url !== undefined) requireUrl(call.grants, details.url);
        const found = await jar.get({
          ...(details.url === undefined ? {} : { url: details.url }),
          ...(details.name === undefined ? {} : { name: details.name }),
          ...(details.domain === undefined ? {} : { domain: details.domain }),
          ...(details.path === undefined ? {} : { path: details.path }),
          ...(details.secure === undefined ? {} : { secure: details.secure }),
          ...(details.session === undefined ? {} : { session: details.session }),
        });
        return found
          .filter((cookie) => details.url !== undefined || hostAllowed(call.grants, cookieUrl(cookie)))
          .slice(0, MAX_RESULTS)
          .map(toChromeCookie);
      },
    }),
    defineApiMethod({
      name: 'cookies.set',
      callers: both,
      requires: COOKIES,
      audit: true,
      args: z.tuple([setSchema]),
      handle: async (call, [details]) => {
        const jar = need();
        requireUrl(call.grants, details.url);
        const host = hostOfUrl(details.url) as string;
        if (details.domain !== undefined) {
          if (!domainContains(details.domain, host)) {
            throw new ApiError('INVALID_ARGUMENTS', 'The domain does not contain the host of the URL.');
          }
          const secure = details.secure ?? details.url.startsWith('https:');
          const forDomain = cookieUrl({ domain: details.domain, path: details.path ?? '/', secure });
          if (!hostAllowed(call.grants, forDomain)) {
            throw new ApiError('PERMISSION_DENIED', 'The extension has no host permission for that domain.');
          }
        }
        if ((details.name ?? '').length + (details.value ?? '').length > MAX_COOKIE_BYTES) {
          throw new ApiError('INVALID_ARGUMENTS', 'The cookie is too large.');
        }
        await jar.set({
          url: details.url,
          name: details.name ?? '',
          value: details.value ?? '',
          ...(details.domain === undefined ? {} : { domain: details.domain }),
          ...(details.path === undefined ? {} : { path: details.path }),
          ...(details.secure === undefined ? {} : { secure: details.secure }),
          ...(details.httpOnly === undefined ? {} : { httpOnly: details.httpOnly }),
          ...(details.sameSite === undefined ? {} : { sameSite: details.sameSite }),
          ...(details.expirationDate === undefined ? {} : { expirationDate: details.expirationDate }),
        });
        const stored = await jar.get({ url: details.url, name: details.name ?? '' });
        const best = [...stored].toSorted((a, b) => b.path.length - a.path.length)[0];
        return best === undefined ? null : toChromeCookie(best);
      },
    }),
    defineApiMethod({
      name: 'cookies.remove',
      callers: both,
      requires: COOKIES,
      audit: true,
      args: z.tuple([getSchema]),
      handle: async (call, [details]) => {
        const jar = need();
        requireUrl(call.grants, details.url);
        await jar.remove(details.url, details.name);
        return { url: details.url, name: details.name, storeId: DEFAULT_STORE };
      },
    }),
  ];

  const unsubscribe = port?.subscribe((change) => {
    const url = cookieUrl(change.cookie);
    if (url === undefined) return;
    broadcast(
      context,
      'cookies.onChanged',
      [
        {
          removed: change.removed,
          cookie: toChromeCookie(change.cookie),
          cause: CAUSES[change.cause] ?? 'explicit',
        },
      ],
      (grants) => grants.hasPermission('cookies') && hostAllowed(grants, url)
    );
  });

  return { methods, ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }) };
};
