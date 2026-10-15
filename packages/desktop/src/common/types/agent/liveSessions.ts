/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';
import type { LiveSessionsSnapshot } from '@/common/liveSessions/model';

/** Read-only view of the sessions every app keeps alive, for the sidebar "Active" section. */
export const liveSessionsChannels = {
  snapshot: bridge.buildProvider<LiveSessionsSnapshot, void>('live-sessions.snapshot'),
  /** A trusted desktop app reports the sessions it keeps alive; false when the report was not applied. */
  report: bridge.buildProvider<boolean, { appId: string; sessions: unknown; actions?: unknown }>('live-sessions.report'),
  changed: bridge.buildEmitter<LiveSessionsSnapshot>('live-sessions.changed'),
};
