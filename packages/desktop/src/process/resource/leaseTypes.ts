/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core type definitions for the ResourceCoordinator (Requirement 5 — anti-lag
 * resource management). These types model the resource budget, the leases that
 * gate every heavy task, and the persisted coordinator state.
 *
 * This module contains types only (no runtime behaviour) so that it can be
 * imported safely by both Main-process services (`systemProbe`, `resourceState`,
 * `balancePolicy`, `resourceCoordinator`, ...) and, where needed, by the renderer
 * Dashboard UI without dragging in Node.js dependencies.
 */

/**
 * Category of heavy task that must be throttled by the ResourceCoordinator.
 *
 * Every expensive capability across the Tomny spec maps onto exactly one of
 * these kinds so that concurrency can be budgeted per category:
 * - `agent`         — spawning an AI agent / CLI session
 * - `browser`       — an embedded browser (WebContentsView) tab
 * - `emulator`      — an Android emulator instance
 * - `windowsTest`   — a Windows .exe test session in a virtual display
 * - `patchBuild`    — building and testing a candidate bug-fix patch
 * - `ocr`           — optical character recognition of scanned documents
 * - `transcription` — audio/video speech-to-text
 * - `docConvert`    — document conversion (e.g. PDF ⇄ Word)
 * - `semanticIndex` — embedding / vector index work for semantic tool selection
 */
export type TaskKind =
  | 'agent'
  | 'browser'
  | 'emulator'
  | 'windowsTest'
  | 'patchBuild'
  | 'ocr'
  | 'transcription'
  | 'docConvert'
  | 'semanticIndex';

/**
 * Coordinator operating mode (criterion 5.2).
 * - `detailed` — the user sets every limit manually.
 * - `suggest`  — the coordinator evaluates the machine and self-balances.
 */
export type ResourceMode = 'detailed' | 'suggest';

/**
 * A preset that can be applied to the budget via `applyPreset` (criterion 5.3).
 * These are the user-selectable quick levels.
 */
export type ApplicablePreset = 'saver' | 'balanced' | 'performance';

/**
 * The preset currently reflected in {@link ResourceState}.
 *
 * Extends {@link ApplicablePreset} with `custom`, which represents a budget that
 * was edited manually (in `detailed` mode) and therefore no longer matches any
 * built-in preset.
 */
export type ResourcePreset = ApplicablePreset | 'custom';

/**
 * The resource budget the coordinator enforces.
 */
export type ResourceBudget = {
  /** Maximum number of concurrent tasks allowed per {@link TaskKind}. */
  maxConcurrent: Record<TaskKind, number>;
  /** Upper bound on total RAM (MB) dedicated to heavy tasks. */
  maxTotalMemoryMB: number;
  /** RAM (MB) reserved for the user so the machine stays responsive. */
  reserveForUserMB: number;
};

/** Process or service identity that owns a queued or active lease. */
export type LeaseOwner = {
  processKind: 'main' | 'renderer' | 'utility' | 'sandbox-package' | 'worker';
  serviceId: string;
  taskId?: string;
  packageId?: string;
};

/**
 * A request a service submits before running a heavy task. The coordinator
 * resolves it with a {@link Lease} once enough resources are free (the request
 * may wait in the queue until then).
 */
export type LeaseRequest = {
  /** Category of the task being requested. */
  kind: TaskKind;
  /** Estimated RAM (MB) the task will consume while it runs. */
  estCostMB: number;
  /** Optional scheduling priority; higher values are granted sooner. */
  priority?: number;
  /** Optional stable id for cancellation and observability. */
  requestId?: string;
  /** Optional deadline for waiting in the queue. */
  deadlineAt?: number;
  /** Optional owner used for crash-safe bulk revocation. */
  owner?: LeaseOwner;
  /** Optional active-lease lifetime. Omitted leases retain v1 manual-release semantics. */
  ttlMs?: number;
  /** Whether a timed lease accepts heartbeat renewal. Defaults to true when ttlMs is set. */
  renewable?: boolean;
};

export type ResourcePressure = 'healthy' | 'constrained' | 'critical';

export type ResourceReason = {
  code: string;
  message: string;
  at: number;
};

export type EffectiveResourceLimit = {
  configured: number;
  effective: number;
  reason?: ResourceReason;
};

