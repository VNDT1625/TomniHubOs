/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-safe client for the Tomny Core operations surfaced in Manager.
 * Manager uses the native Electron IPC contract rather than legacy HTTP/WS.
 */

import { bridge } from '@office-ai/platform';

export type ManagerCoreHealth = 'healthy' | 'degraded' | 'unhealthy';
export type ManagerCoreLoadStatus = 'loading' | 'ready' | 'unavailable';

export type ManagerCoreTarget = {
  id: string;
  name: string;
  kind: 'builtin' | 'acp' | 'cli' | 'remote';
  available: boolean;
  detail?: string;
  models: Array<{ key: string; modelId: string; label: string; providerId?: string; isDefault: boolean }>;
  defaultModelKey?: string;
};

export type ManagerCoreSession = {
  id: string;
  targetId: string;
  workspace: string;
  modelKey?: string;
  surface?: string;
  status: 'idle' | 'running' | 'completed' | 'interrupted' | 'error' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};

export type ManagerCoreEvent = {
  requestId: string;
  sessionId: string;
  targetId: string;
  type:
    | 'started'
    | 'delta'
    | 'status'
    | 'thinking'
    | 'step'
    | 'tool-call'
    | 'tool-result'
    | 'permission'
    | 'orchestration-created'
    | 'completed'
    | 'error'
    | 'cancelled';
  timestamp: number;
  sequence: number;
  text?: string;
  detail?: string;
};

export type ManagerCoreRun = {
  requestId: string;
  sessionId: string;
  targetId: string;
  startedAt: number;
  partialText: string;
  events: ManagerCoreEvent[];
  pendingPermissionIds: string[];
};

export type ManagerCoreDoctorReport = {
  generatedAt: number;
  status: ManagerCoreHealth;
  checks: Array<{
    id: string;
    status: 'pass' | 'warning' | 'error';
    summary: string;
    targetId?: string;
  }>;
  metrics: {
    runCount: number;
    startupP95Ms?: number;
    completionRate: number;
    retryRate: number;
    toolFailureRate: number;
    firstTokenP95Ms?: number;
    completionP95Ms?: number;
  };
};

export type ManagerCoreScheduledTask = {
  id: string;
  name: string;
  enabled: boolean;
  schedule:
    | { kind: 'cron'; expression: string; timezone: string }
    | { kind: 'once'; at: number; timezone: string }
    | { kind: 'interval'; everyMs: number; timezone: string }
    | { kind: 'manual'; timezone: string };
  target: {
    targetId: string;
    prompt: string;
    workspace: string;
    modelKey?: string;
    permissionMode: 'read-only' | 'workspace-write' | 'full-access';
    surface: string;
    agentId: string;
    personalId: string;
  };
  runtime: {
    nextRunAt: number | null;
    lastRunAt: number | null;
    lastCompletedAt: number | null;
    lastStatus: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
    lastError: string | null;
    activeRunId: string | null;
    consecutiveFailures: number;
  };
  createdAt: number;
  updatedAt: number;
};

const CORE_TIMEOUT_MS = 7_000;
const CORE_DOCTOR_TIMEOUT_MS = 20_000;

const withTimeout = <T>(label: string, promise: Promise<T>, timeoutMs = CORE_TIMEOUT_MS): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Tomny Core did not respond (${label}).`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

const channels = {
  listTargets: bridge.buildProvider<ManagerCoreTarget[], void>('experimental-core.list-targets'),
  listSessions: bridge.buildProvider<ManagerCoreSession[], void>('experimental-core.list-sessions'),
  listActiveRuns: bridge.buildProvider<ManagerCoreRun[], void>('experimental-core.list-active-runs'),
  scheduledList: bridge.buildProvider<ManagerCoreScheduledTask[], void>('experimental-core.scheduled-list'),
  scheduledRunNow: bridge.buildProvider<void, { id: string }>('experimental-core.scheduled-run-now'),
  scheduledCancel: bridge.buildProvider<boolean, { id: string }>('experimental-core.scheduled-cancel'),
  cancelRun: bridge.buildProvider<boolean, { requestId: string }>('experimental-core.cancel'),
  doctor: bridge.buildProvider<ManagerCoreDoctorReport, { limit?: number }>('experimental-core.doctor'),
  event: bridge.buildEmitter<ManagerCoreEvent>('experimental-core.event'),
};

export const managerCoreClient = {
  listTargets: (): Promise<ManagerCoreTarget[]> => withTimeout('listTargets', channels.listTargets.invoke()),
  listSessions: (): Promise<ManagerCoreSession[]> => withTimeout('listSessions', channels.listSessions.invoke()),
  listActiveRuns: (): Promise<ManagerCoreRun[]> => withTimeout('listActiveRuns', channels.listActiveRuns.invoke()),
  listScheduledTasks: (): Promise<ManagerCoreScheduledTask[]> =>
    withTimeout('scheduledList', channels.scheduledList.invoke()),
  runScheduledTask: (id: string): Promise<void> =>
    withTimeout('scheduledRunNow', channels.scheduledRunNow.invoke({ id })),
  cancelScheduledTask: (id: string): Promise<boolean> =>
    withTimeout('scheduledCancel', channels.scheduledCancel.invoke({ id })),
  cancelRun: (requestId: string): Promise<boolean> =>
    withTimeout('cancelRun', channels.cancelRun.invoke({ requestId })),
  doctor: (): Promise<ManagerCoreDoctorReport> =>
    withTimeout('doctor', channels.doctor.invoke({ limit: 200 }), CORE_DOCTOR_TIMEOUT_MS),
  onEvent: (listener: (event: ManagerCoreEvent) => void): (() => void) => channels.event.on(listener),
};
