/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  managerCoreClient,
  type ManagerCoreDoctorReport,
  type ManagerCoreLoadStatus,
  type ManagerCoreRun,
  type ManagerCoreScheduledTask,
  type ManagerCoreSession,
  type ManagerCoreTarget,
} from './managerCoreClient';

export type ManagerCoreSnapshot = {
  status: ManagerCoreLoadStatus;
  doctor: ManagerCoreDoctorReport | null;
  targets: ManagerCoreTarget[];
  sessions: ManagerCoreSession[];
  activeRuns: ManagerCoreRun[];
  scheduledTasks: ManagerCoreScheduledTask[];
  lastUpdatedAt: number | null;
  error: string | null;
};

export type UseManagerCore = ManagerCoreSnapshot & {
  refresh: () => Promise<void>;
  cancelRun: (requestId: string) => Promise<boolean>;
  runScheduledTask: (id: string) => Promise<boolean>;
  cancelScheduledTask: (id: string) => Promise<boolean>;
};

const initialSnapshot: ManagerCoreSnapshot = {
  status: 'loading',
  doctor: null,
  targets: [],
  sessions: [],
  activeRuns: [],
  scheduledTasks: [],
  lastUpdatedAt: null,
  error: null,
};

const firstFailureMessage = (results: PromiseSettledResult<unknown>[]): string | null => {
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (!failed) return null;
  return failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
};

/** Live projection of the new Tomny Core for the Manager control centre. */
export function useManagerCore(): UseManagerCore {
  const [snapshot, setSnapshot] = useState<ManagerCoreSnapshot>(initialSnapshot);
  const aliveRef = useRef(true);
  const refreshingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    const results = await Promise.allSettled([
      managerCoreClient.doctor(),
      managerCoreClient.listTargets(),
      managerCoreClient.listSessions(),
      managerCoreClient.listActiveRuns(),
      managerCoreClient.listScheduledTasks(),
    ]);

    refreshingRef.current = false;
    if (!aliveRef.current) return;

    const [doctor, targets, sessions, activeRuns, scheduledTasks] = results;
    const successCount = results.filter((result) => result.status === 'fulfilled').length;

    setSnapshot((current) => ({
      status: successCount > 0 ? 'ready' : 'unavailable',
      doctor: doctor.status === 'fulfilled' ? doctor.value : current.doctor,
      targets: targets.status === 'fulfilled' ? targets.value : current.targets,
      sessions: sessions.status === 'fulfilled' ? sessions.value : current.sessions,
      activeRuns: activeRuns.status === 'fulfilled' ? activeRuns.value : current.activeRuns,
      scheduledTasks: scheduledTasks.status === 'fulfilled' ? scheduledTasks.value : current.scheduledTasks,
      lastUpdatedAt: successCount > 0 ? Date.now() : current.lastUpdatedAt,
      error: successCount === results.length ? null : firstFailureMessage(results),
    }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const off = managerCoreClient.onEvent((event) => {
      if (!['started', 'completed', 'error', 'cancelled'].includes(event.type)) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout((): void => {
        void refresh();
      }, 350);
    });
    return () => {
      window.clearTimeout(refreshTimer);
      off();
    };
  }, [refresh]);

  const cancelRun = useCallback(
    async (requestId: string): Promise<boolean> => {
      try {
        const cancelled = await managerCoreClient.cancelRun(requestId);
        await refresh();
        return cancelled;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  const runScheduledTask = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await managerCoreClient.runScheduledTask(id);
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  const cancelScheduledTask = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const cancelled = await managerCoreClient.cancelScheduledTask(id);
        await refresh();
        return cancelled;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  return { ...snapshot, refresh, cancelRun, runScheduledTask, cancelScheduledTask };
}
