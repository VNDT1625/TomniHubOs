/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contract of the `web-embed` apps (docs/platform/repotopackage-design.md sections 10.9 and 14 S13).
 *
 * The renderer names an app by `packageId` + `connectionId` and nothing else: no URL, no partition, no path. Main
 * finds the connection, checks it is enabled with an approval that still matches, and decides the address, the
 * session and the origins the tab may stay on. This file holds the parts that are pure data and shared by Main and
 * the renderer; it has no Node or DOM dependency.
 */

import { z } from 'zod';
import {
  isLoopbackWebUrl,
  loopbackAllowed,
  type AdapterConnection,
  type LoopbackPolicy,
} from '@/common/packages/adapter';
import type { PackageTrust } from '@/common/packages/types';

/** Invoke channel of the Browser bridge that opens an app by id. */
export const WEB_EMBED_OPEN_APP_CHANNEL = 'browser.open-app';

const ID = /^[a-z0-9][a-z0-9._-]*$/u;

/** `.strict()` on purpose: a request that carries `partition`, `url` or anything else unknown is refused whole. */
export const openAppRequestSchema = z
  .object({
    packageId: z.string().min(1).max(128).regex(ID),
    connectionId: z.string().min(1).max(64).regex(ID),
  })
  .strict();

export type OpenAppRequest = z.infer<typeof openAppRequestSchema>;

/** Stable codes; the renderer branches on these and shows its own translated text. */
export type WebEmbedErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_ENABLED'
  | 'NEEDS_APPROVAL'
  | 'NEEDS_INPUT'
  | 'RUNTIME_MISSING'
  | 'PORT_IN_USE'
  | 'LIMIT_REACHED'
  | 'START_FAILED'
  | 'UNAVAILABLE';

export type OpenAppResult =
  | { ok: true; tabId: string }
  /** `detail` is a short, secret-free sentence from the process runtime (for example the port owner). */
  | { ok: false; error: WebEmbedErrorCode; detail?: string };

export class WebEmbedError extends Error {
  readonly code: WebEmbedErrorCode;
  constructor(code: WebEmbedErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'WebEmbedError';
    this.code = code;
  }
}

/** The key under which a renderer lists an app; `web-embed:` keeps it apart from package-module ids. */
export const webEmbedAppId = (packageId: string, connectionId: string): string =>
  `web-embed:${packageId}:${connectionId}`;

export type WebEmbedConnection = Extract<AdapterConnection, { kind?: 'web-embed' }>;
export type WebEmbedService = NonNullable<WebEmbedConnection['process']>['services'][number];

/** Loopback address a process app is opened on. */
export const WEB_EMBED_LOOPBACK_HOST = '127.0.0.1';

/** The origin of an https address only; a declared origin is never plain http. */
const httpsOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const httpOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

/** True when the address carries a user name or password; such an address is never opened. */
export const hasCredentials = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.username !== '' || url.password !== '';
  } catch {
    return false;
  }
};

/** The policy of one package, read from its host context. A missing trust tier or flag counts as "not allowed". */
export const loopbackPolicyOf = (context: {
  trust?: PackageTrust;
  declaresLocalService?: boolean;
}): LoopbackPolicy => ({
  ...(context.trust === undefined ? {} : { trust: context.trust }),
  declaresLocalService: context.declaresLocalService === true,
});

/**
 * Why a `url` app may not be opened under this policy, or `undefined` when it may. Checked by the host when the
 * connection is turned on and again when the app is opened. Only https, or loopback http under the package policy.
 */
export const webEmbedUrlProblem = (url: string, policy: LoopbackPolicy): string | undefined => {
  if (hasCredentials(url)) return 'The app address must not contain a user name or password.';
  if (isLoopbackWebUrl(url)) {
    return loopbackAllowed(policy)
      ? undefined
      : 'A loopback address needs a local-built package or a local service declared in the same package.';
  }
  if (url.startsWith('http:')) return 'Only https, or http on 127.0.0.1 or localhost with a port, can be opened.';
  return httpsOrigin(url) === undefined ? 'The app address must be https.' : undefined;
};

/**
 * Origins a tab of this app may stay on. A `url` app: the origin of the page plus the declared `origins`. A process
 * app: only the loopback ports of the package's own services (declared `origins` are ignored: the page is the
 * package's own and nothing else may be navigated to inside the app tab).
 */
export const webEmbedAllowedOrigins = (connection: WebEmbedConnection): readonly string[] => {
  const origins = new Set<string>();
  if (connection.process !== undefined) {
    for (const service of connection.process.services) {
      origins.add(`http://${WEB_EMBED_LOOPBACK_HOST}:${service.ready.port}`);
      origins.add(`http://localhost:${service.ready.port}`);
    }
    return [...origins];
  }
  const first = connection.url === undefined ? undefined : httpOrigin(connection.url);
  if (first !== undefined) origins.add(first);
  for (const declared of connection.origins ?? []) {
    const origin = httpsOrigin(declared);
    if (origin !== undefined) origins.add(origin);
  }
  return [...origins];
};

/** The address the tab first loads, or `undefined` when the connection cannot be opened. */
export const webEmbedStartUrl = (connection: WebEmbedConnection): string | undefined => {
  if (connection.process === undefined) return connection.url;
  const embedded = connection.process.services.find((service) => service.id === connection.process?.embed.service);
  if (embedded === undefined) return undefined;
  return `http://${WEB_EMBED_LOOPBACK_HOST}:${embedded.ready.port}${connection.process.embed.path ?? '/'}`;
};
