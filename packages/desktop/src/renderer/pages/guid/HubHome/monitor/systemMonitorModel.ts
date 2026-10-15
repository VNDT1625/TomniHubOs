/**
 * Compact, read-only projection of System Insight samples for the Hub rail.
 * The process sampler reports Tomni/Electron processes, NOT the entire OS table.
 */
import type { ProcessMetric, OsProcessMetric } from '@process/system/systemInfoTypes';
import type { HubActivityItem } from '@/common/types/agent/hubActivity';

export type MonitorProcessSort = 'cpu' | 'memory' | 'name';

const finite = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);
export const monitorPercent = (value: number): number => Math.min(100, finite(value));
export const monitorMemory = (megabytes: number): string => {
  const value = finite(megabytes);
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`;
};

export const monitorRate = (bytesPerSec: number | null): string => {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '—';
  if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
};

export const monitorProcesses = <T extends ProcessMetric | OsProcessMetric>(
  processes: readonly T[],
  query: string,
  sort: MonitorProcessSort,
  limit = 24
): T[] => {
  const needle = query.trim().toLocaleLowerCase();
  return processes
    .filter(
      (process) =>
        !needle ||
        process.name.toLocaleLowerCase().includes(needle) ||
        ('type' in process && typeof process.type === 'string' && process.type.toLocaleLowerCase().includes(needle)) ||
        String(process.pid).includes(needle)
    )
    .toSorted((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name) || a.pid - b.pid;
      const score =
        sort === 'memory' ? (b.memoryMB ?? -1) - (a.memoryMB ?? -1) : (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
      return score || (b.memoryMB ?? -1) - (a.memoryMB ?? -1) || a.pid - b.pid;
    })
    .slice(0, Math.max(0, limit));
};

export const monitorActiveTasks = (items: readonly HubActivityItem[]): HubActivityItem[] =>
  items
    .filter((item) => item.status === 'running' || item.status === 'needs_input')
    .toSorted(
      (a, b) => Number(b.status === 'needs_input') - Number(a.status === 'needs_input') || b.updatedAt - a.updatedAt
    );