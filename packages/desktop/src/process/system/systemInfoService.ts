/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Insight service — the Main-process singleton that ties together the
 * static probe, the live sampler, the rolling history, the priority manager and
 * the on-disk snapshot (for the Agent plane).
 *
 * ## Sampling cadence
 *
 * A single timer drives sampling so CPU-delta accounting stays correct (two
 * interleaved samplers would corrupt the per-core deltas). Its interval adapts:
 * - **Fast** ({@link SAMPLE_INTERVAL_MS}) while at least one renderer is
 *   streaming (the Quan sát page is open), so gauges update smoothly.
 * - **Slow** ({@link SNAPSHOT_INTERVAL_MS}) when nobody is watching — just often
 *   enough to keep the agent-facing snapshot file reasonably fresh.
 *
 * Each tick: sample → push to history → persist the snapshot (throttled) →
 * re-apply any remembered process-priority choices → emit to subscribers (only
 * when streaming, to avoid useless IPC when the page is closed).
 *
 * Process boundary: Main-process (Node.js / Electron) module — no DOM APIs.
 */

import { createLiveSampler, type LiveSampler } from './liveMetricsSampler';
import {
  createPriorityManager,
  defaultPriorityManagerDeps,
  processIdentity,
  type ProcessPriorityManager,
} from './processPriorityManager';
import { createSnapshotStore, defaultSnapshotStoreDeps, type SnapshotStore } from './systemSnapshotStore';
import { probeStaticSystemInfo } from './staticInfoProbe';
import { probeWindowsTelemetry } from './windowsTelemetryProbe';
import type {
  LiveSystemMetrics,
  HostTelemetry,
  MetricSample,
  ProcessPriorityLevel,
  SetPriorityResult,
  StaticSystemInfo,
  SystemSnapshot,
} from './systemInfoTypes';

/** Fast sampling interval (ms) used while a renderer is streaming. */
export const SAMPLE_INTERVAL_MS = 2000;

/** Slow sampling interval (ms) used when nobody is watching (snapshot freshness). */
export const SNAPSHOT_INTERVAL_MS = 8000;

/** Maximum points kept in the rolling history buffer (for sparklines). */
export const HISTORY_MAX = 120;
/** Expensive OS process/counter probing runs only on demand while a viewer is connected. */
export const HOST_TELEMETRY_INTERVAL_MS = 10000;
/** The UI must not mistake an old successful probe for live data. */
export const HOST_TELEMETRY_MAX_AGE_MS = 30000;

/** A subscriber callback invoked with every live sample while streaming. */
export type MetricsListener = (metrics: LiveSystemMetrics) => void;

/** Injected collaborators (defaulted for production, overridable in tests). */
export type SystemInfoServiceDeps = {
  /** Directory for the snapshot file + priority store (the app `userData` dir). */
  dataDir: string;
  /** Probe the static profile (defaults to the real probe). */
  probeStatic: () => Promise<StaticSystemInfo>;
  /** The stateful live sampler (defaults to the real sampler). */
  sampler: LiveSampler;
  /** The snapshot store (defaults to a real fs-backed store). */
  snapshotStore: SnapshotStore;
  /** The priority manager (defaults to a real os/fs-backed manager). */
  priorityManager: ProcessPriorityManager;
  /** Optional read-only, asynchronous Windows telemetry probe. */
  probeHostTelemetry?: () => Promise<HostTelemetry | null>;

  /** Schedule a repeating tick; returns a cancel handle (defaults to setInterval). */
  setInterval: (handler: () => void, ms: number) => NodeJS.Timeout;
  /** Cancel a scheduled tick (defaults to clearInterval). */
  clearInterval: (handle: NodeJS.Timeout) => void;
};

/** Build the default production deps for the given data directory. */
export const buildDefaultDeps = (dataDir: string): SystemInfoServiceDeps => ({
  dataDir,
  probeStatic: probeStaticSystemInfo,
  sampler: createLiveSampler(),
  snapshotStore: createSnapshotStore(defaultSnapshotStoreDeps(dataDir)),
  priorityManager: createPriorityManager(defaultPriorityManagerDeps(dataDir)),
  probeHostTelemetry: process.platform === 'win32' ? probeWindowsTelemetry : undefined,
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle),
});

