/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildMonitorReport,
  describeMonitorReport,
  MONITOR_PROCESS_MAX,
  MONITOR_STALE_AFTER_MS,
  MONITOR_WINDOW_MAX,
} from '@process/system/monitorReport/systemMonitorReport';
import type { SystemSnapshot } from '@process/system/systemInfoTypes';

const NOW = 1_000_000;

const snapshot = (
  overrides: Partial<SystemSnapshot['live']> = {},
  monitor?: SystemSnapshot['monitor']
): SystemSnapshot => ({
  static: {
    probedAt: 1,
    os: {
      platform: 'win32',
      type: 'Windows_NT',
      release: '10',
      version: '',
      arch: 'x64',
      hostname: 'box',
      username: 'u',
    },
    cpu: { model: 'CPU', logicalCores: 2, speedMHz: 3000 },
    totalMemoryMB: 16000,
    gpus: [],
    disks: [{ mount: 'C:\\', totalMB: 1000, freeMB: 50 }],
    network: [],
    versions: { app: '1', electron: '1', chrome: '1', node: '1', v8: '1' },
  },
  live: {
    sampledAt: NOW - 1000,
    cpu: { overallPercent: 40, perCorePercent: [96.04, 12] },
    memory: { totalMB: 16000, usedMB: 8000, freeMB: 8000, usedPercent: 50 },
    loadAvg: [0, 0, 0],
    uptimeSec: 5,
    processes: Array.from({ length: 30 }, (_, index) => ({
      pid: index,
      type: 'Tab',
      name: `p${index}`,
      cpuPercent: 1,
      memoryMB: 1,
      priority: 0,
    })),
    power: { onBattery: false },
    ...overrides,
  },
  history: Array.from({ length: 10 }, (_, index) => ({ t: NOW - (10 - index) * 2000, cpu: index * 10, mem: 50 })),
  monitor,
});

describe('buildMonitorReport', () => {
  it('reports fresh data with per-core CPU, trend and clamped process list', () => {
    const report = buildMonitorReport(snapshot(), { now: NOW, topProcesses: 999, windowSamples: 5 });
    expect(report.stale).toBe(false);
    expect(report.ageMs).toBe(1000);
    expect(report.cpu.perCorePercent).toEqual([96, 12]);
    expect(report.cpu.hottestCorePercent).toBe(96);
    expect(report.tomniProcesses).toHaveLength(MONITOR_PROCESS_MAX);
    expect(report.trend.windowSamples).toBe(5);
    expect(report.trend.cpu?.direction).toBe('rising');
    expect(report.trend.memory?.direction).toBe('steady');
    expect(report.trend).not.toHaveProperty('samples');
  });

  it('flags stale data, saturated core and low disk', () => {
    const report = buildMonitorReport(snapshot({ sampledAt: NOW - MONITOR_STALE_AFTER_MS - 1 }), { now: NOW });
    expect(report.stale).toBe(true);
    expect(report.alerts.join(' ')).toMatch(/old/);
    expect(report.alerts.join(' ')).toMatch(/core is saturated/);
    expect(report.alerts.join(' ')).toMatch(/free space/);
    expect(describeMonitorReport(report)).toContain('STALE');
  });

  it('clamps the window, honours includePerCore/includeSamples and tolerates bad numbers', () => {
    const report = buildMonitorReport(snapshot(), {
      now: NOW,
      windowSamples: MONITOR_WINDOW_MAX * 10,
      includePerCore: false,
      includeSamples: true,
      topProcesses: Number.NaN,
    });
    expect(report.cpu).not.toHaveProperty('perCorePercent');
    expect(report.trend.windowSamples).toBe(10);
    expect(report.trend.samples).toHaveLength(10);
    expect(report.tomniProcesses).toHaveLength(8);
  });

  it('explains missing host telemetry and exposes only aggregates when present', () => {
    const closed = buildMonitorReport(snapshot({}, { viewerActive: false, telemetry: null }), { now: NOW });
    expect(closed.hostTelemetry).toMatchObject({ available: false });
    expect(JSON.stringify(closed.hostTelemetry)).toMatch(/System Monitor tab/);

    const open = buildMonitorReport(
      snapshot(
        {},
        {
          viewerActive: true,
          telemetry: {
            sampledAt: NOW - 3000,
            disk: { readBytesPerSec: 10, writeBytesPerSec: 20 },
            network: null,
            gpuEnginePeakPercent: 33,
            osProcessCount: 274,
            processLimitReached: false,
          },
        }
      ),
      { now: NOW }
    );
    expect(open.hostTelemetry).toMatchObject({
      available: true,
      ageMs: 3000,
      disk: { readBytesPerSec: 10, writeBytesPerSec: 20 },
      network: null,
      gpuEnginePeakPercent: 33,
      osProcessCount: 274,
    });
    expect(open.viewerActive).toBe(true);
  });
});
