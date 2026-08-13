import { freemem, totalmem } from 'node:os';

export type SystemPressureLevel = 'healthy' | 'constrained' | 'critical';

export type HostPressureSample = {
  cpuUsagePercent: number;
  freeMemoryMB: number;
  totalMemoryMB: number;
  memoryPressurePercent: number;
  level: SystemPressureLevel;
  reasonCode: string;
  timestamp: number;
};

export class PressureSampler {
  private lastSample: HostPressureSample | null = null;

  public sampleHostPressure(cpuUsagePercent = 0): HostPressureSample {
    const totalBytes = totalmem();
    const freeBytes = freemem();
    const totalMB = Math.round(totalBytes / (1024 * 1024));
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    const usedBytes = totalBytes - freeBytes;
    const memoryPressurePercent = Math.round((usedBytes / totalBytes) * 100);

    let level: SystemPressureLevel = 'healthy';
    let reasonCode = 'RESOURCE_HEALTHY';

    if (memoryPressurePercent > 90 || cpuUsagePercent > 90 || freeMB < 512) {
      level = 'critical';
      reasonCode = 'RESOURCE_CRITICAL_PRESSURE';
    } else if (memoryPressurePercent > 75 || cpuUsagePercent > 70 || freeMB < 1024) {
      level = 'constrained';
      reasonCode = 'RESOURCE_CONSTRAINED_PRESSURE';
    }

    const sample: HostPressureSample = {
      cpuUsagePercent,
      freeMemoryMB: freeMB,
      totalMemoryMB: totalMB,
      memoryPressurePercent,
      level,
      reasonCode,
      timestamp: Date.now(),
    };

    this.lastSample = sample;
    return sample;
  }

  public getEffectiveConcurrencyLimit(baseLimit: number): number {
    const sample = this.lastSample ?? this.sampleHostPressure();
    if (sample.level === 'critical') {
      return Math.max(1, Math.floor(baseLimit * 0.3));
    }
    if (sample.level === 'constrained') {
      return Math.max(1, Math.floor(baseLimit * 0.6));
    }
    return baseLimit;
  }
}