export type SystemInfoService = {
  /** Probe the static profile (once) and start the sampling timer. */
  start: () => Promise<void>;
  /** Stop the timer and release subscribers (deterministic teardown). */
  stop: () => void;
  /** The cached static profile (probed at start / on {@link refreshStatic}). */
  getStaticInfo: () => StaticSystemInfo | null;
  /** Re-probe the static profile and return the fresh value. */
  refreshStatic: () => Promise<StaticSystemInfo>;
  /** The most recent complete snapshot, or `null` before the first sample. */
  getSnapshot: () => SystemSnapshot | null;
  /** Apply a priority level to a live pid and remember the choice by identity. */
  setProcessPriority: (pid: number, level: ProcessPriorityLevel) => SetPriorityResult;
  /** Subscribe to live samples; the returned function unsubscribes. */
  onMetrics: (listener: MetricsListener) => () => void;
  /** Ref-counted: start fast streaming (Quan sát page mounted). */
  startStream: () => void;
  /** Ref-counted: stop fast streaming (Quan sát page unmounted). */
  stopStream: () => void;
};

/** Create a System Insight service from the given deps. */
export const createSystemInfoService = (deps: SystemInfoServiceDeps): SystemInfoService => {
  let staticInfo: StaticSystemInfo | null = null;
  let latestLive: LiveSystemMetrics | null = null;
  const history: MetricSample[] = [];
  const listeners = new Set<MetricsListener>();

  let timer: NodeJS.Timeout | null = null;
  let currentInterval = 0;
  let streamRefCount = 0;
  let lastSnapshotWriteAt = 0;
  let lastHostTelemetryAttemptAt = -HOST_TELEMETRY_INTERVAL_MS;
  let hostTelemetry: HostTelemetry | null = null;
  let hostTelemetryPending = false;
  let stopped = false;
  // Map a live pid → identity so a priority change persists by identity even
  // though the UI only knows the pid.
  let identityByPid = new Map<number, string>();

  const buildSnapshot = (): SystemSnapshot | null => {
    if (!staticInfo || !latestLive) return null;
    // Never persist/export machine-wide process names in Agent-facing snapshots.
    const { hostTelemetry: privateTelemetry, ...safeLive } = latestLive;
    // Only privacy-safe aggregates reach the Agent plane; process names stay here.
    const telemetry = privateTelemetry
      ? {
          sampledAt: privateTelemetry.sampledAt,
          disk: privateTelemetry.disk,
          network: privateTelemetry.network,
          gpuEnginePeakPercent: privateTelemetry.gpuEnginePeakPercent,
          osProcessCount: privateTelemetry.processes ? privateTelemetry.processes.length : null,
          processLimitReached: privateTelemetry.processLimitReached,
        }
      : null;
    return {
      static: staticInfo,
      live: safeLive,
      history: [...history],
      monitor: { viewerActive: streamRefCount > 0, telemetry },
    };
  };

  const persistSnapshot = (at: number): void => {
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    deps.snapshotStore.write(snapshot);
    lastSnapshotWriteAt = at;
  };

  const maybeProbeHostTelemetry = (at: number): void => {
    if (!deps.probeHostTelemetry || streamRefCount === 0 || hostTelemetryPending) return;
    if (at - lastHostTelemetryAttemptAt < HOST_TELEMETRY_INTERVAL_MS) return;
    lastHostTelemetryAttemptAt = at;
    hostTelemetryPending = true;
    void deps
      .probeHostTelemetry()
      .then((sample) => {
        if (stopped || streamRefCount === 0) return;
        hostTelemetry = sample;
        // Push completed slow metrics without waiting a second sampling interval.
        if (latestLive) {
          latestLive = { ...latestLive, hostTelemetry: sample };
          for (const listener of listeners) listener(latestLive);
          // Let an agent reading the snapshot see the fresh counters immediately.
          persistSnapshot(latestLive.sampledAt);
        }
      })
      .catch(() => {
        if (!stopped) hostTelemetry = null;
      })
      .finally(() => {
        hostTelemetryPending = false;
      });
  };

  const tick = (): void => {
    const live = deps.sampler.sample();
    const fresh =
      hostTelemetry && live.sampledAt - hostTelemetry.sampledAt <= HOST_TELEMETRY_MAX_AGE_MS ? hostTelemetry : null;
    latestLive = streamRefCount > 0 ? { ...live, hostTelemetry: fresh } : live;
    maybeProbeHostTelemetry(live.sampledAt);

    history.push({ t: live.sampledAt, cpu: live.cpu.overallPercent, mem: live.memory.usedPercent });
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);

    identityByPid = new Map(live.processes.map((process) => [process.pid, processIdentity(process)]));
    deps.priorityManager.reapply(live.processes);

    // Persist at the slow cadence regardless of streaming so the agent always
    // has a reasonably fresh file; while a viewer streams, persist every tick so
    // the agent sees the same near-realtime data as the monitor tab.
    if (streamRefCount > 0 || live.sampledAt - lastSnapshotWriteAt >= SNAPSHOT_INTERVAL_MS - 1) {
      persistSnapshot(live.sampledAt);
    }

    if (streamRefCount > 0) {
      for (const listener of listeners) listener(live);
    }
  };

  /** (Re)arm the timer at the interval implied by the current streaming state. */
  const reschedule = (): void => {
    const desired = streamRefCount > 0 ? SAMPLE_INTERVAL_MS : SNAPSHOT_INTERVAL_MS;
    if (timer && currentInterval === desired) return;
    if (timer) deps.clearInterval(timer);
    currentInterval = desired;
    timer = deps.setInterval(tick, desired);
  };

  const start = async (): Promise<void> => {
    stopped = false;
    staticInfo = await deps.probeStatic();
    // Prime the CPU delta + first sample immediately so the snapshot file and
    // any early reader have data without waiting a full interval.
    tick();
    reschedule();
  };

  const stop = (): void => {
    stopped = true;
    hostTelemetry = null;
    if (timer) deps.clearInterval(timer);
    timer = null;
    currentInterval = 0;
    listeners.clear();
    streamRefCount = 0;
  };

  const refreshStatic = async (): Promise<StaticSystemInfo> => {
    staticInfo = await deps.probeStatic();
    const snapshot = buildSnapshot();
    if (snapshot) deps.snapshotStore.write(snapshot);
    return staticInfo;
  };

  const setProcessPriority = (pid: number, level: ProcessPriorityLevel): SetPriorityResult =>
    deps.priorityManager.setPriority(pid, level, identityByPid.get(pid));

  const onMetrics = (listener: MetricsListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const startStream = (): void => {
    streamRefCount += 1;
    if (streamRefCount === 1) {
      reschedule();
      maybeProbeHostTelemetry(Date.now());
    }
  };

  const stopStream = (): void => {
    streamRefCount = Math.max(0, streamRefCount - 1);
    if (streamRefCount === 0) reschedule();
  };

  return {
    start,
    stop,
    getStaticInfo: () => staticInfo,
    refreshStatic,
    getSnapshot: buildSnapshot,
    setProcessPriority,
    onMetrics,
    startStream,
    stopStream,
  };
};

/** Lazily-created Main-process singleton. */
let singleton: SystemInfoService | null = null;

/**
 * Get (creating on first use) the System Insight service singleton.
 *
 * The data directory is resolved from Electron's `userData` path. Callers in a
 * non-Electron context (tests) should use {@link createSystemInfoService} with
 * explicit deps instead.
 */
export const getSystemInfoService = (): SystemInfoService => {
  if (!singleton) {
    let dataDir = process.cwd();
    try {
      const { app } = require('electron') as typeof import('electron');
      dataDir = app.getPath('userData');
    } catch {
      // Non-Electron context: fall back to cwd (used only as a last resort).
    }
    singleton = createSystemInfoService(buildDefaultDeps(dataDir));
  }
  return singleton;
};

/** Reset the singleton (test helper). */
export const __resetSystemInfoServiceForTests = (): void => {
  singleton?.stop();
  singleton = null;
};