/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-safe client for opening a `web-embed` app. It sends the package and connection ids and nothing else; Main
 * decides the address, the session and where the tab may navigate (docs/platform/repotopackage-design.md 10.9).
 */

import { bridge } from '@office-ai/platform';
import { WEB_EMBED_OPEN_APP_CHANNEL, type OpenAppRequest, type OpenAppResult } from './webEmbed';

/** Starting a local app can include a one-time dependency install, so the wait is long. */
export const WEB_EMBED_OPEN_TIMEOUT_MS = 15 * 60_000;

const openAppChannel = bridge.buildProvider<OpenAppResult, OpenAppRequest>(WEB_EMBED_OPEN_APP_CHANNEL);

export const webEmbedClient = {
  /** Resolves with the new (or existing) tab id, or a stable error code. Never rejects for an app-level failure. */
  openApp: (request: OpenAppRequest): Promise<OpenAppResult> =>
    new Promise<OpenAppResult>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'UNAVAILABLE' }), WEB_EMBED_OPEN_TIMEOUT_MS);
      openAppChannel.invoke({ packageId: request.packageId, connectionId: request.connectionId }).then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        () => {
          clearTimeout(timer);
          resolve({ ok: false, error: 'UNAVAILABLE' });
        }
      );
    }),
};
