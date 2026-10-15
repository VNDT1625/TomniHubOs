/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { liveSessionsChannels } from '@/common/types/agent/liveSessions';
import type { LiveSessionRegistry } from './liveSessionRegistry';

let registered = false;

/** Apps the host reports itself; a renderer report can never overwrite them. */
const HOST_REPORTED_APP_IDS = new Set(['chat', 'terminal', 'com.tomni.browser']);

/**
 * Exposes the registry to the desktop renderer, read-only. Sender trust is
 * enforced in the main adapter allowlist; a signed-out account sees nothing.
 */
export const registerLiveSessionsBridge = (
  registry: LiveSessionRegistry,
  requireAuthenticatedAccount?: () => void
): void => {
  if (registered) return;
  registered = true;
  const allowed = (): boolean => {
    try {
      requireAuthenticatedAccount?.();
      return true;
    } catch {
      return false;
    }
  };
  liveSessionsChannels.snapshot.provider(async () =>
    allowed() ? registry.snapshot() : { generatedAt: Date.now(), apps: [] }
  );
  liveSessionsChannels.report.provider(async (input) => {
    if (!allowed() || !input || typeof input !== 'object') return false;
    const { appId, sessions, actions } = input as { appId?: unknown; sessions?: unknown; actions?: unknown };
    if (typeof appId !== 'string' || HOST_REPORTED_APP_IDS.has(appId)) return false;
    return registry.report(appId, sessions, actions);
  });
  registry.subscribe((snapshot) => liveSessionsChannels.changed.emit(snapshot));
};
