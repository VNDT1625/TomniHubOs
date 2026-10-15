/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TerminalSession } from '@/process/ideTerminal/terminalTypes';
import type { LiveSession } from '@/common/liveSessions/model';
import type { LiveSessionRegistry } from './liveSessionRegistry';

/** Output within this window counts as the terminal doing something. */
const WORKING_WINDOW_MS = 3_000;

type TerminalSource = {
  list: () => TerminalSession[];
  onSessionsChanged: (listener: (sessions: TerminalSession[]) => void) => () => void;
  onData: (listener: (event: { id: string }) => void) => () => void;
};

/**
 * Reports the running terminal sessions under the "terminal" app. A session is `working` while output keeps
 * arriving and `idle` otherwise; exited sessions are not alive and are left out. Agent shell commands are
 * not terminal sessions, so they never appear here.
 */
export const attachTerminalLiveSessions = (
  registry: LiveSessionRegistry,
  terminals: TerminalSource,
  now: () => number = Date.now
): (() => void) => {
  const lastData = new Map<string, number>();
  let recheck: ReturnType<typeof setTimeout> | undefined;

  const sync = (): void => {
    try {
      const at = now();
      const sessions: LiveSession[] = terminals
        .list()
        .filter((session) => session.status === 'running')
        .map((session) => {
          const last = lastData.get(session.id);
          return {
            id: session.id,
            title: session.title,
            status: last !== undefined && at - last <= WORKING_WINDOW_MS ? 'working' : 'idle',
            lastActiveAt: last ?? session.createdAt,
            ...(session.scheduled ? { detail: 'theo lịch' } : {}),
          };
        });
      for (const id of lastData.keys()) {
        if (!sessions.some((session) => session.id === id)) lastData.delete(id);
      }
      registry.report('terminal', sessions);
    } catch {
      // A terminal source that cannot be read leaves the previous report in place.
    }
  };

  const stopSessions = terminals.onSessionsChanged(() => sync());
  const stopData = terminals.onData((event) => {
    lastData.set(event.id, now());
    sync();
    if (recheck) clearTimeout(recheck);
    recheck = setTimeout(sync, WORKING_WINDOW_MS + 1);
    recheck.unref?.();
  });
  sync();

  return () => {
    stopSessions();
    stopData();
    if (recheck) clearTimeout(recheck);
    registry.clear('terminal');
  };
};
