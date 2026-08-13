/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core of the ResourceCoordinator (Requirement 5 — anti-lag resource
 * management). This service is the **mandatory gate** for every heavy task in
 * the Tomny spec: no service may spawn a worker / BrowserView / emulator /
 * patch-build without first obtaining a {@link Lease} here (criterion 5.9).
 *
 * Responsibilities (see `design.md`, Yêu cầu 5):
 * - **Lease accounting (criterion 5.4):** grant a lease immediately when it fits
 *   inside the current {@link ResourceBudget} (per-kind concurrency *and* the
 *   total heavy-task memory ceiling); otherwise queue the request and resolve it
 *   later, in priority order, when a release frees enough budget. The invariant
 *   the property tests assert is that the summed `estCostMB` of all *active*
 *   leases never exceeds `budget.maxTotalMemoryMB`.
 * - **Tier B real-time self-balancing:** a periodic timer samples live resource
 *   pressure and asks `balancePolicy.evaluateAdjustment` whether to scale the
 *   budget; any adjustment is applied and persisted with its reason
 *   (criterion 5.8). Only runs in `suggest` mode (criterion 5.2).
 * - **On-demand suspend (criterion 5.5):** services register an `idleHook` per
 *   {@link TaskKind}; the coordinator fires the hook when a kind has had no
 *   active leases for longer than the idle timeout, so idle components can free
 *   memory and be reloaded on demand.
 *
 * ## Testability
 *
 * Every source of non-determinism — the machine probe, the live pressure
 * sampler, the clock, the timer scheduler, the lease-id generator, and the
 * persistence directory/fs — is injected via {@link ResourceCoordinatorOptions}.
 * Tests construct an instance with {@link createResourceCoordinator} supplying a
 * fake scheduler and deterministic samples, so the queue/budget invariants
 * (subtasks 1.7 / 1.8) can be checked without real timers or disk. The shared
 * application instance is exposed lazily via {@link getResourceCoordinator}.
 *
 * Tier A (preset suggestion) and Tier B (the adjustment rule engine) live in
 * `balancePolicy.ts`; Tier C (AI deep analysis) lives in `balanceAdvisor.ts`
 * (subtask 1.9). This module owns only the side effects and orchestration.
 */

import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import {
  BALANCE_INTERVAL_MS,
  evaluateAdjustment,
  presetBudget,
  suggestPreset,
  type ResourceSample,
} from './balancePolicy';
import type {
  ApplicablePreset,
  BudgetAdjustment,
  Lease,
  LeaseRequest,
  LeaseOwner,
  MachineProfile,
  ResourceBudget,
  ResourceMode,
  ResourceState,
  TaskKind,
  EffectiveResourceLimit,
  ResourcePressure,
  ResourceReason,
} from './leaseTypes';
import {
  LifecycleResourcePool,
  type LifecycleActivationOptions,
  type LifecycleResourceSnapshot,
  type LifecycleResourceSnapshotEntry,
  type LifecycleResourceSpec,
} from './lifecycleResource';

import {
  appendBudgetAdjustment,
  loadResourceState,
  saveResourceState,
  type ResourceStateStoreOptions,
} from './resourceState';
import { probeSystem } from './systemProbe';

/** Number of bytes in one megabyte (MiB), for byte → MB conversion. */
const BYTES_PER_MB = 1024 * 1024;

/** Default idle timeout (ms) before an unused {@link TaskKind} is suspended. */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_LIFECYCLE_RESOURCES = 128;
const MAX_LIFECYCLE_RESOURCES = 256;
const DEFAULT_AGING_INTERVAL_MS = 30_000;
const MAX_PRIORITY = 100;
const MIN_PRIORITY = -100;
// The top raw priority is reserved for interactive work. Aging may improve
// fairness among lower-priority requests, but never lets a background request
// catch or overtake that interactive lane.
const MAX_AGED_PRIORITY = MAX_PRIORITY - 1;
const MAX_BUDGET_ADJUSTMENT_HISTORY = 100;
const MAX_RESOURCE_IDENTIFIER_LENGTH = 1024;
const MAX_LEASE_TTL_MS = 2_147_483_647;
const LEASE_PROCESS_KINDS: ReadonlySet<LeaseOwner['processKind']> = new Set([
  'main',
  'renderer',
  'utility',
  'sandbox-package',
  'worker',
]);
// oxlint-disable-next-line no-control-regex -- Reject control characters in untrusted request identifiers.
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

/** Conservative placeholder machine used before {@link IResourceCoordinator.init} runs. */
const PLACEHOLDER_MACHINE: MachineProfile = { totalMemMB: 0, cpuCores: 1, hasDiscreteGPU: false, freeDiskMB: 0 };

/** Clamp `value` into the inclusive range `[min, max]`. */
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Preserve safe production defaults when a runtime-provided scheduler tunable is not finite. */
const normalizeFiniteIntegerOption = (value: number | undefined, fallback: number, minimum: number): number =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.max(minimum, Math.floor(value));

/**
 * Opaque handle returned by the {@link Scheduler}. Kept as `unknown` so a fake
 * scheduler (tests) and the real Node timers can both satisfy the interface
 * without leaking their concrete handle types.
 */
export type TimerHandle = unknown;

/**
 * Timer abstraction so the balancing loop and idle timeouts can be driven by a
 * fake clock in tests. Mirrors the subset of the Node timer API the coordinator
 * needs. The default implementation wraps the global timers.
 */
