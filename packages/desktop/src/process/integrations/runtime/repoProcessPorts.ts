/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contracts of the repo process runtime (repotopackage design section 13). Everything that touches the operating
 * system (spawn, kill, sockets, clock, secrets) sits behind these ports so the endpoint logic is unit-testable.
 */

export type RepoProcessErrorCode =
  | 'SPEC_INVALID'
  | 'PROGRAM_FORBIDDEN'
  | 'CWD_FORBIDDEN'
  | 'ENV_FORBIDDEN'
  | 'ENV_MISSING'
  | 'PORT_IN_USE'
  | 'SETUP_FAILED'
  | 'READY_TIMEOUT'
  | 'EXITED_BEFORE_READY'
  | 'RESTART_LIMIT'
  | 'SERVICE_LIMIT'
  | 'ABORTED';

/** Stable, user-facing failure of the process runtime. `message` never carries a secret value. */
export class RepoProcessError extends Error {
  readonly code: RepoProcessErrorCode;
  readonly serviceId: string | undefined;

  constructor(code: RepoProcessErrorCode, message: string, serviceId?: string) {
    super(message);
    this.name = 'RepoProcessError';
    this.code = code;
    this.serviceId = serviceId;
  }
}

/** One program of an app, as declared by the adapter (`processService`), plus an optional ordering hint. */
export type RepoProcessServiceSpec = Readonly<{
  id: string;
  /** Working folder relative to the package directory (inside `source/`). */
  cwd: string;
  /** Commands run once per approval hash before the first start. */
  setup?: readonly (readonly string[])[];
  start: readonly string[];
  /** Absent for a headless program: it has no port and counts as started while its process stays alive. */
  ready?: Readonly<{ port: number }>;
  /** Declared variables; values come from the package secret port, never from the process environment. */
  env?: readonly Readonly<{ name: string; required: boolean }>[];
  /** Services that must be ready first. When omitted the declared order is the start order. */
  dependsOn?: readonly string[];
}>;

export type RepoProcessSpec = Readonly<{
  /** Absolute package directory chosen by Main; the only root a working folder may resolve inside. */
  packageDirectory: string;
  /** Pins what was approved; the setup marker is keyed by it. */
  approvalHash: string;
  services: readonly RepoProcessServiceSpec[];
}>;

export type SpawnRequest = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
}>;

export type SpawnedProcess = Readonly<{
  pid: number | undefined;
  /** Combined stdout/stderr text as it arrives. */
  onOutput: (listener: (stream: 'stdout' | 'stderr', chunk: string) => void) => void;
  /** Called exactly once; `null` code means the process could not start or died by signal. */
  onExit: (listener: (code: number | null) => void) => void;
}>;

export type RepoProcessClock = Readonly<{
  now: () => number;
  /** Resolves after `ms`; rejects when `signal` aborts first. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}>;

export type RepoProcessPorts = Readonly<{
  spawn: (request: SpawnRequest) => SpawnedProcess;
  /** Kills the process and every descendant. Never rejects. */
  killTree: (pid: number, graceMs: number) => Promise<void>;
  isPortOpen: (port: number) => Promise<boolean>;
  /** Best-effort name of the process that holds a port. */
  describePortOwner?: (port: number) => Promise<string | undefined>;
  clock: RepoProcessClock;
  /** Minimal system variables only (PATH, temp, home); never application secrets. */
  baseEnv: () => Readonly<Record<string, string>>;
  /** Package secret port. Called inside Main only. */
  resolveSecret: (name: string) => Promise<string | undefined>;
  setupMarkers: Readonly<{
    has: (key: string) => Promise<boolean>;
    mark: (key: string) => Promise<void>;
  }>;
  /** Executable that runs `node` programs (Electron with ELECTRON_RUN_AS_NODE in the app). */
  nodeExecutable: string;
}>;

export type RepoProcessState = 'starting' | 'waiting' | 'ready' | 'restarting' | 'error' | 'stopped';

export type RepoProcessEvent = Readonly<{
  serviceId: string;
  state: RepoProcessState;
  code?: RepoProcessErrorCode;
  message?: string;
  /** Milliseconds spent waiting for the ready port, for progress display. */
  waitedMs?: number;
}>;

export type RepoProcessLogLine = Readonly<{ stream: 'stdout' | 'stderr'; text: string; at: number }>;

/** Counts running services across the whole app (v1 limit: 6). */
export type ServiceSlots = Readonly<{
  acquire: (count: number) => boolean;
  release: (count: number) => void;
  inUse: () => number;
}>;

export const MAX_APP_SERVICES = 6;

export const createServiceSlots = (max: number = MAX_APP_SERVICES): ServiceSlots => {
  let used = 0;
  return {
    acquire: (count) => {
      if (used + count > max) return false;
      used += count;
      return true;
    },
    release: (count) => {
      used = Math.max(0, used - count);
    },
    inUse: () => used,
  };
};
