/**
 * Capability-scoped IPC access to Main-owned lifecycle resources.
 * Renderer code never chooses owner, kind, task kind, cost, or cleanup hooks.
 */

import { randomUUID } from 'node:crypto';
import { ipcBridge } from '@/common';

import {
  LifecycleOperationCancelledError,
  LifecycleOperationDeadlineError,
  LifecycleResourceBusyError,
  type LifecycleResourceKind,
  type LifecycleResourceSpec,
  type LifecycleResourceState,
} from './lifecycleResource';
import type { ResourceState } from './leaseTypes';
import { getResourceCoordinator, type IResourceCoordinator } from './resourceCoordinator';

export type TrustedLifecycleResourceSpec = Omit<LifecycleResourceSpec, 'id'> & {
  ownerId: string;
  resourceId: string;
  activationTimeoutMs?: number;
};

export type LifecycleHandleRequest = { handle: string };

export type LifecycleHandleSnapshot = {
  state: LifecycleResourceState;
  hasLease: boolean;
  lastUsedAt: number;
  transitionSequence: number;
};

export class LifecycleIpcError extends Error {
  constructor(
    readonly code:
      | 'LIFECYCLE_BRIDGE_INACTIVE'
      | 'LIFECYCLE_HANDLE_INVALID'
      | 'LIFECYCLE_OPERATION_BUSY'
      | 'LIFECYCLE_OPERATION_CANCELLED'
      | 'LIFECYCLE_OPERATION_DEADLINE'
      | 'LIFECYCLE_OPERATION_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'LifecycleIpcError';
  }
}

type OwnedResource = {
  handle: string;
  coordinatorId: string;
  ownerId: string;
  resourceId: string;
  kind: LifecycleResourceKind;
  coordinator: IResourceCoordinator;
  activationTimeoutMs: number;
};

type TrackedActivation = {
  controller: AbortController;
  operation: Promise<LifecycleHandleSnapshot>;
};

const DEFAULT_ACTIVATION_TIMEOUT_MS = 30_000;
const MAX_ACTIVATION_TIMEOUT_MS = 5 * 60_000;
const MAX_SCOPE_LENGTH = 128;
const MAX_RENDERER_ADJUSTMENTS = 50;
const MAX_RENDERER_REASON_LENGTH = 256;
const NON_PRINTABLE_CHARACTER = /[\p{Cc}\p{Cf}]/u;

let unsubscribeStateChange: (() => void) | undefined;

let activeCoordinator: IResourceCoordinator | undefined;
let bridgeActive = false;
const resourcesByHandle = new Map<string, OwnedResource>();
const handlesByCoordinatorId = new Map<string, string>();
const activations = new Map<string, TrackedActivation>();

const normalizeToken = (value: string, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const characters = [...normalized];
  if (
    !normalized ||
    characters.length > MAX_SCOPE_LENGTH ||
    characters.some((character) => NON_PRINTABLE_CHARACTER.test(character))
  ) {
    throw new TypeError(`${label} must be 1-${MAX_SCOPE_LENGTH} printable characters.`);
  }
  return normalized;
};

const coordinatorIdFor = (ownerId: string, kind: LifecycleResourceKind, resourceId: string): string =>
  `owner:${encodeURIComponent(ownerId)}:${kind}:${encodeURIComponent(resourceId)}`;

const requireBridge = (): IResourceCoordinator => {
  if (!bridgeActive || !activeCoordinator) {
    throw new LifecycleIpcError('LIFECYCLE_BRIDGE_INACTIVE', 'Resource lifecycle bridge is not active.');
  }
  return activeCoordinator;
};

const requireLifecycleHandle = (request: LifecycleHandleRequest): string => {
  if (!request || typeof request !== 'object' || typeof request.handle !== 'string') {
    throw new LifecycleIpcError('LIFECYCLE_HANDLE_INVALID', 'Lifecycle capability is invalid.');
  }
  return request.handle;
};

const requireOwnedResource = (handle: string): OwnedResource => {
  requireBridge();
  const resource = resourcesByHandle.get(handle);
  if (!resource || resource.coordinator !== activeCoordinator) {
    throw new LifecycleIpcError('LIFECYCLE_HANDLE_INVALID', 'Lifecycle capability is invalid.');
  }
  return resource;
};

const limitText = (value: string): string => value.slice(0, MAX_RENDERER_REASON_LENGTH);

/**
 * Return a bounded dashboard projection. Renderer code only displays aggregate
 * activity, so opaque lease/request identifiers and unbounded history are not
 * exposed across the process boundary.
 */