/**
 * A granted permission ("ticket") to run one heavy task. The holder must call
 * `releaseLease(id)` when the task finishes so the budget is freed.
 */
export type Lease = {
  /** Unique identifier for this lease. */
  id: string;
  /** Category of the task this lease was granted for. */
  kind: TaskKind;
  /** Timestamp (Unix ms) when the lease was granted. */
  grantedAt: number;
  /** Time spent waiting for resource capacity before this lease was granted. */
  waitMs?: number;
  /** Estimated RAM (MB) accounted against the budget while the lease is held. */
  estCostMB: number;
  /** Optional crash-revocation identity. */
  owner?: LeaseOwner;
  /** Renewal interval for a timed lease. */
  ttlMs?: number;
  /** Absolute active-lease expiry time. */
  expiresAt?: number;
  /** Whether heartbeat renewal is accepted. */
  renewable?: boolean;
};

/**
 * An entry in the wait queue for a task that could not be granted a lease
 * immediately because the budget was exhausted (criterion 5.4).
 */
export type QueuedTask = {
  /** Stable request id used by cancellation and UI keys. */
  requestId: string;
  /** Category of the queued task. */
  kind: TaskKind;
  /** Timestamp (Unix ms) when the task entered the queue. */
  enqueuedAt: number;
  /** Estimated RAM charged when granted. */
  estCostMB: number;
  /** Scheduling priority. */
  priority: number;
  /** Why the request is waiting. */
  reason: string;
  /** Optional deadline for the pending request. */
  deadlineAt?: number;
  /** Optional crash-revocation identity retained while queued. */
  owner?: LeaseOwner;
  /** Active-lease lifetime to apply when granted. */
  ttlMs?: number;
  /** Whether the future timed lease may be renewed. */
  renewable?: boolean;
  /** Wait duration at the time this queue snapshot was produced. */
  waitMs: number;
};

/**
 * A record of a single automatic budget adjustment (criterion 5.8).
 *
 * `from`/`to` are full {@link ResourceBudget} snapshots taken immediately before
 * and after the change. Full snapshots (rather than partial diffs) are stored so
 * the Dashboard can render an unambiguous before/after view and so the history
 * remains self-describing even as the budget shape evolves.
 */
export type BudgetAdjustment = {
  /** Timestamp (Unix ms) when the adjustment was applied. */
  at: number;
  /** Human-readable reason for the adjustment, surfaced to the user. */
  reason: string;
  /** Budget snapshot before the adjustment. */
  from: ResourceBudget;
  /** Budget snapshot after the adjustment. */
  to: ResourceBudget;
};

/**
 * Static profile of the host machine, read once at startup by `systemProbe`
 * (criterion 5.1) and used to derive the suggested preset.
 */
export type MachineProfile = {
  /** Total physical RAM (MB). */
  totalMemMB: number;
  /** Number of logical CPU cores. */
  cpuCores: number;
  /** Whether a discrete GPU is present. */
  hasDiscreteGPU: boolean;
  /** Free disk space (MB) on the relevant volume. */
  freeDiskMB: number;
};

/**
 * The complete, persisted state of the ResourceCoordinator.
 *
 * Stored as `resource-state.json` in the app data directory. Mirrors the Data
 * Models section of `design.md`.
 */
export type ResourceState = {
  /** Static machine profile read at startup. */
  machine: MachineProfile;
  /** Latest live pressure classification, if a sample has been received. */
  pressure?: ResourcePressure;
  /** Last resource sampler reading and timestamp. */
  lastSample?: { freeMemMB: number; cpuLoad: number; at: number };
  /** Human-readable reason for the current effective limit. */
  resourceReason?: ResourceReason;
  /** Effective concurrency after live pressure safety policy. */
  effectiveLimits?: Partial<Record<TaskKind, EffectiveResourceLimit>>;
  /** Current operating mode. */
  mode: ResourceMode;
  /** Preset currently reflected by {@link ResourceState.budget}. */
  preset: ResourcePreset;
  /** Active resource budget being enforced. */
  budget: ResourceBudget;
  /** Leases currently held by running tasks. */
  active: Lease[];
  /** Tasks waiting for a lease because the budget is exhausted. */
  queued: QueuedTask[];
  /** History of automatic budget adjustments and their reasons. */
  lastAdjustments: BudgetAdjustment[];
};
