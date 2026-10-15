import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HubSystemMonitor } from '@/renderer/pages/guid/HubHome/monitor/HubSystemMonitor';
import {
  monitorActiveTasks,
  monitorMemory,
  monitorPercent,
  monitorProcesses,
} from '@/renderer/pages/guid/HubHome/monitor/systemMonitorModel';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import type { ProcessMetric } from '@process/system/systemInfoTypes';

const metrics = vi.hoisted(() => ({ useSystemMetrics: vi.fn() }));
vi.mock('@/renderer/pages/settings/ResourceSettings/system/useSystemMetrics', () => metrics);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const processes: ProcessMetric[] = [
  { pid: 11, type: 'GPU', name: 'Gpu Worker', cpuPercent: 4, memoryMB: 2048, priority: null },
  { pid: 12, type: 'Browser', name: 'Tomni', cpuPercent: 23, memoryMB: 300, priority: null },
];

const activities: HubActivityItem[] = [
  {
    id: 'agent:one',
    kind: 'agent',
    sourceId: 'one',
    title: 'Coding Agent',
    status: 'running',
    startedAt: 1000,
    updatedAt: 1010,
    steps: [],
    canStop: false,
    route: '/conversation/one',
  },
  {
    id: 'schedule:two',
    kind: 'schedule',
    sourceId: 'two',
    title: 'Finished schedule',
    status: 'done',
    startedAt: 900,
    updatedAt: 1000,
    steps: [],
    canStop: false,
  },
];

const readyMetrics = () => ({
  status: 'ready',
  live: {
    sampledAt: Date.now(),
    cpu: { overallPercent: 37, perCorePercent: [23, 51, 44] },
    memory: { totalMB: 16384, usedMB: 8192, freeMB: 8192, usedPercent: 50 },
    loadAvg: [1, 1, 1],
    uptimeSec: 7200,
    processes,
    power: { onBattery: false },
    hostTelemetry: {
      source: 'windows-cim' as const,
      sampledAt: Date.now(),
      processes: [{ pid: 341, name: 'Other App', cpuPercent: 9.5, memoryMB: 650 }],
      processLimitReached: false,
      gpuEnginePeakPercent: 41,
      disk: { readBytesPerSec: 1048576, writeBytesPerSec: 524288 },
      network: { receiveBytesPerSec: 2048, sendBytesPerSec: 1024 },
    },
  },
  staticInfo: {
    probedAt: 1,
    cpu: { model: 'Test CPU', logicalCores: 3, speedMHz: 3400 },
    os: {
      platform: 'win32',
      type: 'Windows_NT',
      release: '11',
      version: 'Windows 11',
      arch: 'x64',
      hostname: 'hidden',
      username: 'hidden',
    },
    totalMemoryMB: 16384,
    gpus: [{ vendor: 'Test', model: 'Test GPU', driverVersion: '1', active: true }],
    disks: [{ mount: 'C:', totalMB: 100000, freeMB: 30000 }],
    network: [{ name: 'Ethernet', addresses: [], mac: '' }],
    versions: { app: '1', electron: '1', chrome: '1', node: '1', v8: '1' },
  },
  history: [
    { t: 1, cpu: 35, mem: 49 },
    { t: 2, cpu: 37, mem: 50 },
  ],
  refreshStatic: vi.fn().mockResolvedValue(undefined),
  setProcessPriority: vi.fn(),
});

beforeEach(() => {
  metrics.useSystemMetrics.mockReturnValue(readyMetrics());
});
afterEach(cleanup);

describe('System Monitor model', () => {
  it('sorts by CPU or RAM, searches by PID and caps rendered processes', () => {
    expect(monitorProcesses(processes, '', 'cpu')[0]?.pid).toBe(12);
    expect(monitorProcesses(processes, '', 'memory')[0]?.pid).toBe(11);
    expect(monitorProcesses(processes, '12', 'name')).toHaveLength(1);
    expect(monitorProcesses(processes, '', 'cpu', 1)).toHaveLength(1);
  });

  it('does not present completed runs as active or invent invalid metrics', () => {
    expect(monitorActiveTasks(activities).map((item) => item.id)).toEqual(['agent:one']);
    expect(monitorPercent(Number.NaN)).toBe(0);
    expect(monitorPercent(119)).toBe(100);
    expect(monitorMemory(2048)).toBe('2.0 GB');
  });
});

describe('System Monitor right rail content', () => {
  it('renders host CPU/RAM and honestly scopes app processes; filters by search', () => {
    render(<HubSystemMonitor activities={activities} />);
    expect(screen.getByTestId('hub-system-monitor')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '37');
    expect(screen.getByRole('progressbar', { name: 'RAM' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('Test GPU')).toBeInTheDocument();
    expect(within(screen.getByTestId('hub-system-active-tasks')).getByText('Coding Agent')).toBeInTheDocument();
    expect(screen.queryByText('Finished schedule')).toBeNull();
    const listing = within(screen.getByTestId('hub-system-processes'));
    expect(listing.getByText('Other App')).toBeInTheDocument();
    expect(listing.getByText(/Danh sách tiến trình toàn Windows/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('hub-system-throughput')).getByText('41%')).toBeInTheDocument();
    expect(within(screen.getByTestId('hub-system-throughput')).getByText(/1\.0 MB\/s/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: /Tên hoặc PID/i }), { target: { value: '341' } });
    expect(listing.getByText('Other App')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: /Tên hoặc PID/i }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Nguồn tiến trình/i }), { target: { value: 'tomni' } });
    expect(listing.queryByText('Other App')).toBeNull();
    expect(listing.getByTitle('Tomni · PID 12')).toBeInTheDocument();
    expect(listing.getByText('Gpu Worker')).toBeInTheDocument();
  });

  it('does not show invented GPU/disk/network values when OS counters are absent', () => {
    const noHost = readyMetrics();
    delete (noHost.live as Partial<typeof noHost.live>).hostTelemetry;
    metrics.useSystemMetrics.mockReturnValue(noHost);
    render(<HubSystemMonitor activities={[]} />);
    expect(screen.getByText('Không khả dụng')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('hub-system-processes')).getByText(/Đang lấy dữ liệu Windows/i)
    ).toBeInTheDocument();
  });

  it('shows a truthful error state when the sampler cannot be reached', () => {
    metrics.useSystemMetrics.mockReturnValue({
      status: 'error',
      live: null,
      staticInfo: null,
      history: [],
      refreshStatic: vi.fn(),
      setProcessPriority: vi.fn(),
    });
    render(<HubSystemMonitor activities={[]} />);
    expect(screen.getByText('Không tải được số liệu hệ thống.')).toBeInTheDocument();
    expect(screen.getByText('Không có tác vụ đang hoạt động.')).toBeInTheDocument();
  });
});