export type Scheduler = {
  setInterval: (handler: () => void, ms: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
  setTimeout: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

/** Default scheduler backed by the global Node timers. */
const defaultScheduler: Scheduler = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** A function that reads a live {@link ResourceSample} of system pressure. */
export type ResourceSampler = () => ResourceSample | Promise<ResourceSample>;

/** Callback a service registers to be told its {@link TaskKind} should suspend. */
export type IdleHook = () => void | Promise<void>;

/** Local cancellation controls that never cross the serializable lease contract. */
export type LeaseRequestOptions = {
  /** Stop waiting for capacity; has no effect after a lease is granted. */
  signal?: AbortSignal;
};

/**
 * Injectable dependencies and tunables for {@link createResourceCoordinator}.
 * Every field is optional; omitted fields use the real, production defaults.
 */
export type ResourceCoordinatorOptions = {
  /** Reads the static machine profile at startup. Defaults to the real probe. */
  probe?: () => Promise<MachineProfile>;
  /** Reads live resource pressure each Tier B tick. Defaults to an `os`-based sampler. */
  sampler?: ResourceSampler;
  /** Wall-clock source (Unix ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Timer scheduler. Defaults to the global Node timers. */
  scheduler?: Scheduler;
  /** Where/how to persist {@link ResourceState}. Defaults to the app data dir. */
  store?: ResourceStateStoreOptions;
  /** Idle timeout (ms) before an unused kind is suspended. */
  idleTimeoutMs?: number;
  /** Interval (ms) of the Tier B balancing loop. Defaults to {@link BALANCE_INTERVAL_MS}. */
  balanceIntervalMs?: number;
  /** Unique lease-id generator. Defaults to `crypto.randomUUID`. */
  generateId?: () => string;
  /** Whether {@link IResourceCoordinator.init} starts the Tier B loop. Defaults to `true`. */
  autoStartBalanceLoop?: boolean;
  /** Maximum accepted pending requests. */
  maxQueueSize?: number;
  /** Waiting time required for one bounded scheduling-priority boost. */
  agingIntervalMs?: number;
  /** Maximum package/tab resources retained in the warm LRU set. */
  maxWarmResources?: number;
  /** Maximum package/tab lifecycle registrations retained in memory. */
  maxLifecycleResources?: number;
};

/**
 * Public surface of the ResourceCoordinator, matching the `IResourceCoordinator`
 * interface in `design.md` plus the idle-hook registration (criterion 5.5) and a
 * `dispose` for deterministic teardown.
 */
export type IResourceCoordinator = {
  /** Tier A: probe the machine, restore or derive the budget, start Tier B. */
  init: () => Promise<ResourceState>;
  /** Request a lease; resolves immediately if it fits, otherwise when it does. */
  requestLease: (req: LeaseRequest, options?: LeaseRequestOptions) => Promise<Lease>;
  /** Release a held lease and grant any newly-fitting queued requests. */
  releaseLease: (id: string) => void;
  /** Extend a renewable timed lease by its original TTL. */
  renewLease: (id: string) => boolean;
  /** Revoke active and queued work owned by a crashed process or service. */
  ownerCrashed: (owner: LeaseOwner) => number;
  /** Switch between `detailed` (manual) and `suggest` (self-balancing) modes. */
  setMode: (mode: ResourceMode) => void;
  /** Merge a partial budget; marks the preset as `custom`. */
  setBudget: (budget: Partial<ResourceBudget>) => void;
  /** Apply a built-in quick level (`saver | balanced | performance`). */
  applyPreset: (preset: ApplicablePreset) => void;
  /** Snapshot of the current in-memory state (safe to mutate by the caller). */
  getState: () => ResourceState;
  /** Subscribe to state changes; returns an unsubscribe function. */
  onStateChange: (cb: (state: ResourceState) => void) => () => void;
  /** Register a per-kind suspend hook; returns an unregister function. */
  registerIdleHook: (kind: TaskKind, onSuspend: IdleHook) => () => void;
  /** Return configured and pressure-adjusted concurrency for a task kind. */
  getEffectiveLimit: (kind: TaskKind) => EffectiveResourceLimit;
  /** Cancel a queued lease request; returns whether it was removed. */
  cancelQueuedRequest: (requestId: string) => boolean;
  /** Register a generic package/tab lifecycle resource. */
  registerLifecycleResource: (spec: LifecycleResourceSpec) => void;
  /** Acquire its lease and move it deterministically to active. */
  activateLifecycleResource: (
    id: string,
    options?: LifecycleActivationOptions
  ) => Promise<LifecycleResourceSnapshotEntry>;
  /** Move an active resource to the bounded warm LRU set. */
  deactivateLifecycleResource: (id: string) => Promise<void>;
  /** Suspend a non-active resource and release its lease. */
  suspendLifecycleResource: (id: string) => Promise<void>;
  /** Evict a non-active resource and release all accounting. */
  evictLifecycleResource: (id: string) => Promise<void>;
  /** Evict then remove a non-active registration. */
  unregisterLifecycleResource: (id: string) => Promise<void>;
  /** Observable package/tab lifecycle snapshot. */
  getLifecycleSnapshot: () => LifecycleResourceSnapshot;
  /** Subscribe to package/tab lifecycle transitions. */
  onLifecycleStateChange: (cb: (snapshot: LifecycleResourceSnapshot) => void) => () => void;

  /** Stop all timers, await lifecycle cleanup hooks, and drop all listeners. */
  dispose: () => Promise<void>;
};

export class ResourceQueueFullError extends Error {
  readonly code = 'RESOURCE_QUEUE_FULL';
  constructor() {
    super('Resource queue is full.');
    this.name = 'ResourceQueueFullError';
  }
}

export class ResourceRequestCancelledError extends Error {
  readonly code = 'RESOURCE_REQUEST_CANCELLED';
  constructor(readonly requestId: string) {
    super(`Resource request ${requestId} was cancelled.`);
    this.name = 'ResourceRequestCancelledError';
  }
}

export class ResourceRequestDeadlineError extends Error {
  readonly code = 'RESOURCE_REQUEST_DEADLINE';
  constructor(readonly requestId: string) {
    super(`Resource request ${requestId} exceeded its deadline.`);
    this.name = 'ResourceRequestDeadlineError';
  }
}

export class ResourceOwnerRevokedError extends Error {
  readonly code = 'RESOURCE_OWNER_REVOKED';
  constructor(readonly owner: LeaseOwner) {
    super(`Resource owner ${owner.processKind}:${owner.serviceId} was revoked.`);
    this.name = 'ResourceOwnerRevokedError';
  }
}

export class ResourceCoordinatorDisposedError extends Error {
  readonly code = 'RESOURCE_COORDINATOR_DISPOSED';
  constructor() {
    super('Resource coordinator has been disposed.');
    this.name = 'ResourceCoordinatorDisposedError';
  }
}

/** Internal record for a request waiting in the queue (criterion 5.4). */
type PendingRequest = {
  requestId: string;
  kind: TaskKind;
  estCostMB: number;
  priority: number;
  enqueuedAt: number;
  deadlineAt?: number;
  owner?: LeaseOwner;
  ttlMs?: number;
  renewable?: boolean;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  resolve: (lease: Lease) => void;
  reject: (error: Error) => void;
};

/** Sum the idle and total CPU times across all cores from `os.cpus()`. */
const readCpuTimes = (): { idle: number; total: number } => {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
};

/**
 * Build the default `os`-based sampler. CPU load is estimated from the change in
 * idle/total CPU time between successive calls (the first call has no baseline
 * and reports `0`). Free RAM is read directly from `os.freemem()`.
 */
const createDefaultSampler = (): ResourceSampler => {
  let previous = readCpuTimes();
  return () => {
    const current = readCpuTimes();
    const idleDelta = current.idle - previous.idle;
    const totalDelta = current.total - previous.total;
    previous = current;
    const cpuLoad = totalDelta > 0 ? clamp(1 - idleDelta / totalDelta, 0, 1) : 0;
    return { freeMemMB: Math.round(os.freemem() / BYTES_PER_MB), cpuLoad };
  };
};

/** Deep-clone a {@link ResourceBudget} so snapshots cannot be mutated in place. */
const cloneBudget = (budget: ResourceBudget): ResourceBudget => ({
  maxConcurrent: { ...budget.maxConcurrent },
  maxTotalMemoryMB: budget.maxTotalMemoryMB,
  reserveForUserMB: budget.reserveForUserMB,
});

/** Deep-clone a {@link ResourceState} for safe external consumption. */
const cloneState = (state: ResourceState): ResourceState => ({
  machine: { ...state.machine },
  mode: state.mode,
  preset: state.preset,
  budget: cloneBudget(state.budget),
  active: state.active.map((lease) => ({ ...lease, owner: lease.owner ? { ...lease.owner } : undefined })),
  pressure: state.pressure,
  lastSample: state.lastSample ? { ...state.lastSample } : undefined,
  resourceReason: state.resourceReason ? { ...state.resourceReason } : undefined,
  effectiveLimits: state.effectiveLimits
    ? Object.fromEntries(
        Object.entries(state.effectiveLimits).map(([kind, limit]) => [
          kind,
          { ...limit, reason: limit.reason ? { ...limit.reason } : undefined },
        ])
      )
    : undefined,
  queued: state.queued.map((task) => ({ ...task, owner: task.owner ? { ...task.owner } : undefined })),
  lastAdjustments: state.lastAdjustments.map((adjustment) => ({
    at: adjustment.at,
    reason: adjustment.reason,
    from: cloneBudget(adjustment.from),
    to: cloneBudget(adjustment.to),
  })),
});

/**
 * Concrete coordinator. Not exported directly — callers use
 * {@link createResourceCoordinator} (factory) or {@link getResourceCoordinator}
 * (shared instance) so the construction options stay the single entry point.
 */
class ResourceCoordinatorImpl implements IResourceCoordinator {
  private readonly probe: () => Promise<MachineProfile>;
  private readonly sampler: ResourceSampler;
  private readonly now: () => number;
  private readonly scheduler: Scheduler;
  private readonly store?: ResourceStateStoreOptions;
  private readonly idleTimeoutMs: number;
  private readonly balanceIntervalMs: number;
  private readonly generateId: () => string;
  private readonly autoStartBalanceLoop: boolean;
  private readonly maxQueueSize: number;
  private readonly agingIntervalMs: number;
  private readonly lifecycle: LifecycleResourcePool;
  private readonly pendingTimers = new Map<string, TimerHandle>();
  private readonly leaseTimers = new Map<string, TimerHandle>();
  private readonly ownersBeingRevoked = new Set<string>();
  private lastSampleAt = 0;

  private state: ResourceState;
  private readonly pending: PendingRequest[] = [];
  private readonly listeners = new Set<(state: ResourceState) => void>();
  private readonly idleHooks = new Map<TaskKind, IdleHook>();
  private readonly idleTimers = new Map<TaskKind, TimerHandle>();
  private readonly suspended = new Set<TaskKind>();
  private balanceHandle: TimerHandle | undefined;
  private balancing = false;
  private initialized = false;
  private initialization: Promise<void> | undefined;
  private disposeWork: Promise<void> | undefined;
  private disposed = false;

  constructor(options: ResourceCoordinatorOptions = {}) {
    this.probe = options.probe ?? probeSystem;
    this.sampler = options.sampler ?? createDefaultSampler();
    this.now = options.now ?? (() => Date.now());
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.store = options.store;
    this.idleTimeoutMs = normalizeFiniteIntegerOption(options.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1);
    this.balanceIntervalMs = normalizeFiniteIntegerOption(options.balanceIntervalMs, BALANCE_INTERVAL_MS, 1);
    this.generateId = options.generateId ?? (() => randomUUID());
    this.autoStartBalanceLoop = options.autoStartBalanceLoop ?? true;
    this.maxQueueSize = normalizeFiniteIntegerOption(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, 1);
    this.agingIntervalMs = normalizeFiniteIntegerOption(options.agingIntervalMs, DEFAULT_AGING_INTERVAL_MS, 1);
    this.lifecycle = new LifecycleResourcePool({
      requestLease: (request) => this.requestLease(request),
      releaseLease: (id) => this.releaseLease(id),
      cancelQueuedRequest: (requestId) => this.cancelQueuedRequest(requestId),
      maxResources: Math.min(
        MAX_LIFECYCLE_RESOURCES,
        normalizeFiniteIntegerOption(options.maxLifecycleResources, DEFAULT_MAX_LIFECYCLE_RESOURCES, 1)
      ),
      maxWarmResources: normalizeFiniteIntegerOption(options.maxWarmResources, 3, 0),
      now: this.now,
      generateRequestId: this.generateId,
      scheduleDeadline: (handler, ms) => this.scheduler.setTimeout(handler, ms),
      clearDeadline: (handle) => this.scheduler.clearTimeout(handle),
    });

    this.state = ResourceCoordinatorImpl.buildDefaultState(PLACEHOLDER_MACHINE);
  }

  /** Build a usable default state for the given machine (preset: `balanced`). */
  private static buildDefaultState(machine: MachineProfile): ResourceState {
    const preset = suggestPreset(machine);
    return {
      machine,
      mode: 'suggest',
      preset,
      budget: presetBudget(preset, machine),
      pressure: 'healthy',
      active: [],
      queued: [],
      lastAdjustments: [],
    };
  }

  async init(): Promise<ResourceState> {
    this.assertNotDisposed();
    if (this.initialized) return this.getState();

    this.initialization ??= this.initialize();
    try {
      await this.initialization;
    } catch (error) {
      this.initialization = undefined;
      throw error;
    }
    return this.getState();
  }

  private async initialize(): Promise<void> {
    const machine = await this.probe();
    this.assertNotDisposed();
    const persisted = await loadResourceState(this.store);
    this.assertNotDisposed();
    if (persisted) {
      // Active leases and the queue are per-process and do not survive a
      // restart, so reset them; keep the user's budget/mode/preset/history.
      this.state = {
        ...persisted,
        machine,
        active: [],
        queued: [],
        lastAdjustments: persisted.lastAdjustments.slice(-MAX_BUDGET_ADJUSTMENT_HISTORY),
      };
      // The file passed structural validation, then this applies the live
      // machine ceiling and per-kind caps before any lease can be granted.
      this.state.budget = this.validateBudget(this.state.budget);
    } else {
      this.state = ResourceCoordinatorImpl.buildDefaultState(machine);
    }
    this.syncQueuedState();
    await this.persist();
    this.assertNotDisposed();
    this.initialized = true;
    if (this.autoStartBalanceLoop) this.startBalanceLoop();
    this.emit();
    this.drainQueue();
  }

  requestLease(req: LeaseRequest, options?: LeaseRequestOptions): Promise<Lease> {
    try {
      this.assertNotDisposed();
      const kind = this.validateTaskKind(req.kind);
      const estCostMB = this.validateCostMB(req.estCostMB);
      const priority = this.validatePriority(req.priority);
      const owner = this.normalizeLeaseOwner(req.owner);
      if (owner && this.ownersBeingRevoked.has(this.leaseOwnerKey(owner))) {
        throw new ResourceOwnerRevokedError(owner);
      }
      const lifetime = this.validateLeaseLifetime(req.ttlMs, req.renewable);
      const requestId = this.normalizeRequestId(req.requestId);
      const signal = options?.signal;
      if (signal?.aborted) throw new ResourceRequestCancelledError(requestId);
      const requestedAt = this.now();
      if (req.deadlineAt !== undefined && (!Number.isFinite(req.deadlineAt) || req.deadlineAt <= requestedAt)) {
        throw new ResourceRequestDeadlineError(requestId);
      }
      if (this.pending.some((pending) => pending.requestId === requestId)) {
        throw new Error(`Duplicate resource request id: ${requestId}`);
      }
      if (this.initialized && this.canGrant(kind, estCostMB)) {
        const lease = this.grantInternal(kind, estCostMB, requestedAt, owner, lifetime.ttlMs, lifetime.renewable);
        this.emit();
        return Promise.resolve(lease);
      }
      if (this.pending.length >= this.maxQueueSize) throw new ResourceQueueFullError();
      const enqueuedAt = requestedAt;
      const queued = new Promise<Lease>((resolve, reject) => {
        const pending: PendingRequest = {
          requestId,
          kind,
          estCostMB,
          priority,
          enqueuedAt,
          deadlineAt: req.deadlineAt,
          owner,
          ttlMs: lifetime.ttlMs,
          renewable: lifetime.renewable,
          abortSignal: signal,
          resolve,
          reject,
        };
        this.pending.push(pending);
        if (req.deadlineAt !== undefined) {
          const delay = req.deadlineAt - enqueuedAt;
          let handle: TimerHandle | undefined;
          const rejectAtDeadline = () => {
            // A cleared timer may already be queued by a scheduler. Only the
            // timer currently registered for this request may change its state.
            if (handle === undefined || this.pendingTimers.get(requestId) !== handle) return;
            this.rejectQueuedRequest(requestId, new ResourceRequestDeadlineError(requestId));
          };
          try {
            handle = this.scheduler.setTimeout(rejectAtDeadline, delay);
          } catch (error) {
            const pendingIndex = this.pending.indexOf(pending);
            if (pendingIndex >= 0) {
              this.pending.splice(pendingIndex, 1);
            }
            this.syncQueuedState();
            this.emit();
            reject(error);
            return;
          }
          this.pendingTimers.set(requestId, handle);
        }
        if (signal) {
          const abortHandler = () => {
            this.rejectQueuedRequest(requestId, new ResourceRequestCancelledError(requestId));
          };
          pending.abortHandler = abortHandler;
          signal.addEventListener('abort', abortHandler, { once: true });
        }
        this.syncQueuedState();
        this.emit();
      });
      return this.observeLeasePromise(queued);
    } catch (error) {
      return this.observeLeasePromise(Promise.reject(error));
    }
  }

  releaseLease(id: string): void {
    const canonicalId = this.tryNormalizeIdentifier(id);
    // Lease ids are opaque capabilities, so their spelling must be exact. In
    // particular, a caller may not release another lease by supplying a padded
    // or malformed version of its id.
    if (!canonicalId || canonicalId !== id) return;
    const index = this.state.active.findIndex((lease) => lease.id === canonicalId);
    if (index === -1) return; // unknown / already released — idempotent
    const [removed] = this.state.active.splice(index, 1);
    this.clearLeaseTimer(canonicalId);
    if (this.disposed) return;
    if (this.activeCountOfKind(removed.kind) === 0) this.startIdleTimer(removed.kind);
    this.emit();
    this.drainQueue();
  }

  renewLease(id: string): boolean {
    this.assertNotDisposed();
    const canonicalId = this.tryNormalizeIdentifier(id);
    if (!canonicalId || canonicalId !== id) return false;
    const index = this.state.active.findIndex((lease) => lease.id === canonicalId);
    if (index < 0) return false;
    const lease = this.state.active[index];
    if (!lease.renewable || lease.ttlMs === undefined) return false;
    const renewedAt = this.now();
    if (lease.expiresAt === undefined || lease.expiresAt <= renewedAt) {
      this.releaseLease(canonicalId);
      return false;
    }
    const renewed = { ...lease, expiresAt: renewedAt + lease.ttlMs };
    this.replaceLeaseExpiryTimer(renewed);
    this.state.active[index] = renewed;
    this.emit();
    return true;
  }

  ownerCrashed(owner: LeaseOwner): number {
    this.assertNotDisposed();
    const normalizedOwner = this.normalizeLeaseOwner(owner);
    if (!normalizedOwner) throw new TypeError('owner is required.');
    const ownerKey = this.leaseOwnerKey(normalizedOwner);
    if (this.ownersBeingRevoked.has(ownerKey)) return 0;
    this.ownersBeingRevoked.add(ownerKey);
    try {
      const queuedIds = this.pending
        .filter((request) => request.owner && this.leaseOwnerKey(request.owner) === ownerKey)
        .map((request) => request.requestId);
      for (const requestId of queuedIds) {
        this.rejectQueuedRequest(requestId, new ResourceOwnerRevokedError(normalizedOwner));
      }
      const activeIds = this.state.active
        .filter((lease) => lease.owner && this.leaseOwnerKey(lease.owner) === ownerKey)
        .map((lease) => lease.id);
      for (const leaseId of activeIds) this.releaseLease(leaseId);
      return queuedIds.length + activeIds.length;
    } finally {
      this.ownersBeingRevoked.delete(ownerKey);
    }
  }

  setMode(mode: ResourceMode): void {
    this.assertNotDisposed();
    const nextMode = this.validateMode(mode);
    if (this.state.mode === nextMode) return;
    this.state.mode = nextMode;
    this.emit();
    void this.persist();
  }

  setBudget(budget: Partial<ResourceBudget>): void {
    this.assertNotDisposed();
    this.state.budget = this.validateBudget(budget);
    this.state.preset = 'custom';
    this.refreshPublishedEffectiveLimits();
    this.emit();
    void this.persist();
    this.drainQueue();
  }

  applyPreset(preset: ApplicablePreset): void {
    this.assertNotDisposed();
    const nextPreset = this.validatePreset(preset);
    this.state.budget = this.validateBudget(presetBudget(nextPreset, this.state.machine));
    this.state.preset = nextPreset;
    this.refreshPublishedEffectiveLimits();
    this.emit();
    void this.persist();
    this.drainQueue();
  }

  getState(): ResourceState {
    return cloneState(this.state);
  }

  onStateChange(cb: (state: ResourceState) => void): () => void {
    this.assertNotDisposed();
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  registerIdleHook(kind: TaskKind, onSuspend: IdleHook): () => void {
    this.assertNotDisposed();
    this.idleHooks.set(kind, onSuspend);
    // If the kind is already idle, begin its suspend countdown immediately.
    if (this.activeCountOfKind(kind) === 0) this.startIdleTimer(kind);
    return () => {
      if (this.idleHooks.get(kind) === onSuspend) {
        this.idleHooks.delete(kind);
        this.cancelIdleTimer(kind);
        this.suspended.delete(kind);
      }
    };
  }

  getEffectiveLimit(kind: TaskKind): EffectiveResourceLimit {
    return this.effectiveLimitFor(kind);
  }

  cancelQueuedRequest(requestId: string): boolean {
    const canonicalRequestId = this.tryNormalizeIdentifier(requestId);
    if (!canonicalRequestId) return false;
    return this.rejectQueuedRequest(canonicalRequestId, new ResourceRequestCancelledError(canonicalRequestId));
  }

  private rejectQueuedRequest(requestId: string, error: Error): boolean {
    const index = this.pending.findIndex((request) => request.requestId === requestId);
    if (index < 0) return false;
    const [removed] = this.pending.splice(index, 1);
    this.clearPendingAbort(removed);
    const timer = this.pendingTimers.get(requestId);
    if (timer !== undefined) this.scheduler.clearTimeout(timer);
    this.pendingTimers.delete(requestId);
    this.syncQueuedState();
    removed.reject(error);
    this.emit();
    return true;
  }

  /** Detach cancellation observers once a queued request settles. */
  private clearPendingAbort(request: PendingRequest): void {
    if (!request.abortSignal || !request.abortHandler) return;
    request.abortSignal.removeEventListener('abort', request.abortHandler);
    request.abortHandler = undefined;
  }

  registerLifecycleResource(spec: LifecycleResourceSpec): void {
    this.lifecycle.register(spec);
  }

  activateLifecycleResource(id: string, options?: LifecycleActivationOptions): Promise<LifecycleResourceSnapshotEntry> {
    return this.lifecycle.activate(id, options);
  }

  deactivateLifecycleResource(id: string): Promise<void> {
    return this.lifecycle.deactivate(id);
  }

  suspendLifecycleResource(id: string): Promise<void> {
    return this.lifecycle.suspend(id);
  }

  evictLifecycleResource(id: string): Promise<void> {
    return this.lifecycle.evict(id);
  }

  unregisterLifecycleResource(id: string): Promise<void> {
    return this.lifecycle.unregister(id);
  }

  getLifecycleSnapshot(): LifecycleResourceSnapshot {
    return this.lifecycle.getSnapshot();
  }

  onLifecycleStateChange(cb: (snapshot: LifecycleResourceSnapshot) => void): () => void {
    return this.lifecycle.onChange(cb);
  }

  async dispose(): Promise<void> {
    if (this.disposeWork) return this.disposeWork;
    this.disposed = true;
    this.disposeWork = (async () => {
      const lifecycleCleanup = this.lifecycle.dispose();
      this.stopBalanceLoop();
      for (const handle of this.idleTimers.values()) this.scheduler.clearTimeout(handle);
      for (const handle of this.pendingTimers.values()) this.scheduler.clearTimeout(handle);
      for (const handle of this.leaseTimers.values()) this.scheduler.clearTimeout(handle);
      this.idleTimers.clear();
      this.idleHooks.clear();
      this.suspended.clear();
      this.pendingTimers.clear();
      this.leaseTimers.clear();
      const pending = this.pending.splice(0);
      this.syncQueuedState();
      for (const request of pending) {
        this.clearPendingAbort(request);
        request.reject(new ResourceRequestCancelledError(request.requestId));
      }
      this.listeners.clear();
      await lifecycleCleanup;
      this.state.active.length = 0;
    })();
    return this.disposeWork;
  }

  // -------------------------------------------------------------------------
  // Lease accounting
  // -------------------------------------------------------------------------

  /** Count active leases of a given kind. */
  private activeCountOfKind(kind: TaskKind): number {
    return this.state.active.reduce((count, lease) => (lease.kind === kind ? count + 1 : count), 0);
  }

  /** Total `estCostMB` of all active leases (the invariant of criterion 5.4). */
  private activeMemoryMB(): number {
    return this.state.active.reduce((sum, lease) => sum + lease.estCostMB, 0);
  }

  /**
   * Whether a lease fits the budget right now: under the per-kind concurrency
   * cap *and* the total heavy-task memory ceiling would not be exceeded.
   */
  private canGrant(kind: TaskKind, estCostMB: number): boolean {
    if (this.activeCountOfKind(kind) >= this.getEffectiveLimit(kind).effective) return false;
    return this.activeMemoryMB() + estCostMB <= this.state.budget.maxTotalMemoryMB;
  }

  /** Add an active lease and clear any idle/suspend bookkeeping for its kind. */
  private grantInternal(
    kind: TaskKind,
    estCostMB: number,
    requestedAt = this.now(),
    owner?: LeaseOwner,
    ttlMs?: number,
    renewable?: boolean
  ): Lease {
    const grantedAt = this.now();
    const lease: Lease = {
      id: this.generateLeaseId(),
      kind,
      grantedAt,
      waitMs: Math.max(0, grantedAt - requestedAt),
      estCostMB,
      owner: owner ? { ...owner } : undefined,
      ttlMs,
      expiresAt: ttlMs === undefined ? undefined : grantedAt + ttlMs,
      renewable,
    };
    this.state.active.push(lease);
    try {
      this.replaceLeaseExpiryTimer(lease);
    } catch (error) {
      this.state.active.splice(
        this.state.active.findIndex((active) => active.id === lease.id),
        1
      );
      throw error;
    }
    this.cancelIdleTimer(kind);
    this.suspended.delete(kind);
    return lease;
  }

  /** Replace a lease-expiry timer atomically so stale callbacks cannot revoke a renewal. */
  private replaceLeaseExpiryTimer(lease: Lease): void {
    if (lease.expiresAt === undefined) return;
    let handle: TimerHandle | undefined;
    const expireWhenDue = () => {
      if (handle === undefined || this.leaseTimers.get(lease.id) !== handle || this.disposed) return;
      const current = this.state.active.find((active) => active.id === lease.id);
      if (!current || current.expiresAt !== lease.expiresAt) return;
      if (current.expiresAt > this.now()) {
        this.replaceLeaseExpiryTimer(current);
        return;
      }
      this.releaseLease(current.id);
    };
    handle = this.scheduler.setTimeout(expireWhenDue, Math.max(1, lease.expiresAt - this.now()));
    const previous = this.leaseTimers.get(lease.id);
    if (previous !== undefined) this.scheduler.clearTimeout(previous);
    this.leaseTimers.set(lease.id, handle);
  }

  private clearLeaseTimer(leaseId: string): void {
    const handle = this.leaseTimers.get(leaseId);
    if (handle === undefined) return;
    this.scheduler.clearTimeout(handle);
    this.leaseTimers.delete(leaseId);
  }

  /**
   * Grant as many queued requests as now fit, in priority order (higher
   * `priority` first, then FIFO by enqueue time). Resolves each granted
   * request's promise. A single descending pass suffices because granting only
   * consumes budget.
   */
  private drainQueue(): void {
    if (this.pending.length === 0) return;
    const now = this.now();
    // Timers are best-effort and can run late under a busy event loop. Never
    // grant a request that is already past its declared waiting deadline.
    // oxlint-disable-next-line unicorn/no-useless-spread -- Rejection mutates the pending queue during traversal.
    for (const request of [...this.pending]) {
      if (request.deadlineAt !== undefined && request.deadlineAt <= now) {
        this.rejectQueuedRequest(request.requestId, new ResourceRequestDeadlineError(request.requestId));
      }
    }
    if (this.pending.length === 0) return;
    const effectivePriority = (request: PendingRequest): number =>
      request.priority +
      Math.min(
        Math.max(0, MAX_AGED_PRIORITY - request.priority),
        Math.floor(Math.max(0, now - request.enqueuedAt) / this.agingIntervalMs)
      );
    const ordered = [...this.pending].toSorted(
      (a, b) => effectivePriority(b) - effectivePriority(a) || a.enqueuedAt - b.enqueuedAt
    );
    const granted: Array<{ request: PendingRequest; lease: Lease }> = [];
    const failed: Array<{ request: PendingRequest; error: Error }> = [];
    for (const request of ordered) {
      if (!this.canGrant(request.kind, request.estCostMB)) continue;
      try {
        const lease = this.grantInternal(
          request.kind,
          request.estCostMB,
          request.enqueuedAt,
          request.owner,
          request.ttlMs,
          request.renewable
        );
        granted.push({ request, lease });
      } catch (error) {
        failed.push({ request, error: error instanceof Error ? error : new Error('Lease grant failed.') });
      }
    }
    if (granted.length === 0 && failed.length === 0) return;
    const settledRequests = new Set([
      ...granted.map((entry) => entry.request),
      ...failed.map((entry) => entry.request),
    ]);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (settledRequests.has(this.pending[i])) {
        const [removed] = this.pending.splice(i, 1);
        this.clearPendingAbort(removed);
        const timer = this.pendingTimers.get(removed.requestId);
        if (timer !== undefined) this.scheduler.clearTimeout(timer);
        this.pendingTimers.delete(removed.requestId);
      }
    }
    this.syncQueuedState();
    this.emit();
    for (const { request, lease } of granted) request.resolve(lease);
    for (const { request, error } of failed) request.reject(error);
  }

  /** Mirror the internal pending list into the serializable `state.queued`. */
  private syncQueuedState(): void {
    this.state.queued = this.pending.map((request) => ({
      requestId: request.requestId,
      kind: request.kind,
      enqueuedAt: request.enqueuedAt,
      estCostMB: request.estCostMB,
      priority: request.priority,
      reason: this.queueReason(request.kind, request.estCostMB),
      deadlineAt: request.deadlineAt,
      owner: request.owner ? { ...request.owner } : undefined,
      ttlMs: request.ttlMs,
      renewable: request.renewable,
      waitMs: Math.max(0, this.now() - request.enqueuedAt),
    }));
  }

  private queueReason(kind: TaskKind, estCostMB: number): string {
    if (!this.initialized) return 'coordinator-initializing';
    const limit = this.getEffectiveLimit(kind);
    if (this.activeCountOfKind(kind) >= limit.effective) return 'concurrency-limit';
    if (this.activeMemoryMB() + estCostMB > this.state.budget.maxTotalMemoryMB) return 'memory-ceiling';
    return 'resource-pressure';
  }

  // -------------------------------------------------------------------------
  // Tier B — real-time self-balancing loop
  // -------------------------------------------------------------------------

  /** Start the periodic balancing loop (no-op if already running). */
  private startBalanceLoop(): void {
    if (this.balanceHandle !== undefined) return;
    this.balanceHandle = this.scheduler.setInterval(() => {
      void this.runBalanceTick();
    }, this.balanceIntervalMs);
  }

  /** Stop the periodic balancing loop. */
  private stopBalanceLoop(): void {
    if (this.balanceHandle === undefined) return;
    this.scheduler.clearInterval(this.balanceHandle);
    this.balanceHandle = undefined;
  }

  /**
   * One Tier B tick: sample pressure, ask the policy whether to adjust, and
   * apply any adjustment. Self-balancing only runs in `suggest` mode
   * (criterion 5.2); overlapping ticks are skipped while one is in flight.
   */
  private async runBalanceTick(): Promise<void> {
    if (this.disposed || this.balancing || this.state.mode !== 'suggest') return;
    this.balancing = true;
    try {
      const sample = await this.sampler();
      if (this.disposed) return;
      const normalizedSample = this.updatePressure(sample);
      const decision = evaluateAdjustment({
        current: this.state.budget,
        sample: normalizedSample,
        machine: this.state.machine,
        recentAdjustmentsAt: this.state.lastAdjustments.map((adjustment) => adjustment.at),
        now: this.now(),
      });
      if (decision.action !== 'none') await this.applyAdjustment(decision.adjustment);
    } catch {
      // Telemetry providers are external to this loop. Do not echo an arbitrary
      // provider error because it can contain raw machine data.
      console.warn('[Resource] Balance tick failed.');
    } finally {
      this.balancing = false;
    }
  }

  private updatePressure(sample: unknown): ResourceSample {
    const { normalized, valid } = this.normalizeTelemetrySample(sample);
    const totalMemMB = this.state.machine.totalMemMB;
    const freeFraction = Number.isFinite(totalMemMB) && totalMemMB > 0 ? normalized.freeMemMB / totalMemMB : 0;
    const pressure: ResourcePressure =
      normalized.cpuLoad >= 0.9 || freeFraction < 0.1
        ? 'critical'
        : normalized.cpuLoad >= 0.75 || freeFraction < 0.2
          ? 'constrained'
          : 'healthy';
    const at = this.now();
    this.lastSampleAt = at;
    const reason: ResourceReason = {
      code: !valid
        ? 'sample-invalid'
        : pressure === 'critical'
          ? 'machine-critical'
          : pressure === 'constrained'
            ? 'machine-constrained'
            : 'machine-healthy',
      message:
        pressure === 'healthy'
          ? 'Machine has spare capacity.'
          : 'Concurrency reduced to keep the application responsive.',
      at,
    };
    this.state = {
      ...this.state,
      pressure,
      lastSample: { ...normalized, at },
      resourceReason: reason,
      effectiveLimits: Object.fromEntries(
        (Object.keys(this.state.budget.maxConcurrent) as TaskKind[]).map((kind) => [
          kind,
          this.effectiveLimitFor(kind, pressure, reason),
        ])
      ),
    };
    this.syncQueuedState();
    this.emit();
    void this.lifecycle.handlePressure(pressure).catch(() => {
      // Lifecycle hooks are external and may carry paths or credentials in their errors.
      console.warn('[Resource] Lifecycle pressure handling failed.');
    });

    this.drainQueue();
    return normalized;
  }

  /**
   * Accept only a complete, physically plausible telemetry sample. A broken
   * provider is treated as pressure instead of allowing it to expand quota or
   * surface its raw values in a diagnostic log.
   */
  private normalizeTelemetrySample(sample: unknown): { normalized: ResourceSample; valid: boolean } {
    const fallback: ResourceSample = { freeMemMB: 0, cpuLoad: 1 };
    try {
      if (sample === null || typeof sample !== 'object') return { normalized: fallback, valid: false };
      const candidate = sample as { freeMemMB?: unknown; cpuLoad?: unknown };
      const totalMemMB = this.state.machine.totalMemMB;
      const freeMemMB = candidate.freeMemMB;
      const cpuLoad = candidate.cpuLoad;
      const valid =
        Number.isFinite(totalMemMB) &&
        totalMemMB > 0 &&
        typeof freeMemMB === 'number' &&
        Number.isFinite(freeMemMB) &&
        freeMemMB >= 0 &&
        freeMemMB <= totalMemMB &&
        typeof cpuLoad === 'number' &&
        Number.isFinite(cpuLoad) &&
        cpuLoad >= 0 &&
        cpuLoad <= 1;
      return valid ? { normalized: { freeMemMB, cpuLoad }, valid: true } : { normalized: fallback, valid: false };
    } catch {
      return { normalized: fallback, valid: false };
    }
  }

  private effectiveLimitFor(
    kind: TaskKind,
    pressure: ResourcePressure = this.state.pressure ?? 'healthy',
    reason = this.state.resourceReason
  ): EffectiveResourceLimit {
    const configured = this.state.budget.maxConcurrent[kind];
    const effective =
      pressure === 'critical'
        ? Math.min(configured, 1)
        : pressure === 'constrained'
          ? Math.ceil(configured / 2)
          : configured;
    return { configured, effective, reason: effective < configured ? reason : undefined };
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new ResourceCoordinatorDisposedError();
  }

  /**
   * Mark internal queue rejections observed without changing the promise that
   * callers receive; callers can still await or catch the original rejection.
   */
  private observeLeasePromise(promise: Promise<Lease>): Promise<Lease> {
    void promise.catch((): undefined => undefined);
    return promise;
  }

  /** Normalize caller-supplied request ids before they can enter state, logs, or timers. */
  private normalizeRequestId(requestId: LeaseRequest['requestId']): string {
    if (requestId === undefined || (typeof requestId === 'string' && requestId.trim() === '')) {
      return this.generateIdentifier('generated resource request id');
    }
    return this.normalizeIdentifier(requestId, 'requestId');
  }

  /** Create a bounded canonical id and reject broken test/runtime generators early. */
  private generateIdentifier(label: string): string {
    return this.normalizeIdentifier(this.generateId(), label);
  }

  /** Generate an opaque lease capability that cannot alias an active lease. */
  private generateLeaseId(): string {
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = this.generateIdentifier('generated lease id');
      if (!this.state.active.some((lease) => lease.id === id)) return id;
    }
    throw new Error('Unable to generate a unique lease id.');
  }

  private tryNormalizeIdentifier(value: unknown): string | undefined {
    try {
      return this.normalizeIdentifier(value, 'identifier');
    } catch {
      return undefined;
    }
  }

  private normalizeIdentifier(value: unknown, label: string): string {
    if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
    const normalized = value.trim();
    if (!normalized) throw new TypeError(`${label} must be non-empty.`);
    if (normalized.length > MAX_RESOURCE_IDENTIFIER_LENGTH) {
      throw new RangeError(`${label} exceeds the ${MAX_RESOURCE_IDENTIFIER_LENGTH}-character limit.`);
    }
    if (CONTROL_CHARACTER.test(normalized)) throw new TypeError(`${label} must not contain control characters.`);
    return normalized;
  }

  private validateNonNegativeInteger(value: number, field: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${field} must be a finite non-negative number.`);
    }
    return Math.round(value);
  }

  /** Round positive RAM estimates upward so the accounting never undercharges a lease. */
  private validateCostMB(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError('estCostMB must be a finite non-negative number.');
    }
    return Math.ceil(value);
  }

  private validateTaskKind(kind: TaskKind): TaskKind {
    if (typeof kind !== 'string' || !Object.hasOwn(this.state.budget.maxConcurrent, kind)) {
      throw new TypeError('kind must be a supported task kind.');
    }
    return kind;
  }

  private normalizeLeaseOwner(owner: LeaseOwner | undefined): LeaseOwner | undefined {
    if (owner === undefined) return undefined;
    if (owner === null || typeof owner !== 'object') throw new TypeError('owner must be an object.');
    const candidate = owner as Record<string, unknown>;
    if (
      typeof candidate.processKind !== 'string' ||
      !LEASE_PROCESS_KINDS.has(candidate.processKind as LeaseOwner['processKind'])
    ) {
      throw new TypeError('owner.processKind is not supported.');
    }
    const processKind = candidate.processKind as LeaseOwner['processKind'];
    const normalized: LeaseOwner = {
      processKind,
      serviceId: this.normalizeIdentifier(candidate.serviceId, 'owner.serviceId'),
      taskId: candidate.taskId === undefined ? undefined : this.normalizeIdentifier(candidate.taskId, 'owner.taskId'),
      packageId:
        candidate.packageId === undefined
          ? undefined
          : this.normalizeIdentifier(candidate.packageId, 'owner.packageId'),
    };
    if (processKind === 'sandbox-package' && normalized.packageId === undefined) {
      throw new TypeError('owner.packageId is required for sandbox-package owners.');
    }
    return normalized;
  }

  private leaseOwnerKey(owner: LeaseOwner): string {
    return JSON.stringify([owner.processKind, owner.serviceId, owner.taskId ?? null, owner.packageId ?? null]);
  }

  private validateLeaseLifetime(
    ttlMs: number | undefined,
    renewable: boolean | undefined
  ): Pick<Lease, 'ttlMs' | 'renewable'> {
    if (ttlMs === undefined) {
      if (renewable !== undefined) throw new TypeError('renewable requires ttlMs.');
      return {};
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LEASE_TTL_MS) {
      throw new RangeError(`ttlMs must be between 1 and ${MAX_LEASE_TTL_MS}.`);
    }
    if (renewable !== undefined && typeof renewable !== 'boolean') {
      throw new TypeError('renewable must be a boolean.');
    }
    return { ttlMs: Math.ceil(ttlMs), renewable: renewable ?? true };
  }

  private validatePriority(priority: number | undefined): number {
    if (priority === undefined) return 0;
    if (!Number.isFinite(priority)) throw new RangeError('priority must be a finite number.');
    return clamp(Math.trunc(priority), MIN_PRIORITY, MAX_PRIORITY);
  }

  private validateMode(mode: ResourceMode): ResourceMode {
    if (mode !== 'detailed' && mode !== 'suggest') throw new TypeError('mode must be detailed or suggest.');
    return mode;
  }

  private validatePreset(preset: ApplicablePreset): ApplicablePreset {
    if (preset !== 'saver' && preset !== 'balanced' && preset !== 'performance') {
      throw new TypeError('preset must be saver, balanced, or performance.');
    }
    return preset;
  }

  private validateBudget(update: Partial<ResourceBudget>): ResourceBudget {
    const concurrency = { ...this.state.budget.maxConcurrent };
    const safetyCap = Math.max(1, Math.floor(this.state.machine.cpuCores));
    for (const [kind, value] of Object.entries(update.maxConcurrent ?? {}) as Array<[TaskKind, number]>) {
      if (!Object.hasOwn(concurrency, kind)) throw new TypeError(`maxConcurrent.${kind} is not supported.`);
      concurrency[kind] = Math.min(this.validateNonNegativeInteger(value, `maxConcurrent.${kind}`), safetyCap);
    }
    const reserveForUserMB = this.validateNonNegativeInteger(
      update.reserveForUserMB ?? this.state.budget.reserveForUserMB,
      'reserveForUserMB'
    );
    const requestedCeiling = this.validateNonNegativeInteger(
      update.maxTotalMemoryMB ?? this.state.budget.maxTotalMemoryMB,
      'maxTotalMemoryMB'
    );
    const clampedReserve = Math.min(reserveForUserMB, this.state.machine.totalMemMB);
    return {
      maxConcurrent: concurrency,
      reserveForUserMB: clampedReserve,
      maxTotalMemoryMB: Math.min(requestedCeiling, Math.max(0, this.state.machine.totalMemMB - clampedReserve)),
    };
  }

  /** Keep a previously-published pressure view aligned with the current budget. */
  private refreshPublishedEffectiveLimits(): void {
    if (!this.state.effectiveLimits) return;
    const pressure = this.state.pressure ?? 'healthy';
    const reason = this.state.resourceReason;
    this.state.effectiveLimits = Object.fromEntries(
      (Object.keys(this.state.budget.maxConcurrent) as TaskKind[]).map((kind) => [
        kind,
        this.effectiveLimitFor(kind, pressure, reason),
      ])
    );
  }

  /** Apply and persist an automatic budget adjustment, then re-drain the queue. */
  private async applyAdjustment(adjustment: BudgetAdjustment): Promise<void> {
    if (this.disposed) return;
    try {
      const retainedAdjustments = this.state.lastAdjustments.slice(-(MAX_BUDGET_ADJUSTMENT_HISTORY - 1));
      const stateForAdjustment =
        retainedAdjustments.length === this.state.lastAdjustments.length
          ? this.state
          : { ...this.state, lastAdjustments: retainedAdjustments };
      const nextState = await appendBudgetAdjustment(stateForAdjustment, adjustment, this.store);
      if (this.disposed) return;
      this.state = nextState;
    } catch (error) {
      // Persistence failed; still apply the adjustment in memory so balancing
      // continues to function even if disk is unavailable.
      if (this.disposed) return;
      console.warn('[Resource] Failed to persist budget adjustment:', error);
      this.state = {
        ...this.state,
        budget: adjustment.to,
        lastAdjustments: [...this.state.lastAdjustments, adjustment].slice(-MAX_BUDGET_ADJUSTMENT_HISTORY),
      };
    }
    if (this.disposed) return;
    this.emit();
    this.drainQueue();
  }

  // -------------------------------------------------------------------------
  // On-demand suspend (idle hooks, criterion 5.5)
  // -------------------------------------------------------------------------

  /** Schedule the suspend hook for a kind that has just gone idle. */
  private startIdleTimer(kind: TaskKind): void {
    if (!this.idleHooks.has(kind)) return;
    this.cancelIdleTimer(kind);
    let handle: TimerHandle | undefined;
    const suspendWhenStillIdle = () => {
      // A cleared timer may still run late. Do not let it remove or fire the
      // successor timer for the same task kind.
      if (handle === undefined || this.idleTimers.get(kind) !== handle) return;
      this.idleTimers.delete(kind);
      if (this.disposed || this.activeCountOfKind(kind) !== 0) return;
      const hook = this.idleHooks.get(kind);
      if (!hook) return;
      this.suspended.add(kind);
      void Promise.resolve()
        .then(hook)
        .catch((error) => {
          console.warn(`[Resource] Idle hook for "${kind}" failed:`, error);
        });
    };
    handle = this.scheduler.setTimeout(suspendWhenStillIdle, this.idleTimeoutMs);
    this.idleTimers.set(kind, handle);
  }

  /** Cancel a pending idle suspend timer for a kind, if any. */
  private cancelIdleTimer(kind: TaskKind): void {
    const handle = this.idleTimers.get(kind);
    if (handle === undefined) return;
    this.scheduler.clearTimeout(handle);
    this.idleTimers.delete(kind);
  }

  // -------------------------------------------------------------------------
  // Persistence + notification
  // -------------------------------------------------------------------------

  /** Persist the current state, swallowing (logging) any write error. */
  private async persist(): Promise<void> {
    try {
      await saveResourceState(this.state, this.store);
    } catch (error) {
      console.warn('[Resource] Failed to persist resource state:', error);
    }
  }

  /** Notify the listener cohort present at dispatch with isolated snapshots. */
  private emit(): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot listeners because callbacks may unsubscribe.
    for (const listener of [...this.listeners]) {
      if (this.disposed) return;
      try {
        listener(cloneState(this.state));
      } catch {
        console.warn('[Resource] State-change listener threw.');
      }
    }
  }
}

/**
 * Create a new, independent ResourceCoordinator. Prefer this in tests so each
 * case gets an isolated instance with injected timers/probe/sampler/store.
 *
 * @param options Optional dependency and tunable overrides.
 * @returns A fresh {@link IResourceCoordinator}.
 */
export const createResourceCoordinator = (options?: ResourceCoordinatorOptions): IResourceCoordinator =>
  new ResourceCoordinatorImpl(options);

/** Lazily-created shared instance backing the IPC bridge and MCP server. */
let sharedCoordinator: IResourceCoordinator | undefined;

/**
 * Get the shared, application-wide ResourceCoordinator, creating it on first
 * use with production defaults. The caller is responsible for invoking `init()`
 * once during Main-process startup.
 */
export const getResourceCoordinator = (): IResourceCoordinator => {
  if (!sharedCoordinator) sharedCoordinator = createResourceCoordinator();
  return sharedCoordinator;
};
