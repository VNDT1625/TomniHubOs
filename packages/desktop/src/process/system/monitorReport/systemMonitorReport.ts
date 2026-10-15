/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure projection of a persisted {@link SystemSnapshot} into the Agent-facing
 * `system_monitor` report: the same measurements the System Monitor rail tab
 * shows (per-core CPU, RAM, disk/network throughput, GPU engine peak, trend),
 * plus freshness and threshold alerts so an agent can decide whether the data
 * is trustworthy and whether the host is under pressure.
 *
 * Privacy: OS-wide process names never reach this module — the sampler strips
 * them before the snapshot is persisted. Only Tomni-owned processes are listed.
 *
 * Process boundary: no Electron, no DOM — safe for the standalone stdio server.
 */

import type { MetricSample, MonitorTelemetrySummary, SystemSnapshot } from '../systemInfoTypes';

/** Default number of history samples summarised in the trend block. */
export const MONITOR_WINDOW_DEFAULT = 30;
/** Upper bound matching the service's rolling history buffer. */
export const MONITOR_WINDOW_MAX = 120;
/** Default and maximum number of Tomni processes listed. */
export const MONITOR_PROCESS_DEFAULT = 8;
export const MONITOR_PROCESS_MAX = 20;
/** A snapshot older than this no longer describes "right now". */
export const MONITOR_STALE_AFTER_MS = 20_000;

const CPU_HIGH_PERCENT = 85;
const MEMORY_HIGH_PERCENT = 90;
const CORE_SATURATED_PERCENT = 95;
const DISK_LOW_FREE_PERCENT = 10;
/** Change of at least this many points across the window counts as a trend. */
const TREND_DELTA_POINTS = 5;

export type MonitorReportOptions = {
  /** Wall-clock time used to compute data age (Unix ms). */
  now: number;
  /** History samples to summarise (clamped to 1–{@link MONITOR_WINDOW_MAX}). */
  windowSamples?: number;
  /** Include the per-logical-core CPU array (default true). */
  includePerCore?: boolean;
  /** Include the raw time-series samples of the window (default false). */
  includeSamples?: boolean;
  /** Tomni processes to list (clamped to 0–{@link MONITOR_PROCESS_MAX}). */
  topProcesses?: number;
};

type SeriesTrend = {
  latest: number;
  min: number;
  max: number;
  avg: number;
  /** Latest minus oldest value of the window, in percentage points. */
  delta: number;
  direction: 'rising' | 'falling' | 'steady';
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const summarizeSeries = (values: number[]): SeriesTrend | null => {
  if (values.length === 0) return null;
  const latest = values[values.length - 1];
  const delta = latest - values[0];
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    latest: round1(latest),
    min: round1(Math.min(...values)),
    max: round1(Math.max(...values)),
    avg: round1(sum / values.length),
    delta: round1(delta),
    direction: delta >= TREND_DELTA_POINTS ? 'rising' : delta <= -TREND_DELTA_POINTS ? 'falling' : 'steady',
  };
};

const describeTelemetry = (
  telemetry: MonitorTelemetrySummary | null | undefined,
  viewerActive: boolean,
  now: number
) => {
  if (!telemetry) {
    return {
      available: false,
      reason: viewerActive
        ? 'Windows telemetry is not available yet (first probe pending) or this platform does not provide it.'
        : 'Disk/network/GPU counters are only sampled while the System Monitor tab is open. Ask the user to open it, then call again.',
    };
  }
  return {
    available: true,
    ageMs: Math.max(0, now - telemetry.sampledAt),
    disk: telemetry.disk,
    network: telemetry.network,
    // Greatest GPU engine utilisation — a proxy, NOT Task Manager's aggregate GPU %.
    gpuEnginePeakPercent: telemetry.gpuEnginePeakPercent,
    osProcessCount: telemetry.osProcessCount,
    osProcessListTruncated: telemetry.processLimitReached,
  };
};

