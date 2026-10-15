/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Who is calling (docs/platform/repotopackage-design.md sections 12.3 and 15.2): the extension id comes from the
 * origin of the sender and from nothing else.
 *
 * - A service worker is identified by `event.serviceWorker.scope`, which for an extension is exactly
 *   `chrome-extension://<id>/`.
 * - A page is identified by `event.senderFrame.url`, which is `chrome-extension://<id>/<path>`.
 *
 * Anything that is not a well-formed extension origin (another scheme, user info or a port, an uppercase or
 * wrong-length id, an unexpected scope path) resolves to nothing, and the router refuses the call. Whether the id
 * belongs to an extension the host loaded is checked separately by the router against the grant registry.
 */

import { EXTENSION_ID_PATTERN } from '@process/integrations/browserExtensions/api/contract';
import type { CallerKind } from '@process/integrations/browserExtensions/api/types';

/** What Main can see of the sender, taken from the Electron event and never from the payload. */
export type CallerSource =
  | Readonly<{ kind: 'service-worker'; scope: string }>
  | Readonly<{ kind: 'frame'; url: string }>;

export type ResolvedCaller = Readonly<{ extensionId: string; kind: CallerKind }>;

const MAX_URL_LENGTH = 2048;

const parseExtensionUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string' || value === '' || value.length > MAX_URL_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'chrome-extension:') return undefined;
  if (url.username !== '' || url.password !== '' || url.port !== '') return undefined;
  return EXTENSION_ID_PATTERN.test(url.hostname) ? url : undefined;
};

/** The extension id of a service worker scope, or undefined when the scope is not an extension's root. */
export const extensionIdFromScope = (scope: unknown): string | undefined => {
  const url = parseExtensionUrl(scope);
  if (url === undefined || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  return url.hostname;
};

/** The extension id of a page URL, or undefined when the URL is not an extension page. */
export const extensionIdFromPageUrl = (value: unknown): string | undefined => parseExtensionUrl(value)?.hostname;

export const resolveCaller = (source: CallerSource): ResolvedCaller | undefined => {
  const extensionId =
    source.kind === 'service-worker' ? extensionIdFromScope(source.scope) : extensionIdFromPageUrl(source.url);
  return extensionId === undefined ? undefined : { extensionId, kind: source.kind };
};
