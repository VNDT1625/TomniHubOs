/**
 * Generic package/tab lifecycle pool owned by the main-process ResourceCoordinator.
 * It is deliberately resource-agnostic: callers provide truthful TaskKind/RAM
 * estimates and lifecycle hooks; this module makes no GPU capability claims.
 */

import type { Lease, LeaseRequest, ResourcePressure, TaskKind } from './leaseTypes';

const MAX_LIFECYCLE_RESOURCE_ID_LENGTH = 256;
// oxlint-disable-next-line no-control-regex -- Reject control characters in untrusted resource identifiers.
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const PRESSURE_RANK: Record<ResourcePressure, number> = { healthy: 0, constrained: 1, critical: 2 };

export type LifecycleResourceState = 'cold' | 'prewarming' | 'warm' | 'active' | 'suspended' | 'evicted';
export type LifecycleResourceKind = 'package' | 'tab';

export type LifecycleResourceSpec = {
  id: string;
  kind: LifecycleResourceKind;
  taskKind: TaskKind;
  estCostMB: number;
  prewarm?: (signal: AbortSignal) => void | Promise<void>;
  activate?: (signal: AbortSignal) => void | Promise<void>;
  suspend?: () => void | Promise<void>;
  evict?: () => void | Promise<void>;
};

export type LifecycleActivationOptions = {
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type LifecycleResourceSnapshotEntry = {
  id: string;
  kind: LifecycleResourceKind;
  taskKind: TaskKind;
  estCostMB: number;
  state: LifecycleResourceState;
  hasLease: boolean;
  lastUsedAt: number;
  transitionSequence: number;
};

export type LifecycleResourceSnapshot = {
  maxWarmResources: number;
  warmCount: number;
  entries: LifecycleResourceSnapshotEntry[];
};

type LifecycleLeaseGate = {
  requestLease: (request: LeaseRequest) => Promise<Lease>;
  releaseLease: (id: string) => void;
  cancelQueuedRequest: (requestId: string) => boolean;
};

export type LifecycleResourcePoolOptions = LifecycleLeaseGate & {
  /** Maximum number of registered package/tab resources retained in the pool. */
  maxResources: number;
  maxWarmResources: number;
  now: () => number;
  generateRequestId: () => string;
  scheduleDeadline: (handler: () => void, ms: number) => unknown;
  clearDeadline: (handle: unknown) => void;
};

type LifecycleRecord = {
  spec: LifecycleResourceSpec;
  state: LifecycleResourceState;
  leaseId?: string;
  requestId?: string;
  controller?: AbortController;
  lastUsedAt: number;
  transitionSequence: number;
  operation?: Promise<LifecycleResourceSnapshotEntry>;
  /**
   * Non-activation lifecycle work started by pressure or an explicit
   * suspend/evict request. Disposal must wait for it before invoking another
   * hook on the same resource.
   */
  maintenance?: Promise<void>;
  quarantine?: Promise<void>;
};

/**
 * An activation hook was cancelled but did not settle with the cancellation.
 * The public caller still receives the original cancellation error promptly,
 * while the pool keeps ownership until the hook has really stopped.
 */
class DeferredLifecycleHookCancellation extends Error {
  constructor(
    readonly cancellation: Error,
    readonly settled: Promise<void>
  ) {
    super(cancellation.message);
    this.name = 'DeferredLifecycleHookCancellation';
  }
}

export class LifecycleResourceNotFoundError extends Error {
  readonly code = 'LIFECYCLE_RESOURCE_NOT_FOUND';
  constructor(_resourceId?: string) {
    super('Lifecycle resource was not found.');
    this.name = 'LifecycleResourceNotFoundError';
  }
}

export class LifecycleResourceCapacityError extends Error {
  readonly code = 'LIFECYCLE_RESOURCE_CAPACITY';
  constructor() {
    super('Lifecycle resource capacity is full.');
    this.name = 'LifecycleResourceCapacityError';
  }
}

export class LifecycleResourceBusyError extends Error {
  readonly code = 'LIFECYCLE_RESOURCE_BUSY';
  constructor(_resourceId?: string) {
    super('Lifecycle resource is busy.');
    this.name = 'LifecycleResourceBusyError';
  }
}

export class LifecycleOperationCancelledError extends Error {
  readonly code = 'LIFECYCLE_OPERATION_CANCELLED';
  constructor(_resourceId?: string) {
    super('Lifecycle operation was cancelled.');
    this.name = 'LifecycleOperationCancelledError';
  }
}

export class LifecycleOperationDeadlineError extends Error {
  readonly code = 'LIFECYCLE_OPERATION_DEADLINE';
  constructor(_resourceId?: string) {
    super('Lifecycle operation exceeded its deadline.');
    this.name = 'LifecycleOperationDeadlineError';
  }
}

export class LifecycleOperationFailedError extends Error {
  readonly code = 'LIFECYCLE_OPERATION_FAILED';
  constructor() {
    super('Lifecycle operation failed.');
    this.name = 'LifecycleOperationFailedError';
  }
}

const cloneEntry = (record: LifecycleRecord): LifecycleResourceSnapshotEntry => ({
  id: record.spec.id,
  kind: record.spec.kind,
  taskKind: record.spec.taskKind,
  estCostMB: record.spec.estCostMB,
  state: record.state,
  hasLease: record.leaseId !== undefined,
  lastUsedAt: record.lastUsedAt,
  transitionSequence: record.transitionSequence,
});

export class LifecycleResourcePool {
  private readonly records = new Map<string, LifecycleRecord>();
  private readonly listeners = new Set<(snapshot: LifecycleResourceSnapshot) => void>();
  private readonly unregisterWork = new Map<string, Promise<void>>();
  private sequence = 0;
  private pendingPressure?: ResourcePressure;
  private pressureWork?: Promise<void>;
  private disposeWork?: Promise<void>;
  private disposed = false;

  constructor(private readonly options: LifecycleResourcePoolOptions) {}

  register(spec: LifecycleResourceSpec): void {
    this.assertUsable();
    const id = this.normalizeResourceId(spec.id);
    if (!Number.isFinite(spec.estCostMB) || spec.estCostMB < 0) {
      throw new RangeError('Lifecycle resource estCostMB must be finite and non-negative.');
    }
    if (this.records.has(id)) throw new LifecycleOperationFailedError();
    if (this.records.size >= this.options.maxResources) throw new LifecycleResourceCapacityError();
    this.records.set(id, {
      spec: { ...spec, id, estCostMB: Math.round(spec.estCostMB) },
      state: 'cold',
      lastUsedAt: this.options.now(),
      transitionSequence: ++this.sequence,
    });
    this.emit();
  }

  async activate(id: string, activation: LifecycleActivationOptions = {}): Promise<LifecycleResourceSnapshotEntry> {
    this.assertUsable();
    const record = this.requireRecord(id);
    if (record.operation || record.maintenance || record.quarantine) throw new LifecycleResourceBusyError(id);
    if (record.state === 'active') {
      this.touch(record);
      this.emit();
      return cloneEntry(record);
    }
    const operation = this.activateInternal(record, activation);
    record.operation = operation;
    try {
      return await operation;
    } catch (error) {
      throw this.publicOperationError(error);
    } finally {
      if (record.operation === operation) record.operation = undefined;
    }
  }

  async deactivate(id: string): Promise<void> {
    this.assertUsable();
    const record = this.requireRecord(id);
    if (record.operation || record.maintenance || record.quarantine) throw new LifecycleResourceBusyError(id);
    if (record.state !== 'active') return;
    this.transition(record, 'warm');
    try {
      await this.enforceWarmBound();
    } catch (error) {
      throw this.publicOperationError(error);
    }
  }

  async suspend(id: string): Promise<void> {
    this.assertUsable();
    const record = this.requireRecord(id);
    if (record.operation || record.maintenance || record.quarantine) throw new LifecycleResourceBusyError(id);
    if (record.state === 'active') throw new LifecycleResourceBusyError(id);
    try {
      await this.runMaintenance(record, () => this.suspendRecord(record));
    } catch (error) {
      throw this.publicOperationError(error);
    }
  }

  async evict(id: string): Promise<void> {
    this.assertUsable();
    const record = this.requireRecord(id);
    if (record.operation || record.maintenance || record.quarantine || record.state === 'active')
      throw new LifecycleResourceBusyError(id);
    try {
      await this.runMaintenance(record, () => this.evictRecord(record));
    } catch (error) {
      throw this.publicOperationError(error);
    }
  }

  async unregister(id: string): Promise<void> {
    this.assertUsable();
    const record = this.requireRecord(id);
    const resourceId = record.spec.id;
    const pending = this.unregisterWork.get(resourceId);
    if (pending) return pending;
    if (record.operation || record.maintenance || record.quarantine || record.state === 'active') {
      throw new LifecycleResourceBusyError(resourceId);
    }
    const work = this.runMaintenance(record, () => this.evictRecord(record)).then(() => {
      if (this.records.get(resourceId) !== record) return;
      this.records.delete(resourceId);
      this.emit();
    });
    this.unregisterWork.set(resourceId, work);
    try {
      await work;
    } catch (error) {
      throw this.publicOperationError(error);
    } finally {
      if (this.unregisterWork.get(resourceId) === work) this.unregisterWork.delete(resourceId);
    }
  }

  handlePressure(pressure: ResourcePressure): Promise<void> {
    this.assertUsable();
    if (this.pendingPressure === undefined || PRESSURE_RANK[pressure] > PRESSURE_RANK[this.pendingPressure]) {
      this.pendingPressure = pressure;
    }
    if (this.pressureWork) return this.pressureWork;

    const work = Promise.resolve().then(async () => {
      while (!this.disposed) {
        const nextPressure = this.pendingPressure;
        if (nextPressure === undefined) return;
        this.pendingPressure = undefined;
        if (nextPressure === 'critical') {
          const activations = [...this.records.values()].flatMap((record) =>
            record.state !== 'active' && record.operation ? [{ record, operation: record.operation }] : []
          );
          await Promise.allSettled(
            activations.map(async ({ record, operation }) => {
              if (record.requestId) this.options.cancelQueuedRequest(record.requestId);
              record.controller?.abort();
              await operation.catch((): undefined => undefined);
              await record.quarantine?.catch((): undefined => undefined);
            })
          );
          if (this.disposed) return;
        }
        const candidates = this.lruRecords(
          (record) => record.state !== 'active' && !record.operation && !record.maintenance && !record.quarantine
        );
        if (nextPressure === 'constrained') {
          await this.runSequential(
            candidates.filter((entry) => entry.state === 'warm'),
            (record) => this.runMaintenance(record, () => this.suspendRecord(record))
          );
        } else if (nextPressure === 'critical') {
          await this.runSequential(
            candidates.filter((record) => record.state !== 'cold' && record.state !== 'evicted'),
            (record) => this.runMaintenance(record, () => this.evictRecord(record))
          );
        }
      }
    });
    this.pressureWork = work;
    void work.then(
      () => {
        if (this.pressureWork === work) this.pressureWork = undefined;
      },
      () => {
        if (this.pressureWork === work) this.pressureWork = undefined;
      }
    );
    return work;
  }

  getSnapshot(): LifecycleResourceSnapshot {
    const entries = [...this.records.values()].map(cloneEntry).toSorted((a, b) => a.id.localeCompare(b.id));
    return {
      maxWarmResources: this.options.maxWarmResources,
      warmCount: entries.filter((entry) => entry.state === 'warm').length,
      entries,
    };
  }

  onChange(listener: (snapshot: LifecycleResourceSnapshot) => void): () => void {
    this.assertUsable();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): Promise<void> {
    if (this.disposeWork) return this.disposeWork;
    this.disposed = true;
    const cleanup = [...this.records.values()].map((record) => ({
      record,
      previous: record.state,
      pendingOperation: record.operation,
      pendingMaintenance: record.maintenance,
      pendingQuarantine: record.quarantine,
    }));
    for (const { record, pendingOperation, pendingMaintenance, pendingQuarantine } of cleanup) {
      record.controller?.abort();
      if (record.requestId) this.options.cancelQueuedRequest(record.requestId);
      if (pendingOperation || pendingMaintenance || pendingQuarantine) continue;
      this.releaseLease(record);
      record.state = 'evicted';
      record.lastUsedAt = this.options.now();
      record.transitionSequence = ++this.sequence;
      record.operation = undefined;
    }
    this.listeners.clear();
    this.disposeWork = this.runSequential(
      cleanup,
      async ({ record, previous, pendingOperation, pendingMaintenance, pendingQuarantine }) => {
        if (pendingOperation) {
          await pendingOperation.catch((): undefined => undefined);
        }
        if (pendingMaintenance) {
          await pendingMaintenance.catch((): undefined => undefined);
        }
        const quarantine = record.quarantine ?? pendingQuarantine;
        if (quarantine) {
          await quarantine;
        }
        if (pendingOperation || pendingMaintenance || pendingQuarantine) {
          await this.finishDeferredDisposal(record);
          return;
        }
        const failures: unknown[] = [];
        if (previous === 'active' || previous === 'warm') {
          try {
            await record.spec.suspend?.();
          } catch (error) {
            failures.push(error);
          }
        }
        if (previous !== 'cold' && previous !== 'evicted') {
          try {
            await record.spec.evict?.();
          } catch (error) {
            failures.push(error);
          }
        }
        this.throwCleanupFailures(`disposing ${record.spec.id}`, failures);
      }
    ).catch(() => {
      console.warn('[Resource] Lifecycle disposal cleanup failed.');
    });
    return this.disposeWork;
  }

  private async activateInternal(
    record: LifecycleRecord,
    activation: LifecycleActivationOptions
  ): Promise<LifecycleResourceSnapshotEntry> {
    const previous = record.state;
    this.throwIfCancelledOrExpired(record.spec.id, activation);
    if (record.state === 'warm') {
      try {
        await this.runCancellable(record, activation, record.spec.activate);
        this.transition(record, 'active');
        return cloneEntry(record);
      } catch (error) {
        if (error instanceof DeferredLifecycleHookCancellation) {
          this.quarantine(record, error.settled, () => this.cleanupCancelledReactivation(record));
          throw error.cancellation;
        }
        const failures: unknown[] = [error];
        try {
          await record.spec.suspend?.();
        } catch (cleanupError) {
          failures.push(cleanupError);
        } finally {
          this.releaseLease(record);
          this.transition(record, 'suspended');
        }
        this.throwCleanupFailures(`reactivating ${record.spec.id}`, failures);
      }
    }

    const requestId = `lifecycle:${record.spec.id}:${this.options.generateRequestId()}`;
    record.requestId = requestId;
    const onAbort = (): void => {
      this.options.cancelQueuedRequest(requestId);
    };
    activation.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const lease = await this.options.requestLease({
        kind: record.spec.taskKind,
        estCostMB: record.spec.estCostMB,
        requestId,
        deadlineAt: activation.deadlineAt,
      });
      record.requestId = undefined;
      record.leaseId = lease.id;
      this.throwIfCancelledOrExpired(record.spec.id, activation);
      this.transition(record, 'prewarming');
      await this.runCancellable(record, activation, record.spec.prewarm);
      this.transition(record, 'warm');
      await this.runCancellable(record, activation, record.spec.activate);
      this.transition(record, 'active');
      return cloneEntry(record);
    } catch (error) {
      const failedState = record.state;
      if (error instanceof DeferredLifecycleHookCancellation) {
        this.quarantine(record, error.settled, () => this.cleanupCancelledActivation(record, failedState, previous));
        throw error.cancellation;
      }
      const failures: unknown[] = [error];
      record.requestId = undefined;
      if (failedState === 'warm') {
        try {
          await record.spec.suspend?.();
        } catch (cleanupError) {
          failures.push(cleanupError);
        }
      }
      if (failedState === 'prewarming' || failedState === 'warm') {
        try {
          await record.spec.evict?.();
        } catch (cleanupError) {
          failures.push(cleanupError);
        }
      }
      this.releaseLease(record);
      this.transition(record, this.disposed ? 'evicted' : previous);
      this.throwCleanupFailures(`activating ${record.spec.id}`, failures);
      throw error;
    } finally {
      activation.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async runCancellable(
    record: LifecycleRecord,
    activation: LifecycleActivationOptions,
    hook?: (signal: AbortSignal) => void | Promise<void>
  ): Promise<void> {
    this.throwIfCancelledOrExpired(record.spec.id, activation);
    if (!hook) return;
    const controller = new AbortController();
    record.controller = controller;
    let timer: unknown;
    let abortHandler: (() => void) | undefined;
    let rejectCancellation: (() => void) | undefined;
    let cancellationError: Error | undefined;
    let hookSettled = false;
    const hookPromise = Promise.resolve().then(() => hook(controller.signal));
    const hookSettlement = hookPromise.then(
      () => {
        hookSettled = true;
      },
      () => {
        hookSettled = true;
      }
    );
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = () => {
        const error = cancellationError ?? this.cancellationError(record.spec.id, activation);
        cancellationError = error;
        reject(error);
      };
      controller.signal.addEventListener('abort', rejectCancellation, { once: true });
      abortHandler = () => controller.abort();
      activation.signal?.addEventListener('abort', abortHandler, { once: true });
      if (activation.deadlineAt !== undefined) {
        timer = this.options.scheduleDeadline(abortHandler, Math.max(0, activation.deadlineAt - this.options.now()));
      }
    });
    try {
      await Promise.race([hookPromise, cancellation]);
      this.throwIfCancelledOrExpired(record.spec.id, activation);
    } catch (error) {
      if (cancellationError && error === cancellationError) {
        await Promise.resolve();
        if (!hookSettled) throw new DeferredLifecycleHookCancellation(cancellationError, hookSettlement);
      }
      throw error;
    } finally {
      if (timer !== undefined) this.options.clearDeadline(timer);
      if (abortHandler) activation.signal?.removeEventListener('abort', abortHandler);
      if (rejectCancellation) controller.signal.removeEventListener('abort', rejectCancellation);
      if (record.controller === controller) record.controller = undefined;
    }
  }

  private async enforceWarmBound(): Promise<void> {
    const warm = this.lruRecords(
      (record) => record.state === 'warm' && !record.operation && !record.maintenance && !record.quarantine
    );
    const overflow = Math.max(0, warm.length - this.options.maxWarmResources);
    await this.runSequential(warm.slice(0, overflow), (record) =>
      this.runMaintenance(record, () => this.suspendRecord(record))
    );
  }

  private async suspendRecord(record: LifecycleRecord): Promise<void> {
    if (record.state === 'suspended' || record.state === 'evicted' || record.state === 'cold') return;
    if (record.state !== 'warm') throw new LifecycleResourceBusyError(record.spec.id);
    let failure: unknown;
    try {
      await record.spec.suspend?.();
    } catch (error) {
      failure = error;
    } finally {
      this.releaseLease(record);
      this.transition(record, 'suspended');
    }
    if (failure) throw failure;
  }

  private async evictRecord(record: LifecycleRecord): Promise<void> {
    if (record.state === 'evicted') return;
    const failures: unknown[] = [];
    try {
      if (record.state === 'warm') {
        try {
          await this.suspendRecord(record);
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await record.spec.evict?.();
      } catch (error) {
        failures.push(error);
      }
    } finally {
      this.releaseLease(record);
      this.transition(record, 'evicted');
    }
    this.throwCleanupFailures(`evicting ${record.spec.id}`, failures);
  }

  /** Serialize non-activation lifecycle hooks with pressure work and disposal. */
  private runMaintenance(record: LifecycleRecord, operation: () => Promise<void>): Promise<void> {
    if (record.maintenance) return record.maintenance;
    const maintenance = Promise.resolve().then(async () => {
      if (this.disposed) return;
      await operation();
    });
    record.maintenance = maintenance;
    return maintenance.finally(() => {
      if (record.maintenance === maintenance) record.maintenance = undefined;
    });
  }

  private quarantine(record: LifecycleRecord, settled: Promise<void>, cleanup: () => Promise<void>): void {
    const quarantine = settled.then(cleanup).catch(() => {
      console.warn('[Resource] Deferred lifecycle cleanup failed.');
    });
    record.quarantine = quarantine;
    void quarantine.finally(() => {
      if (record.quarantine === quarantine) record.quarantine = undefined;
    });
  }

  private async cleanupCancelledReactivation(record: LifecycleRecord): Promise<void> {
    const failures: unknown[] = [];
    try {
      await record.spec.suspend?.();
    } catch (error) {
      failures.push(error);
    } finally {
      this.releaseLease(record);
      this.transition(record, 'suspended');
    }
    this.throwCleanupFailures(`cleaning cancelled reactivation of ${record.spec.id}`, failures);
  }

  private async cleanupCancelledActivation(
    record: LifecycleRecord,
    failedState: LifecycleResourceState,
    previous: LifecycleResourceState
  ): Promise<void> {
    const failures: unknown[] = [];
    if (failedState === 'warm') {
      try {
        await record.spec.suspend?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failedState === 'prewarming' || failedState === 'warm') {
      try {
        await record.spec.evict?.();
      } catch (error) {
        failures.push(error);
      }
    }
    this.releaseLease(record);
    this.transition(record, previous);
    this.throwCleanupFailures(`cleaning cancelled activation of ${record.spec.id}`, failures);
  }

  private async finishDeferredDisposal(record: LifecycleRecord): Promise<void> {
    if (record.state === 'evicted') return;
    const failures: unknown[] = [];
    try {
      if (record.state === 'active' || record.state === 'warm') {
        try {
          await record.spec.suspend?.();
        } catch (error) {
          failures.push(error);
        }
      }
      if (record.state !== 'cold') {
        try {
          await record.spec.evict?.();
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      this.releaseLease(record);
      this.transition(record, 'evicted');
    }
    this.throwCleanupFailures(`disposing deferred ${record.spec.id}`, failures);
  }

  private releaseLease(record: LifecycleRecord): void {
    if (!record.leaseId) return;
    const leaseId = record.leaseId;
    record.leaseId = undefined;
    this.options.releaseLease(leaseId);
  }

  private transition(record: LifecycleRecord, state: LifecycleResourceState): void {
    record.state = state;
    record.lastUsedAt = this.options.now();
    record.transitionSequence = ++this.sequence;
    this.emit();
  }

  private touch(record: LifecycleRecord): void {
    record.lastUsedAt = this.options.now();
    record.transitionSequence = ++this.sequence;
  }

  private async runSequential<T>(records: T[], operation: (record: T) => Promise<void>): Promise<void> {
    const failures: unknown[] = [];
    await records.reduce(
      (pending, record) =>
        pending.then(async () => {
          try {
            await operation(record);
          } catch (error) {
            failures.push(error);
          }
        }),
      Promise.resolve()
    );
    this.throwCleanupFailures('running lifecycle cleanup', failures);
  }

  private throwCleanupFailures(operation: string, failures: unknown[]): void {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `Multiple failures while ${operation}.`);
  }

  private publicOperationError(error: unknown): Error {
    if (
      error instanceof LifecycleResourceNotFoundError ||
      error instanceof LifecycleResourceBusyError ||
      error instanceof LifecycleOperationCancelledError ||
      error instanceof LifecycleOperationDeadlineError ||
      error instanceof LifecycleOperationFailedError ||
      (error instanceof Error && (error as { code?: unknown }).code === 'RESOURCE_REQUEST_CANCELLED')
    ) {
      return error;
    }
    return new LifecycleOperationFailedError();
  }

  private lruRecords(predicate: (record: LifecycleRecord) => boolean): LifecycleRecord[] {
    return [...this.records.values()]
      .filter(predicate)
      .toSorted(
        (a, b) =>
          a.lastUsedAt - b.lastUsedAt ||
          a.transitionSequence - b.transitionSequence ||
          a.spec.id.localeCompare(b.spec.id)
      );
  }

  private cancellationError(id: string, activation: LifecycleActivationOptions): Error {
    return activation.deadlineAt !== undefined && this.options.now() >= activation.deadlineAt
      ? new LifecycleOperationDeadlineError(id)
      : new LifecycleOperationCancelledError(id);
  }

  private throwIfCancelledOrExpired(id: string, activation: LifecycleActivationOptions): void {
    if (activation.deadlineAt !== undefined && this.options.now() >= activation.deadlineAt) {
      throw new LifecycleOperationDeadlineError(id);
    }
    if (this.disposed || activation.signal?.aborted) throw new LifecycleOperationCancelledError(id);
  }

  private requireRecord(id: string): LifecycleRecord {
    const resourceId = this.normalizeResourceId(id);
    const record = this.records.get(resourceId);
    if (!record) throw new LifecycleResourceNotFoundError(resourceId);
    return record;
  }

  private normalizeResourceId(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('Lifecycle resource id must be a string.');
    const id = value.trim();
    if (!id) throw new TypeError('Lifecycle resource id must be non-empty.');
    if (id.length > MAX_LIFECYCLE_RESOURCE_ID_LENGTH) {
      throw new RangeError(`Lifecycle resource id exceeds the ${MAX_LIFECYCLE_RESOURCE_ID_LENGTH}-character limit.`);
    }
    if (CONTROL_CHARACTER.test(id)) throw new TypeError('Lifecycle resource id must not contain control characters.');
    return id;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('Lifecycle resource pool is disposed.');
  }

  private emit(): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Snapshot listeners because callbacks may unsubscribe.
    for (const listener of [...this.listeners]) {
      if (this.disposed) return;
      try {
        listener(this.getSnapshot());
      } catch {
        console.warn('[Resource] Lifecycle listener threw.');
      }
    }
  }
}
