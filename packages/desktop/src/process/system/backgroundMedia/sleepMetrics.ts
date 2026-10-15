import type { BackgroundSleepMetrics, SleepResourceReading } from '@/common/types/platform/backgroundSleep';

/**
 * Compares Electron working-set snapshots at close-to-tray and after settling.
 * Values are process working-set sums, NOT de-duplicated physical RAM; native
 * sidecars and independent Browser processes are not included.
 */
export type SleepMetricsMonitor = {
  onSleep: () => void;
  onWake: () => void;
  snapshot: () => BackgroundSleepMetrics;
  dispose: () => void;
};

type SleepTimer = ReturnType<typeof setTimeout> | number;

export type SleepMetricsDeps = Readonly<{
  readProcesses: () => ReadonlyArray<Readonly<{ workingSetKB: number; cpuPercent: number }>>;
  now?: () => number;
    setTimer?: (callback: () => void, ms: number) => SleepTimer;
  clearTimer?: (timer: SleepTimer) => void;
  settleMs?: number;
}>;

export const createSleepMetricsMonitor = (deps: SleepMetricsDeps): SleepMetricsMonitor => {
  const now = deps.now ?? Date.now;
      const startTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const stopTimer = deps.clearTimer ?? clearTimeout;
  const settleMs = deps.settleMs ?? 3_000;
  let before: SleepResourceReading | null = null;
  let after: SleepResourceReading | null = null;
  let mode: BackgroundSleepMetrics['mode'] = 'awake';
    let timer: SleepTimer | undefined;

  const sample = (): SleepResourceReading => {
    const processes = deps.readProcesses();
    return {
      sampledAt: now(),
      workingSetMB: Math.round(processes.reduce((sum, p) => sum + Math.max(0, p.workingSetKB), 0) / 1024),
      cpuPercent: Math.round(processes.reduce((sum, p) => sum + Math.max(0, p.cpuPercent), 0) * 10) / 10,
      processCount: processes.length,
    };
  };
  const clear = (): void => {
    if (timer !== undefined) stopTimer(timer);
    timer = undefined;
  };

  return {
    onSleep: () => {
      if (mode === 'sleeping') return;
      clear();
      mode = 'sleeping';
      before = sample();
      after = null;
      timer = startTimer(() => {
        timer = undefined;
        if (mode === 'sleeping') after = sample();
      }, settleMs);
            if (typeof timer !== 'number') timer.unref?.();
    },
    onWake: () => {
      clear();
      mode = 'awake';
    },
    snapshot: () => {
      const current = sample();
      const delta = before && after ? before.workingSetMB - after.workingSetMB : null;
      return {
        mode,
        before,
        after,
        current,
        savedWorkingSetMB: delta,
        savedWorkingSetPercent: delta !== null && before && before.workingSetMB > 0
          ? Math.round((delta / before.workingSetMB) * 1_000) / 10
          : null,
        sampling: mode === 'sleeping' && after === null,
      };
    },
    dispose: clear,
  };
};
