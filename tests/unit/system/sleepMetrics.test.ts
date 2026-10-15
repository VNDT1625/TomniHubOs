import { describe, expect, it, vi } from 'vitest';
import { createSleepMetricsMonitor } from '@process/system/backgroundMedia/sleepMetrics';

describe('background sleep process metrics', () => {
  it('records before and settled after readings with an honest negative saving', () => {
    vi.useFakeTimers();
    try {
      let kb = 1024 * 500;
      const monitor = createSleepMetricsMonitor({
        readProcesses: () => [{ workingSetKB: kb, cpuPercent: 3 }, { workingSetKB: 0, cpuPercent: 0 }],
        settleMs: 500,
      });
      monitor.onSleep();
      expect(monitor.snapshot()).toMatchObject({ mode: 'sleeping', sampling: true, savedWorkingSetMB: null });
      kb = 1024 * 550;
      vi.advanceTimersByTime(500);
      expect(monitor.snapshot()).toMatchObject({
        sampling: false, savedWorkingSetMB: -50, savedWorkingSetPercent: -10,
        before: { workingSetMB: 500 }, after: { workingSetMB: 550 },
      });
      monitor.onWake();
      expect(monitor.snapshot().mode).toBe('awake');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels collection when the Hub reopens before settling', () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const monitor = createSleepMetricsMonitor({
        readProcesses: () => { calls++; return [{ workingSetKB: 1024, cpuPercent: 0 }]; },
        settleMs: 1_000,
      });
      monitor.onSleep();
      monitor.onWake();
      vi.advanceTimersByTime(2_000);
      expect(monitor.snapshot().after).toBeNull();
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
