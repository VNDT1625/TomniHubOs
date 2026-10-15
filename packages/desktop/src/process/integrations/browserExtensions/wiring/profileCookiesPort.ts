/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real {@link CookiesPort}: the cookie jar of the Browser profile session and nothing else
 * (docs/platform/repotopackage-design.md sections 12.1 and 15.2). The Hub window's default session holds the person's
 * own logins and is never reachable from here: the factory refuses to build over the default session, so a wiring
 * mistake fails at startup instead of exposing it.
 */

import type {
  CookieChange,
  CookieFilter,
  CookieSetDetails,
  CookiesPort,
  PortCookie,
  SameSite,
} from '@process/integrations/browserExtensions/api/groups/data/cookies';

type ElectronCookie = Readonly<{
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: string;
}>;

/** The part of a `Session` this wiring uses. */
export type CookieJarSession = Readonly<{
  cookies: Readonly<{
    get: (filter: CookieFilter) => Promise<readonly ElectronCookie[]>;
    set: (details: CookieSetDetails) => Promise<void>;
    remove: (url: string, name: string) => Promise<void>;
    on: (
      event: 'changed',
      listener: (event: unknown, cookie: ElectronCookie, cause: string, removed: boolean) => void
    ) => unknown;
    removeListener: (
      event: 'changed',
      listener: (event: unknown, cookie: ElectronCookie, cause: string, removed: boolean) => void
    ) => unknown;
  }>;
}>;

const SAME_SITE: ReadonlySet<string> = new Set(['unspecified', 'no_restriction', 'lax', 'strict']);

const toPortCookie = (cookie: ElectronCookie): PortCookie => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain ?? '',
  hostOnly: cookie.hostOnly === true,
  path: cookie.path ?? '/',
  secure: cookie.secure === true,
  httpOnly: cookie.httpOnly === true,
  session: cookie.session === true || cookie.expirationDate === undefined,
  sameSite: (SAME_SITE.has(cookie.sameSite ?? '') ? cookie.sameSite : 'unspecified') as SameSite,
  ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
});

/**
 * @throws when `profile` is the default session. Both are passed in so the check is a plain identity comparison that
 * a test can exercise without Electron.
 */
export const createProfileCookiesPort = (profile: CookieJarSession, defaultSession: unknown): CookiesPort => {
  if ((profile as unknown) === defaultSession) {
    throw new Error('The cookies API must use the Browser profile session, never the default session.');
  }
  return {
    get: async (filter) => (await profile.cookies.get(filter)).map(toPortCookie),
    set: (details) => profile.cookies.set(details),
    remove: (url, name) => profile.cookies.remove(url, name),
    subscribe: (listener: (change: CookieChange) => void) => {
      const handler = (_event: unknown, cookie: ElectronCookie, cause: string, removed: boolean): void => {
        listener({ cookie: toPortCookie(cookie), cause, removed });
      };
      profile.cookies.on('changed', handler);
      return () => {
        profile.cookies.removeListener('changed', handler);
      };
    },
  };
};