const toRendererState = (state: ResourceState): ResourceState => ({
  ...state,
  active: state.active.map(({ owner: _owner, ...lease }) => ({ ...lease, id: '' })),
  queued: state.queued.map(({ owner: _owner, ...task }) => ({
    ...task,
    requestId: '',
    reason: limitText(task.reason),
  })),
  lastAdjustments: state.lastAdjustments.slice(-MAX_RENDERER_ADJUSTMENTS).map((adjustment) => ({
    ...adjustment,
    reason: limitText(adjustment.reason),
  })),
  resourceReason: state.resourceReason
    ? { ...state.resourceReason, message: limitText(state.resourceReason.message) }
    : undefined,
});

const snapshotFor = (resource: OwnedResource): LifecycleHandleSnapshot => {
  const entry = resource.coordinator
    .getLifecycleSnapshot()
    .entries.find((candidate) => candidate.id === resource.coordinatorId);
  if (!entry) throw new LifecycleIpcError('LIFECYCLE_HANDLE_INVALID', 'Lifecycle capability is invalid.');
  return {
    state: entry.state,
    hasLease: entry.hasLease,
    lastUsedAt: entry.lastUsedAt,
    transitionSequence: entry.transitionSequence,
  };
};

const throwPublicOperationError = (error: unknown): never => {
  if (error instanceof LifecycleResourceBusyError) {
    throw new LifecycleIpcError('LIFECYCLE_OPERATION_BUSY', 'Lifecycle resource is busy.');
  }
  if (error instanceof LifecycleOperationCancelledError) {
    throw new LifecycleIpcError('LIFECYCLE_OPERATION_CANCELLED', 'Lifecycle operation was cancelled.');
  }
  if (error instanceof LifecycleOperationDeadlineError) {
    throw new LifecycleIpcError('LIFECYCLE_OPERATION_DEADLINE', 'Lifecycle operation exceeded its deadline.');
  }
  throw new LifecycleIpcError('LIFECYCLE_OPERATION_FAILED', 'Lifecycle operation failed.');
};

/** Main-only registration. The trusted owner fixes policy before a handle reaches renderer code. */
export const registerOwnedLifecycleResource = (
  spec: TrustedLifecycleResourceSpec,
  coordinator: IResourceCoordinator = activeCoordinator ?? getResourceCoordinator()
): string => {
  if (activeCoordinator && coordinator !== activeCoordinator) {
    throw new Error('Lifecycle resources must use the active ResourceCoordinator.');
  }
  const ownerId = normalizeToken(spec.ownerId, 'ownerId');
  const resourceId = normalizeToken(spec.resourceId, 'resourceId');
  if (spec.kind !== 'package' && spec.kind !== 'tab') throw new TypeError('Lifecycle kind must be package or tab.');
  const coordinatorId = coordinatorIdFor(ownerId, spec.kind, resourceId);
  if (handlesByCoordinatorId.has(coordinatorId)) throw new Error('Lifecycle owner resource is already registered.');
  const requestedTimeoutMs = spec.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
  if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
    throw new RangeError('Lifecycle activation timeout must be finite and positive.');
  }
  const activationTimeoutMs = Math.min(MAX_ACTIVATION_TIMEOUT_MS, Math.max(1, Math.round(requestedTimeoutMs)));
  const handle = randomUUID();
  const owned: OwnedResource = {
    handle,
    coordinatorId,
    ownerId,
    resourceId,
    kind: spec.kind,
    coordinator,
    activationTimeoutMs,
  };
  resourcesByHandle.set(handle, owned);
  handlesByCoordinatorId.set(coordinatorId, handle);
  try {
    coordinator.registerLifecycleResource({
      id: coordinatorId,
      kind: spec.kind,
      taskKind: spec.taskKind,
      estCostMB: spec.estCostMB,
      prewarm: spec.prewarm,
      activate: spec.activate,
      suspend: spec.suspend,
      evict: spec.evict,
    });
  } catch (error) {
    resourcesByHandle.delete(handle);
    handlesByCoordinatorId.delete(coordinatorId);
    throw error;
  }
  return handle;
};

export const suspendOwnedLifecycleResource = async (handle: string): Promise<void> => {
  const resource = resourcesByHandle.get(handle);
  if (!resource) throw new LifecycleIpcError('LIFECYCLE_HANDLE_INVALID', 'Lifecycle capability is invalid.');
  await resource.coordinator.suspendLifecycleResource(resource.coordinatorId);
};

export const evictOwnedLifecycleResource = async (handle: string): Promise<void> => {
  const resource = resourcesByHandle.get(handle);
  if (!resource) throw new LifecycleIpcError('LIFECYCLE_HANDLE_INVALID', 'Lifecycle capability is invalid.');
  await resource.coordinator.evictLifecycleResource(resource.coordinatorId);
};

