import { afterEach, describe, expect, it, vi } from 'vitest';

const bridgeHarness = vi.hoisted(() => {
  const handlers = new Map<string, (request: unknown) => unknown>();

  const provider = (name: string) => ({
    provider: vi.fn((handler: (request: unknown) => unknown) => handlers.set(name, handler)),
  });
  const emitter = () => ({ emit: vi.fn() });
  return {
    handlers,

    resource: {
      getState: provider('getState'),
      setMode: provider('setMode'),
      setBudget: provider('setBudget'),
      applyPreset: provider('applyPreset'),
      activateLifecycle: provider('activateLifecycle'),
      deactivateLifecycle: provider('deactivateLifecycle'),
      getLifecycleResource: provider('getLifecycleResource'),
      stateChanged: emitter(),
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: { resource: bridgeHarness.resource } }));

import {
  LifecycleIpcError,
  disposeResourceBridge,
  evictOwnedLifecycleResource,
  registerOwnedLifecycleResource,
  registerResourceBridge,
  suspendOwnedLifecycleResource,
  unregisterOwnedLifecycleResource,
  type LifecycleHandleSnapshot,
} from '@/process/resource/resourceBridge';
import { createResourceCoordinator } from '@/process/resource/resourceCoordinator';
import type { MachineProfile, ResourceState } from '@/process/resource/leaseTypes';

const machine: MachineProfile = {
  totalMemMB: 16_000,
  cpuCores: 8,
  hasDiscreteGPU: false,
  freeDiskMB: 100_000,
};

const store = {
  dir: 'memory',
  fs: {
    readFile: vi.fn(async () => {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
  },
};

const coordinators: ReturnType<typeof createResourceCoordinator>[] = [];
const create = async () => {
  let id = 0;
  const coordinator = createResourceCoordinator({
    probe: async () => machine,
    autoStartBalanceLoop: false,
    generateId: () => `bridge-${++id}`,
    store,
  });
  coordinators.push(coordinator);
  await coordinator.init();
  coordinator.setBudget({ maxConcurrent: { browser: 2 } });
  return coordinator;
};

const invoke = async <TResult>(name: string, request: unknown): Promise<TResult> => {
  const handler = bridgeHarness.handlers.get(name);
  if (!handler) throw new Error(`Missing provider: ${name}`);
  return (await handler(request)) as TResult;
};

const registerTab = (
  coordinator: Awaited<ReturnType<typeof create>>,
  ownerId: string,
  resourceId: string,
  hooks = {}
) =>
  registerOwnedLifecycleResource(
    {
      ownerId,
      resourceId,
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 32,
      ...hooks,
    },
    coordinator
  );

afterEach(async () => {
  try {
    await disposeResourceBridge();
  } catch {
    await disposeResourceBridge();
  }
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.dispose()));
  bridgeHarness.handlers.clear();
  vi.clearAllMocks();
});

describe('Resource lifecycle capability bridge', () => {
  it('maps capability-only activate, deactivate, and deterministic get-one polling', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    const ownerB = registerTab(coordinator, 'owner-b', 'shared');
    const ownerA = registerTab(coordinator, 'owner-a', 'shared');

    const activated = await invoke<LifecycleHandleSnapshot>('activateLifecycle', { handle: ownerA });
    expect(activated).toMatchObject({ state: 'active', hasLease: true });
    expect(activated).not.toHaveProperty('ownerId');
    expect(activated).not.toHaveProperty('handle');
    expect(await invoke('getLifecycleResource', { handle: ownerA })).toEqual(activated);
    expect(await invoke('getLifecycleResource', { handle: ownerB })).toMatchObject({ state: 'cold', hasLease: false });

    await invoke<void>('deactivateLifecycle', { handle: ownerA });
    expect(await invoke('getLifecycleResource', { handle: ownerA })).toMatchObject({ state: 'warm', hasLease: true });
    await disposeResourceBridge();
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);
  });

  it('does not expose renderer registration or accept guessed and cross-resource handles', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    const handle = registerTab(coordinator, 'trusted-owner', 'trusted-resource');

    expect(bridgeHarness.resource).not.toHaveProperty('registerLifecycle');
    expect(bridgeHarness.resource).not.toHaveProperty('suspendLifecycle');
    expect(bridgeHarness.resource).not.toHaveProperty('evictLifecycle');
    expect(bridgeHarness.resource).not.toHaveProperty('unregisterLifecycle');
    expect(bridgeHarness.resource).not.toHaveProperty('subscribeLifecycle');
    expect(bridgeHarness.resource).not.toHaveProperty('unsubscribeLifecycle');
    expect(bridgeHarness.resource).not.toHaveProperty('lifecycleChanged');
    await expect(invoke('activateLifecycle', { handle: `${handle}-guessed` })).rejects.toMatchObject({
      code: 'LIFECYCLE_HANDLE_INVALID',
    });
  });

  it('rejects invalid config payloads and stale providers after bridge teardown', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);

    await expect(invoke('setMode', { mode: 'automatic' })).rejects.toThrow('mode must be detailed or suggest');
    expect(coordinator.getState().mode).toBe('suggest');

    await disposeResourceBridge();

    await expect(invoke('getState', undefined)).rejects.toMatchObject({ code: 'LIFECYCLE_BRIDGE_INACTIVE' });
    await expect(invoke('setBudget', { budget: { maxTotalMemoryMB: 1 } })).rejects.toMatchObject({
      code: 'LIFECYCLE_BRIDGE_INACTIVE',
    });
    expect(coordinator.getState().budget.maxTotalMemoryMB).toBeGreaterThan(1);
  });

  it('sanitizes invalid budget errors without reflecting caller-controlled fields', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    const originalBudget = coordinator.getState().budget;
    const privateField = 'private-secret-budget-key';
    const invalidBudgets: unknown[] = [
      { maxTotalMemoryMB: Number.NaN },
      { reserveForUserMB: Number.POSITIVE_INFINITY },
      { maxConcurrent: { agent: -1 } },
      { maxConcurrent: { [privateField]: 1 } },
    ];

    for (const budget of invalidBudgets) {
      await expect(invoke('setBudget', { budget })).rejects.toMatchObject({
        message: 'Resource budget is invalid.',
      });
    }
    expect(coordinator.getState().budget).toEqual(originalBudget);
  });

  it('does not emit a state snapshot after teardown races an in-progress coordinator dispatch', async () => {
    const coordinator = await create();
    let teardown: Promise<void> | undefined;
    coordinator.onStateChange(() => {
      teardown = disposeResourceBridge();
    });
    registerResourceBridge(coordinator);

    coordinator.setMode('detailed');
    await teardown;

    expect(bridgeHarness.resource.stateChanged.emit).not.toHaveBeenCalled();
  });

  it('redacts caller-controlled identifiers and owner metadata from renderer snapshots', async () => {
    const coordinator = await create();
    coordinator.setBudget({ maxConcurrent: { agent: 1 } });
    registerResourceBridge(coordinator);
    const held = await coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      owner: { processKind: 'worker', serviceId: 'private-service', taskId: 'private-active-task' },
    });
    const queued = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'caller-metadata-must-not-cross-the-bridge',
      owner: { processKind: 'worker', serviceId: 'private-service', taskId: 'private-queued-task' },
    });

    const emitted = bridgeHarness.resource.stateChanged.emit.mock.calls.at(-1)?.[0];
    const snapshot = await invoke<ResourceState>('getState', undefined);

    expect(emitted).toMatchObject({
      active: [expect.objectContaining({ id: '' })],
      queued: [expect.objectContaining({ requestId: '' })],
    });
    expect(emitted.active[0]).not.toHaveProperty('owner');
    expect(emitted.queued[0]).not.toHaveProperty('owner');
    expect(snapshot.active[0]?.id).toBe('');
    expect(snapshot.active[0]).not.toHaveProperty('owner');
    expect(snapshot.queued[0]?.requestId).toBe('');
    expect(snapshot.queued[0]).not.toHaveProperty('owner');
    const cancelled = expect(queued).rejects.toMatchObject({ code: 'RESOURCE_REQUEST_CANCELLED' });
    coordinator.cancelQueuedRequest('caller-metadata-must-not-cross-the-bridge');
    await cancelled;
    coordinator.releaseLease(held.id);
  });

  it('rejects duplicate activation before replacing the abortable tracked operation', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    const handle = registerTab(coordinator, 'race-owner', 'slow', {
      prewarm: (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const first = invoke<LifecycleHandleSnapshot>('activateLifecycle', { handle });
    await vi.waitFor(() => expect(coordinator.getLifecycleSnapshot().entries[0].state).toBe('prewarming'));

    await expect(invoke('activateLifecycle', { handle })).rejects.toMatchObject({
      code: 'LIFECYCLE_OPERATION_BUSY',
    });
    const disposal = disposeResourceBridge();
    await expect(first).rejects.toBeInstanceOf(LifecycleIpcError);
    await disposal;

    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);
  });

  it('keeps suspend, evict, unregister, and policy selection in trusted Main code', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    const handle = registerOwnedLifecycleResource(
      {
        ownerId: 'main-owner',
        resourceId: 'main-package',
        kind: 'package',
        taskKind: 'agent',
        estCostMB: 64,
      },
      coordinator
    );

    await invoke<LifecycleHandleSnapshot>('activateLifecycle', { handle });
    await invoke<void>('deactivateLifecycle', { handle });
    await suspendOwnedLifecycleResource(handle);
    await invoke<LifecycleHandleSnapshot>('activateLifecycle', { handle });
    await invoke<void>('deactivateLifecycle', { handle });
    await evictOwnedLifecycleResource(handle);
    await unregisterOwnedLifecycleResource(handle);

    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);
    await expect(unregisterOwnedLifecycleResource(handle)).rejects.toMatchObject({
      code: 'LIFECYCLE_HANDLE_INVALID',
    });
  });

  it('rejects malformed lifecycle ids with fixed errors before touching the pool', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    const registerLifecycle = vi.spyOn(coordinator, 'registerLifecycleResource');
    const invalidResourceIds: unknown[] = ['private\u0085secret', 'private\u202Esecret', 'x'.repeat(129), undefined];

    for (const resourceId of invalidResourceIds) {
      let error: unknown;
      try {
        registerTab(coordinator, 'stable-owner', resourceId as string);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ message: 'resourceId must be 1-128 printable characters.' });
    }
    expect(registerLifecycle).not.toHaveBeenCalled();
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);

    const handle = registerTab(coordinator, 'stable-owner', '測試-🚀');
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(1);
    for (const request of [undefined, null, {}, { handle: 'private-unknown-handle' }]) {
      await expect(invoke('getLifecycleResource', request)).rejects.toMatchObject({
        code: 'LIFECYCLE_HANDLE_INVALID',
        message: 'Lifecycle capability is invalid.',
      });
    }
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(1);
    await unregisterOwnedLifecycleResource(handle);
  });

  it('validates trusted policy and refuses coordinator replacement with live capabilities', async () => {
    const coordinator = await create();
    const anotherCoordinator = await create();
    registerResourceBridge(coordinator);
    registerTab(coordinator, 'stable-owner', 'stable-resource');

    expect(() => registerTab(coordinator, 'stable-owner', 'stable-resource')).toThrow('already registered');
    expect(() =>
      registerOwnedLifecycleResource(
        {
          ownerId: 'bad-timeout',
          resourceId: 'resource',
          kind: 'tab',
          taskKind: 'browser',
          estCostMB: 1,
          activationTimeoutMs: 0,
        },
        coordinator
      )
    ).toThrow('finite and positive');
    expect(() =>
      registerOwnedLifecycleResource(
        {
          ownerId: 'bad-kind',
          resourceId: 'resource',
          kind: 'worker' as 'tab',
          taskKind: 'browser',
          estCostMB: 1,
        },
        coordinator
      )
    ).toThrow('package or tab');
    expect(() => registerTab(anotherCoordinator, 'other-owner', 'resource')).toThrow('active ResourceCoordinator');
    expect(() => registerResourceBridge(anotherCoordinator)).toThrow('Cannot replace ResourceCoordinator');
  });

  it('retains failed cleanup identities so disposal can be retried without a lease leak', async () => {
    const coordinator = await create();
    registerResourceBridge(coordinator);
    let failures = 1;
    const handle = registerTab(coordinator, 'retry-owner', 'cleanup', {
      evict: () => {
        if (failures-- > 0) throw new Error('evict failed once');
      },
    });
    await invoke<LifecycleHandleSnapshot>('activateLifecycle', { handle });

    await expect(disposeResourceBridge()).rejects.toThrow('Lifecycle operation failed.');
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(1);

    await disposeResourceBridge();
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);
  });
});
