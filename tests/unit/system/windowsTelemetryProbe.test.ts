import { describe, expect, it, vi } from 'vitest';
import {
  parseWindowsTelemetry,
  probeWindowsTelemetry,
  WINDOWS_SAMPLE_SCRIPT,
} from '@process/system/windowsTelemetryProbe';
import {
  createSystemInfoService,
  HOST_TELEMETRY_INTERVAL_MS,
  type SystemInfoServiceDeps,
} from '@process/system/systemInfoService';
import type { HostTelemetry, LiveSystemMetrics, StaticSystemInfo } from '@process/system/systemInfoTypes';

const payload = {
  processes: [
    { pid: 100, name: 'Code', cpuPercent: 22.2, memoryMB: 400 },
    { pid: 101, name: 'System', cpuPercent: 0, memoryMB: 16 },
    { pid: -1, name: 'invalid', cpuPercent: -8, memoryMB: 2 },
  ],
  disk: { readBytesPerSec: 2048, writeBytesPerSec: 1024 },
  network: { receiveBytesPerSec: 4096, sendBytesPerSec: 512 },
  gpuEnginePeakPercent: 38,
};

const telemetry = (sampledAt = Date.now()): HostTelemetry => {
  const result = parseWindowsTelemetry(payload, sampledAt);
  if (!result) throw new Error('Fixture parse failed');
  return result;
};

describe('Windows OS-wide telemetry probe', () => {
  it('recognizes bounded OS processes and independent I/O counters', () => {
    expect(parseWindowsTelemetry(payload, 1234)).toMatchObject({
      sampledAt: 1234,
      processes: [
        { pid: 100, name: 'Code' },
        { pid: 101, name: 'System' },
      ],
      disk: { readBytesPerSec: 2048, writeBytesPerSec: 1024 },
      network: { receiveBytesPerSec: 4096, sendBytesPerSec: 512 },
      gpuEnginePeakPercent: 38,
    });
  });

  it('preserves unavailable fields as null rather than inventing zero', () => {
    expect(
      parseWindowsTelemetry(
        {
          processes: null,
          disk: null,
          network: null,
          gpuEnginePeakPercent: null,
        },
        100
      )
    ).toMatchObject({
      processes: null,
      disk: null,
      network: null,
      gpuEnginePeakPercent: null,
    });
    expect(parseWindowsTelemetry(null, 1)).toBeNull();
    expect(
      parseWindowsTelemetry({ processes: [{ pid: 1, name: 'x', memoryMB: -1, cpuPercent: '8' }] }, 1)?.processes?.[0]
    ).toMatchObject({ memoryMB: null, cpuPercent: null });
  });

  it('caps and validates the OS inventory before IPC', () => {
    const many = Array.from({ length: 1100 }, (_, i) => ({
      pid: i + 1,
      name: 'A'.repeat(220),
      cpuPercent: 1,
      memoryMB: 1,
    }));
    const result = parseWindowsTelemetry({ processes: many }, 1);
    expect(result?.processes).toHaveLength(1024);
    expect(result?.processLimitReached).toBe(true);
    expect(result?.processes?.[0]?.name).toHaveLength(180);
  });

  it('runs only on Windows with a fixed, non-interactive command and handles errors', async () => {
    const executor = vi.fn(async (script: string) => {
      expect(script).toBe(WINDOWS_SAMPLE_SCRIPT);
      expect(script).not.toContain('Invoke-Expression');
      return JSON.stringify(payload);
    });
    expect(await probeWindowsTelemetry(executor, 'linux')).toBeNull();
    expect(executor).not.toHaveBeenCalled();
    expect((await probeWindowsTelemetry(executor, 'win32'))?.processes?.length).toBe(2);
    expect(
      await probeWindowsTelemetry(async () => {
        throw new Error('Denied');
      }, 'win32')
    ).toBeNull();
    expect(await probeWindowsTelemetry(async () => '{ bad json', 'win32')).toBeNull();
  });
});

const staticInfo = (): StaticSystemInfo => ({
  probedAt: 1,
  os: { platform: 'win32', type: 'Windows', release: '', version: '', arch: 'x64', hostname: '', username: '' },
  cpu: { model: 'CPU', logicalCores: 1, speedMHz: 0 },
  totalMemoryMB: 8000,
  gpus: [],
  disks: [],
  network: [],
  versions: { app: '', electron: '', chrome: '', node: '', v8: '' },
});

const liveSample = (): LiveSystemMetrics => ({
  sampledAt: Date.now(),
  cpu: { overallPercent: 3, perCorePercent: [3] },
  memory: { totalMB: 8000, usedMB: 4000, freeMB: 4000, usedPercent: 50 },
  loadAvg: [0, 0, 0],
  uptimeSec: 1,
  processes: [],
  power: { onBattery: false },
});

describe('SystemInfoService OS telemetry privacy and cadence', () => {
  it('streams the optional OS inventory but never persists or returns it in agent snapshots', async () => {
    let timer: (() => void) | undefined;
    let resolveProbe: ((sample: HostTelemetry | null) => void) | undefined;
    const probe = vi.fn(
      () =>
        new Promise<HostTelemetry | null>((resolve) => {
          resolveProbe = resolve;
        })
    );
    const writes: Array<ReturnType<ReturnType<typeof createSystemInfoService>['getSnapshot']>> = [];
    const deps: SystemInfoServiceDeps = {
      dataDir: '/tmp',
      probeStatic: async () => staticInfo(),
      sampler: { sample: liveSample },
      snapshotStore: {
        write: (snapshot) => {
          writes.push(snapshot);
        },
      },
      priorityManager: {
        reapply: () => undefined,
        getChoice: () => undefined,
        setPriority: (pid, level) => ({ ok: true, pid, level }),
      },
      setInterval: (fn) => {
        timer = fn;
        return 1 as unknown as NodeJS.Timeout;
      },
      clearInterval: () => undefined,
      probeHostTelemetry: probe,
    };
    const service = createSystemInfoService(deps);
    await service.start();
    expect(probe).not.toHaveBeenCalled();
    const received: LiveSystemMetrics[] = [];
    service.onMetrics((sample) => {
      received.push(sample);
    });
    service.startStream();
    expect(probe).toHaveBeenCalledTimes(1);
    timer?.();
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe?.(telemetry());
    await vi.waitFor(() =>
      expect(received.some((sample) => sample.hostTelemetry?.source === 'windows-cim')).toBe(true)
    );
    expect(service.getSnapshot()?.live).not.toHaveProperty('hostTelemetry');
    expect(writes.every((snapshot) => !snapshot?.live.hostTelemetry)).toBe(true);
    service.stop();
  });

  it('does not launch repeated overlapping OS probes', async () => {
    expect(HOST_TELEMETRY_INTERVAL_MS).toBeGreaterThanOrEqual(8000);
  });
});