/** Build the Agent-facing monitor report from a persisted snapshot. */
export const buildMonitorReport = (snapshot: SystemSnapshot, options: MonitorReportOptions) => {
  const { static: profile, live } = snapshot;
  const monitor = snapshot.monitor;
  const viewerActive = monitor?.viewerActive ?? false;
  const windowSamples = clampInt(options.windowSamples, MONITOR_WINDOW_DEFAULT, 1, MONITOR_WINDOW_MAX);
  const processLimit = clampInt(options.topProcesses, MONITOR_PROCESS_DEFAULT, 0, MONITOR_PROCESS_MAX);
  const includePerCore = options.includePerCore ?? true;

  const ageMs = Math.max(0, options.now - live.sampledAt);
  const stale = ageMs > MONITOR_STALE_AFTER_MS;

  const window: MetricSample[] = snapshot.history.slice(-windowSamples);
  const spanSec = window.length > 1 ? Math.round((window[window.length - 1].t - window[0].t) / 1000) : 0;

  const perCore = live.cpu.perCorePercent.map(round1);
  const hottestCore = perCore.length > 0 ? Math.max(...perCore) : null;

  const alerts: string[] = [];
  if (stale) {
    alerts.push(
      `Data is ${Math.round(ageMs / 1000)}s old: the Tomni sampler may be stopped or the app closed. Do not treat it as live.`
    );
  }
  if (live.cpu.overallPercent >= CPU_HIGH_PERCENT) alerts.push(`CPU is high (${live.cpu.overallPercent}%).`);
  if (hottestCore !== null && hottestCore >= CORE_SATURATED_PERCENT) {
    alerts.push(`At least one logical core is saturated (${hottestCore}%).`);
  }
  if (live.memory.usedPercent >= MEMORY_HIGH_PERCENT) alerts.push(`RAM is nearly full (${live.memory.usedPercent}%).`);
  for (const disk of profile.disks) {
    if (disk.totalMB > 0 && (disk.freeMB / disk.totalMB) * 100 < DISK_LOW_FREE_PERCENT) {
      alerts.push(`Disk ${disk.mount} has under ${DISK_LOW_FREE_PERCENT}% free space.`);
    }
  }
  if (live.power.onBattery) alerts.push('Running on battery power.');

  return {
    sampledAt: live.sampledAt,
    ageMs,
    stale,
    viewerActive,
    host: { hostname: profile.os.hostname, os: `${profile.os.type} ${profile.os.release} (${profile.os.arch})` },
    cpu: {
      model: profile.cpu.model,
      logicalCores: profile.cpu.logicalCores,
      overallPercent: live.cpu.overallPercent,
      hottestCorePercent: hottestCore,
      ...(includePerCore ? { perCorePercent: perCore } : {}),
    },
    memory: live.memory,
    loadAvg: live.loadAvg,
    uptimeSec: live.uptimeSec,
    onBattery: live.power.onBattery,
    disks: profile.disks,
    hostTelemetry: describeTelemetry(monitor?.telemetry, viewerActive, options.now),
    trend: {
      windowSamples: window.length,
      spanSec,
      cpu: summarizeSeries(window.map((sample) => sample.cpu)),
      memory: summarizeSeries(window.map((sample) => sample.mem)),
      ...(options.includeSamples ? { samples: window } : {}),
    },
    tomniProcesses: live.processes.slice(0, processLimit).map((process) => ({
      pid: process.pid,
      name: process.name,
      type: process.type,
      cpuPercent: process.cpuPercent,
      memoryMB: process.memoryMB,
    })),
    alerts,
  };
};

export type MonitorReport = ReturnType<typeof buildMonitorReport>;

/** One-paragraph headline for the text part of the tool result. */
export const describeMonitorReport = (report: MonitorReport): string => {
  const trend = report.trend.cpu;
  const trendText = trend
    ? ` CPU ${trend.direction} (avg ${trend.avg}%, max ${trend.max}% over ${report.trend.spanSec}s).`
    : '';
  const age = `${Math.round(report.ageMs / 1000)}s old`;
  const freshness = report.stale ? ` STALE (${age}).` : ` Fresh (${age}).`;
  const alertText = report.alerts.length > 0 ? ` Alerts: ${report.alerts.join(' ')}` : ' No alerts.';
  return (
    `${report.host.hostname}: CPU ${report.cpu.overallPercent}% (${report.cpu.logicalCores} cores), ` +
    `RAM ${report.memory.usedMB}/${report.memory.totalMB}MB (${report.memory.usedPercent}%).${trendText}${freshness}${alertText}`
  );
};