export const unregisterOwnedLifecycleResource = async (handle: string): Promise<void> => {
  const resource = resourcesByHandle.get(handle);
  if (!resource) throw new LifecycleIpcError('LIFECYCLE_HANDLE_INVALID', 'Lifecycle capability is invalid.');
  await resource.coordinator.unregisterLifecycleResource(resource.coordinatorId);
  resourcesByHandle.delete(handle);
  handlesByCoordinatorId.delete(resource.coordinatorId);
};

const registerLifecycleProviders = (coordinator: IResourceCoordinator): void => {
  ipcBridge.resource.activateLifecycle.provider((request) => {
    const handle = requireLifecycleHandle(request);
    const resource = requireOwnedResource(handle);
    if (activations.has(handle)) {
      throw new LifecycleIpcError('LIFECYCLE_OPERATION_BUSY', 'Lifecycle resource is busy.');
    }
    const controller = new AbortController();
    const operation = coordinator
      .activateLifecycleResource(resource.coordinatorId, {
        signal: controller.signal,
        deadlineAt: Date.now() + resource.activationTimeoutMs,
      })
      .then(() => snapshotFor(resource))
      .catch(throwPublicOperationError)
      .finally(() => {
        if (activations.get(handle)?.operation === operation) activations.delete(handle);
      });
    activations.set(handle, { controller, operation });
    return operation;
  });

  ipcBridge.resource.deactivateLifecycle.provider(async (request) => {
    const resource = requireOwnedResource(requireLifecycleHandle(request));
    try {
      await coordinator.deactivateLifecycleResource(resource.coordinatorId);
    } catch (error) {
      throwPublicOperationError(error);
    }
  });
  ipcBridge.resource.getLifecycleResource.provider((request) =>
    Promise.resolve(snapshotFor(requireOwnedResource(requireLifecycleHandle(request))))
  );
};

/** Register state channels and capability-only lifecycle handlers. */
export function registerResourceBridge(coordinator: IResourceCoordinator = getResourceCoordinator()): void {
  if ([...resourcesByHandle.values()].some((resource) => resource.coordinator !== coordinator)) {
    throw new Error('Cannot replace ResourceCoordinator while lifecycle capabilities are registered.');
  }
  activeCoordinator = coordinator;
  bridgeActive = true;

  ipcBridge.resource.getState.provider(() => Promise.resolve(toRendererState(requireBridge().getState())));
  ipcBridge.resource.setMode.provider(({ mode }) => {
    const active = requireBridge();
    active.setMode(mode);
    return Promise.resolve(toRendererState(active.getState()));
  });
  ipcBridge.resource.setBudget.provider(({ budget }) => {
    const active = requireBridge();
    try {
      active.setBudget(budget);
    } catch {
      throw new TypeError('Resource budget is invalid.');
    }
    return Promise.resolve(toRendererState(active.getState()));
  });
  ipcBridge.resource.applyPreset.provider(({ preset }) => {
    const active = requireBridge();
    active.applyPreset(preset);
    return Promise.resolve(toRendererState(active.getState()));
  });
  registerLifecycleProviders(coordinator);

  unsubscribeStateChange?.();

  unsubscribeStateChange = coordinator.onStateChange((state) => {
    // Coordinator dispatch is intentionally snapshot-based, so this callback
    // can run after it was unsubscribed by bridge teardown or replacement.
    if (!bridgeActive || activeCoordinator !== coordinator) return;
    ipcBridge.resource.stateChanged.emit(toRendererState(state));
  });
}

/** Abort activations and retryably drain every Main-owned lifecycle resource. */
export async function disposeResourceBridge(): Promise<void> {
  bridgeActive = false;
  unsubscribeStateChange?.();

  unsubscribeStateChange = undefined;

  for (const activation of activations.values()) activation.controller.abort();
  await Promise.allSettled([...activations.values()].map(({ operation }) => operation));
  activations.clear();

  const results = await Promise.allSettled(
    [...resourcesByHandle.values()]
      .toSorted((a, b) => a.handle.localeCompare(b.handle))
      .map(async (resource) => {
        const entry = resource.coordinator
          .getLifecycleSnapshot()
          .entries.find((candidate) => candidate.id === resource.coordinatorId);
        if (entry?.state === 'active') await resource.coordinator.deactivateLifecycleResource(resource.coordinatorId);
        await unregisterOwnedLifecycleResource(resource.handle);
      })
  );
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0) {
    activeCoordinator ??= resourcesByHandle.values().next().value?.coordinator;
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, 'Multiple lifecycle resources failed bridge disposal.');
  }

  activeCoordinator = undefined;
}
