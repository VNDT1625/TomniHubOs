import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResourceRequestCancelledError,
  createResourceCoordinator,
  type Scheduler,
} from '@/process/resource/resourceCoordinator';
import {
  LifecycleOperationCancelledError,
  LifecycleOperationDeadlineError,
  LifecycleOperationFailedError,
  LifecycleResourceBusyError,
  LifecycleResourceCapacityError,
  LifecycleResourceNotFoundError,
  LifecycleResourcePool,
} from '@/process/resource/lifecycleResource';
import type { MachineProfile } from '@/process/resource/leaseTypes';

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
const create = (overrides: Parameters<typeof createResourceCoordinator>[0] = {}) => {
  let id = 0;
  const coordinator = createResourceCoordinator({
    probe: async () => machine,
    autoStartBalanceLoop: false,
    generateId: () => `id-${++id}`,
    store,
    ...overrides,
  });
  coordinators.push(coordinator);
  return coordinator;
};

afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.dispose()));
  vi.useRealTimers();
});

describe('ResourceCoordinator package/tab lifecycle', () => {
  it('moves active to warm and suspended while releasing the lease exactly once', async () => {
    const events: string[] = [];
    const coordinator = create({ maxWarmResources: 2 });
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'tab-a',
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 128,
      prewarm: () => events.push('prewarm'),
      activate: () => events.push('activate'),
      suspend: () => events.push('suspend'),
    });

    await coordinator.activateLifecycleResource('tab-a');
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'active', hasLease: true });
    expect(coordinator.getState().active).toHaveLength(1);
    await coordinator.deactivateLifecycleResource('tab-a');
    await coordinator.activateLifecycleResource('tab-a');
    await coordinator.deactivateLifecycleResource('tab-a');
    await coordinator.suspendLifecycleResource('tab-a');

    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'suspended', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
    expect(events).toEqual(['prewarm', 'activate', 'activate', 'suspend']);
  });

  it('suspends the least-recently-used warm resource at the configured bound', async () => {
    let now = 0;
    const suspended: string[] = [];
    const coordinator = create({ maxWarmResources: 1, now: () => now });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { browser: 2 } });
    for (const id of ['older', 'newer']) {
      coordinator.registerLifecycleResource({
        id,
        kind: 'tab',
        taskKind: 'browser',
        estCostMB: 64,
        suspend: () => suspended.push(id),
      });
    }

    await coordinator.activateLifecycleResource('older');
    now = 1;
    await coordinator.deactivateLifecycleResource('older');
    now = 2;
    await coordinator.activateLifecycleResource('newer');
    now = 3;
    await coordinator.deactivateLifecycleResource('newer');

    expect(coordinator.getLifecycleSnapshot().entries).toMatchObject([
      { id: 'newer', state: 'warm', hasLease: true },
      { id: 'older', state: 'suspended', hasLease: false },
    ]);
    expect(suspended).toEqual(['older']);
    expect(coordinator.getState().active).toHaveLength(1);
  });

  it('cancels a queued activation without creating a phantom lease', async () => {
    const coordinator = create();
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { browser: 1 } });
    const held = await coordinator.requestLease({ kind: 'browser', estCostMB: 1 });
    coordinator.registerLifecycleResource({ id: 'queued', kind: 'tab', taskKind: 'browser', estCostMB: 1 });
    const controller = new AbortController();
    const activation = coordinator.activateLifecycleResource('queued', { signal: controller.signal });
    expect(coordinator.getState().queued).toHaveLength(1);

    controller.abort();
    await expect(activation).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'cold', hasLease: false });
    expect(coordinator.getState().queued).toHaveLength(0);
    coordinator.releaseLease(held.id);
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('aborts prewarming at its deadline and releases the granted lease', async () => {
    vi.useFakeTimers();
    const coordinator = create({ now: () => Date.now() });
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'slow-package',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 32,
      prewarm: (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const activation = coordinator.activateLifecycleResource('slow-package', { deadlineAt: Date.now() + 20 });
    const deadlineResult = expect(activation).rejects.toBeInstanceOf(LifecycleOperationDeadlineError);
    await vi.advanceTimersByTimeAsync(20);

    await deadlineResult;
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'cold', hasLease: false });
  });

  it('suspends warm resources when constrained and evicts them when critical', async () => {
    let tick: (() => void) | undefined;
    let sample = { freeMemMB: 2_000, cpuLoad: 0.8 };
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const coordinator = create({ scheduler, sampler: () => sample, autoStartBalanceLoop: true });
    await coordinator.init();
    coordinator.registerLifecycleResource({ id: 'pressure-tab', kind: 'tab', taskKind: 'browser', estCostMB: 64 });
    await coordinator.activateLifecycleResource('pressure-tab');
    await coordinator.deactivateLifecycleResource('pressure-tab');

    tick?.();
    await vi.waitFor(() => expect(coordinator.getLifecycleSnapshot().entries[0].state).toBe('suspended'));
    expect(coordinator.getState().active).toHaveLength(0);
    sample = { freeMemMB: 500, cpuLoad: 0.95 };
    tick?.();
    await vi.waitFor(() => expect(coordinator.getLifecycleSnapshot().entries[0].state).toBe('evicted'));
  });

  it('blocks concurrent mutation and dispose clears an in-flight owned lease', async () => {
    let resolvePrewarm: (() => void) | undefined;
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'busy-tab',
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 64,
      prewarm: () =>
        new Promise<void>((resolve) => {
          resolvePrewarm = resolve;
        }),
    });
    const activation = coordinator.activateLifecycleResource('busy-tab');
    await vi.waitFor(() => expect(coordinator.getLifecycleSnapshot().entries[0].state).toBe('prewarming'));
    await expect(coordinator.evictLifecycleResource('busy-tab')).rejects.toBeInstanceOf(LifecycleResourceBusyError);
    resolvePrewarm?.();
    await activation;
    expect(coordinator.getState().active).toHaveLength(1);

    coordinator.dispose();
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
  });
  it('validates registrations and exposes isolated observable snapshots', async () => {
    const coordinator = create();
    await coordinator.init();
    expect(() =>
      coordinator.registerLifecycleResource({ id: ' ', kind: 'tab', taskKind: 'browser', estCostMB: 1 })
    ).toThrow(TypeError);
    expect(() =>
      coordinator.registerLifecycleResource({ id: 'x'.repeat(257), kind: 'tab', taskKind: 'browser', estCostMB: 1 })
    ).toThrow('character limit');
    expect(() =>
      coordinator.registerLifecycleResource({ id: 'line\nbreak', kind: 'tab', taskKind: 'browser', estCostMB: 1 })
    ).toThrow('control characters');
    expect(() =>
      coordinator.registerLifecycleResource({ id: 42 as never, kind: 'tab', taskKind: 'browser', estCostMB: 1 })
    ).toThrow('must be a string');
    expect(() =>
      coordinator.registerLifecycleResource({ id: 'bad', kind: 'tab', taskKind: 'browser', estCostMB: -1 })
    ).toThrow(RangeError);
    coordinator.registerLifecycleResource({ id: 'valid', kind: 'package', taskKind: 'agent', estCostMB: 1 });
    expect(() =>
      coordinator.registerLifecycleResource({ id: 'valid', kind: 'package', taskKind: 'agent', estCostMB: 1 })
    ).toThrow(LifecycleOperationFailedError);

    const observed: string[] = [];
    coordinator.onLifecycleStateChange((snapshot) => {
      snapshot.entries[0].state = 'evicted';
    });
    const unsubscribe = coordinator.onLifecycleStateChange((snapshot) => observed.push(snapshot.entries[0].state));
    await coordinator.activateLifecycleResource('valid');
    const snapshot = coordinator.getLifecycleSnapshot();
    snapshot.entries[0].state = 'evicted';
    expect(coordinator.getLifecycleSnapshot().entries[0].state).toBe('active');
    expect(observed).toContain('active');
    unsubscribe();
  });

  it('keeps listener cohorts stable and redacts observer failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const coordinator = create();
    await coordinator.init();
    const lifecycleEvents: string[] = [];
    const laterLifecycleListener = vi.fn(() => lifecycleEvents.push('later'));
    let unsubscribeFirst = () => undefined;
    unsubscribeFirst = coordinator.onLifecycleStateChange(() => {
      lifecycleEvents.push('first');
      unsubscribeFirst();
      coordinator.onLifecycleStateChange(laterLifecycleListener);
      throw new Error('private-lifecycle-snapshot');
    });
    coordinator.onLifecycleStateChange(() => lifecycleEvents.push('second'));

    coordinator.registerLifecycleResource({ id: 'listener-cohort', kind: 'tab', taskKind: 'browser', estCostMB: 1 });

    expect(lifecycleEvents).toEqual(['first', 'second']);
    expect(laterLifecycleListener).not.toHaveBeenCalled();
    await coordinator.activateLifecycleResource('listener-cohort');
    expect(laterLifecycleListener).toHaveBeenCalled();

    const stateFollower = vi.fn();
    coordinator.onStateChange(() => {
      throw new Error('private-resource-state');
    });
    coordinator.onStateChange(stateFollower);
    coordinator.setMode('detailed');

    expect(stateFollower).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain('private-lifecycle-snapshot');
    expect(logged).not.toContain('private-resource-state');

    await coordinator.dispose();
    expect(() => coordinator.onLifecycleStateChange(() => undefined)).toThrow('disposed');
  });

  it('bounds lifecycle registrations and frees capacity after removal', async () => {
    const coordinator = create({ maxLifecycleResources: 1 });
    await coordinator.init();
    coordinator.registerLifecycleResource({ id: 'first-capacity', kind: 'tab', taskKind: 'browser', estCostMB: 1 });

    expect(() =>
      coordinator.registerLifecycleResource({ id: 'second-capacity', kind: 'tab', taskKind: 'browser', estCostMB: 1 })
    ).toThrow(LifecycleResourceCapacityError);

    await coordinator.unregisterLifecycleResource('first-capacity');
    coordinator.registerLifecycleResource({ id: 'second-capacity', kind: 'tab', taskKind: 'browser', estCostMB: 1 });
    expect(coordinator.getLifecycleSnapshot().entries).toMatchObject([{ id: 'second-capacity' }]);
  });

  it('coalesces concurrent unregister calls without duplicate cleanup', async () => {
    let finishEvict: (() => void) | undefined;
    const evict = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishEvict = resolve;
        })
    );
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'unregister-once',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      evict,
    });

    const first = coordinator.unregisterLifecycleResource('unregister-once');
    const second = coordinator.unregisterLifecycleResource('unregister-once');
    await vi.waitFor(() => expect(finishEvict).toBeTypeOf('function'));
    finishEvict?.();
    await Promise.all([first, second]);

    expect(evict).toHaveBeenCalledTimes(1);
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);
  });

  it('reactivates a warm lease and fails safe when its activation hook throws', async () => {
    let shouldFail = false;
    let activations = 0;
    let suspensions = 0;
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'reactivate',
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 16,
      activate: () => {
        activations += 1;
        if (shouldFail) throw new Error('activation failed');
      },
      suspend: () => {
        suspensions += 1;
      },
    });
    await coordinator.activateLifecycleResource('reactivate');
    await coordinator.deactivateLifecycleResource('reactivate');
    shouldFail = true;

    await expect(coordinator.activateLifecycleResource('reactivate')).rejects.toBeInstanceOf(LifecycleOperationFailedError);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'suspended', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
    expect(activations).toBe(2);
    expect(suspensions).toBe(1);
    await coordinator.evictLifecycleResource('reactivate');
    await coordinator.unregisterLifecycleResource('reactivate');
    expect(coordinator.getLifecycleSnapshot().entries).toHaveLength(0);
  });
  it('fails closed for unknown, cancelled, expired, and throwing cleanup operations', async () => {
    const coordinator = create({ now: () => 100 });
    await coordinator.init();
    await expect(coordinator.activateLifecycleResource('missing')).rejects.toBeInstanceOf(
      LifecycleResourceNotFoundError
    );
    coordinator.registerLifecycleResource({ id: 'cancelled', kind: 'tab', taskKind: 'browser', estCostMB: 1 });
    await coordinator.deactivateLifecycleResource('cancelled');
    await coordinator.suspendLifecycleResource('cancelled');
    const controller = new AbortController();
    controller.abort();
    await expect(
      coordinator.activateLifecycleResource('cancelled', { signal: controller.signal })
    ).rejects.toBeInstanceOf(LifecycleOperationCancelledError);
    await expect(coordinator.activateLifecycleResource('cancelled', { deadlineAt: 100 })).rejects.toBeInstanceOf(
      LifecycleOperationDeadlineError
    );
    expect(coordinator.getState().active).toHaveLength(0);

    coordinator.registerLifecycleResource({
      id: 'cleanup-error',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      evict: () => {
        throw new Error('cleanup failed');
      },
    });
    await expect(coordinator.evictLifecycleResource('cleanup-error')).rejects.toBeInstanceOf(LifecycleOperationFailedError);
    expect(coordinator.getLifecycleSnapshot().entries.find((entry) => entry.id === 'cleanup-error')).toMatchObject({
      state: 'evicted',
      hasLease: false,
    });
  });
  it('cleans up allocated resources when cold activation fails after prewarm', async () => {
    const events: string[] = [];
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'activation-cleanup',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      prewarm: () => events.push('prewarm:allocated'),
      activate: () => {
        events.push('activate');
        throw new Error('activate failed');
      },
      suspend: () => events.push('suspend'),
      evict: () => events.push('evict'),
    });

    await expect(coordinator.activateLifecycleResource('activation-cleanup')).rejects.toBeInstanceOf(LifecycleOperationFailedError);
    expect(events).toEqual(['prewarm:allocated', 'activate', 'suspend', 'evict']);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'cold', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('does not start activation hooks when disposal wins after lease resolution', async () => {
    const events: string[] = [];
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'dispose-before-activation-hooks',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      prewarm: () => events.push('prewarm'),
      activate: () => events.push('activate'),
      suspend: () => events.push('suspend'),
      evict: () => events.push('evict'),
    });

    const activation = coordinator.activateLifecycleResource('dispose-before-activation-hooks');
    const disposal = coordinator.dispose();

    await expect(activation).rejects.toBeInstanceOf(LifecycleOperationCancelledError);
    await disposal;
    expect(events).toEqual([]);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('does not resurrect a timed-out warm activation after late completion and disposal', async () => {
    let now = 0;
    let deadline: (() => void) | undefined;
    let finishActivate: (() => void) | undefined;
    let activateCalls = 0;
    const clearTimeout = vi.fn();
    const scheduler: Scheduler = {
      setInterval: () => 0,
      clearInterval: vi.fn(),
      setTimeout: (handler) => ((deadline = handler), 0),
      clearTimeout,
    };
    const coordinator = create({ now: () => now, scheduler });
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'late-warm-activation',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      activate: () => {
        activateCalls += 1;
        if (activateCalls === 1) return;
        return new Promise<void>((resolve) => {
          finishActivate = resolve;
        });
      },
    });
    await coordinator.activateLifecycleResource('late-warm-activation');
    await coordinator.deactivateLifecycleResource('late-warm-activation');

    const activation = coordinator.activateLifecycleResource('late-warm-activation', { deadlineAt: 20 });
    await vi.waitFor(() => expect(finishActivate).toBeTypeOf('function'));
    now = 20;
    deadline?.();

    await expect(activation).rejects.toBeInstanceOf(LifecycleOperationDeadlineError);
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    const disposal = coordinator.dispose();
    finishActivate?.();
    await disposal;

    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('quarantines cleanup until an abort-ignoring activation hook settles', async () => {
    const events: string[] = [];
    let finishActivate: (() => void) | undefined;
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'uncooperative-activation',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      prewarm: () => events.push('prewarm'),
      activate: () => {
        events.push('activate');
        return new Promise<void>((resolve) => {
          finishActivate = resolve;
        });
      },
      suspend: () => events.push('suspend'),
      evict: () => events.push('evict'),
    });
    const controller = new AbortController();
    const activation = coordinator.activateLifecycleResource('uncooperative-activation', { signal: controller.signal });
    await vi.waitFor(() => expect(events).toEqual(['prewarm', 'activate']));

    controller.abort();
    await expect(activation).rejects.toBeInstanceOf(LifecycleOperationCancelledError);
    expect(events).toEqual(['prewarm', 'activate']);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'warm', hasLease: true });
    await expect(coordinator.evictLifecycleResource('uncooperative-activation')).rejects.toBeInstanceOf(
      LifecycleResourceBusyError
    );

    finishActivate?.();
    await vi.waitFor(() => expect(events).toEqual(['prewarm', 'activate', 'suspend', 'evict']));
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'cold', hasLease: false });
  });

  it('quarantines an abort-ignoring prewarm hook at its deadline before releasing its lease', async () => {
    let now = 0;
    let deadline: (() => void) | undefined;
    let finishPrewarm: (() => void) | undefined;
    const events: string[] = [];
    const scheduler: Scheduler = {
      setInterval: () => 0,
      clearInterval: vi.fn(),
      setTimeout: (handler) => ((deadline = handler), 0),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({ now: () => now, scheduler });
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'uncooperative-prewarm',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      prewarm: () => {
        events.push('prewarm');
        return new Promise<void>((resolve) => {
          finishPrewarm = resolve;
        });
      },
      evict: () => events.push('evict'),
    });

    const activation = coordinator.activateLifecycleResource('uncooperative-prewarm', { deadlineAt: 20 });
    await vi.waitFor(() => expect(finishPrewarm).toBeTypeOf('function'));
    now = 20;
    deadline?.();

    await expect(activation).rejects.toBeInstanceOf(LifecycleOperationDeadlineError);
    expect(events).toEqual(['prewarm']);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'prewarming', hasLease: true });
    expect(coordinator.getState().active).toHaveLength(1);
    await Promise.all([
      expect(coordinator.activateLifecycleResource('uncooperative-prewarm')).rejects.toBeInstanceOf(
        LifecycleResourceBusyError
      ),
      expect(coordinator.deactivateLifecycleResource('uncooperative-prewarm')).rejects.toBeInstanceOf(
        LifecycleResourceBusyError
      ),
      expect(coordinator.suspendLifecycleResource('uncooperative-prewarm')).rejects.toBeInstanceOf(
        LifecycleResourceBusyError
      ),
      expect(coordinator.evictLifecycleResource('uncooperative-prewarm')).rejects.toBeInstanceOf(
        LifecycleResourceBusyError
      ),
      expect(coordinator.unregisterLifecycleResource('uncooperative-prewarm')).rejects.toBeInstanceOf(
        LifecycleResourceBusyError
      ),
    ]);

    finishPrewarm?.();
    await vi.waitFor(() => expect(events).toEqual(['prewarm', 'evict']));
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'cold', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('waits for quarantined cleanup during disposal without concurrent lifecycle hooks', async () => {
    const events: string[] = [];
    let finishPrewarm: (() => void) | undefined;
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'dispose-after-quarantine',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      prewarm: () => {
        events.push('prewarm');
        return new Promise<void>((resolve) => {
          finishPrewarm = resolve;
        });
      },
      suspend: () => events.push('suspend'),
      evict: () => events.push('evict'),
    });
    const controller = new AbortController();
    const activation = coordinator.activateLifecycleResource('dispose-after-quarantine', { signal: controller.signal });
    await vi.waitFor(() => expect(finishPrewarm).toBeTypeOf('function'));

    controller.abort();
    await expect(activation).rejects.toBeInstanceOf(LifecycleOperationCancelledError);
    const disposal = coordinator.dispose();
    let disposed = false;
    void disposal.then(() => {
      disposed = true;
    });
    await Promise.resolve();

    expect(disposed).toBe(false);
    expect(events).toEqual(['prewarm']);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'prewarming', hasLease: true });

    finishPrewarm?.();
    await disposal;

    expect(events).toEqual(['prewarm', 'evict']);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
  });

  it('does not overlap pressure suspension with disposal cleanup', async () => {
    let tick: (() => void) | undefined;
    let releaseSuspend: (() => void) | undefined;
    let suspendCalls = 0;
    let hooksInFlight = 0;
    let peakHooksInFlight = 0;
    let evictions = 0;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const coordinator = create({
      scheduler,
      sampler: () => ({ freeMemMB: 2_000, cpuLoad: 0.8 }),
      autoStartBalanceLoop: true,
    });
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'pressure-dispose-serialization',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 8,
      suspend: () => {
        suspendCalls += 1;
        hooksInFlight += 1;
        peakHooksInFlight = Math.max(peakHooksInFlight, hooksInFlight);
        return new Promise<void>((resolve) => {
          releaseSuspend = () => {
            hooksInFlight -= 1;
            resolve();
          };
        });
      },
      evict: () => {
        evictions += 1;
      },
    });
    await coordinator.activateLifecycleResource('pressure-dispose-serialization');
    await coordinator.deactivateLifecycleResource('pressure-dispose-serialization');

    tick?.();
    await vi.waitFor(() => expect(releaseSuspend).toBeTypeOf('function'));
    const disposal = coordinator.dispose();
    await Promise.resolve();
    await Promise.resolve();

    expect(suspendCalls).toBe(1);
    expect(peakHooksInFlight).toBe(1);
    releaseSuspend?.();
    await disposal;

    expect(evictions).toBe(1);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
  });

  it('runs the evict hook even when warm suspension fails', async () => {
    const events: string[] = [];
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'evict-after-suspend-error',
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 1,
      suspend: () => {
        events.push('suspend');
        throw new Error('suspend failed');
      },
      evict: () => events.push('evict'),
    });
    await coordinator.activateLifecycleResource('evict-after-suspend-error');
    await coordinator.deactivateLifecycleResource('evict-after-suspend-error');

    await expect(coordinator.evictLifecycleResource('evict-after-suspend-error')).rejects.toBeInstanceOf(LifecycleOperationFailedError);
    expect(events).toEqual(['suspend', 'evict']);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('continues pressure cleanup after one resource hook fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let tick: (() => void) | undefined;
    const suspended: string[] = [];
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const coordinator = create({
      maxWarmResources: 2,
      scheduler,
      sampler: () => ({ freeMemMB: 2_000, cpuLoad: 0.8 }),
      autoStartBalanceLoop: true,
    });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { browser: 2 } });
    const ids = ['first', 'second'];
    for (const id of ids) {
      coordinator.registerLifecycleResource({
        id,
        kind: 'tab',
        taskKind: 'browser',
        estCostMB: 1,
        suspend: () => {
          suspended.push(id);
          if (id === 'first') throw new Error('pressure-hook-secret');
        },
      });
    }
    await Promise.all(ids.map((id) => coordinator.activateLifecycleResource(id)));
    await Promise.all(ids.map((id) => coordinator.deactivateLifecycleResource(id)));

    tick?.();
    await vi.waitFor(() => {
      expect(coordinator.getLifecycleSnapshot().entries.every((entry) => entry.state === 'suspended')).toBe(true);
    });
    expect(suspended).toEqual(['first', 'second']);
    expect(coordinator.getState().active).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    expect(
      warn.mock.calls.some((args) => args.some((arg) => String(arg).includes('pressure-hook-secret')))
    ).toBe(false);
  });

  it('awaits suspend and evict hooks during asynchronous disposal', async () => {
    const events: string[] = [];
    let finishSuspend: (() => void) | undefined;
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'async-dispose',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      suspend: async () => {
        events.push('suspend:start');
        await new Promise<void>((resolve) => {
          finishSuspend = resolve;
        });
        events.push('suspend:end');
      },
      evict: () => events.push('evict'),
    });
    await coordinator.activateLifecycleResource('async-dispose');

    const disposal = coordinator.dispose();
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
    await vi.waitFor(() => expect(events).toEqual(['suspend:start']));
    finishSuspend?.();
    await disposal;

    expect(events).toEqual(['suspend:start', 'suspend:end', 'evict']);
  });

  it('redacts disposal hook errors while releasing resources', async () => {
    const rawSecret = 'disposal-hook-secret';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const coordinator = create();
      await coordinator.init();
      coordinator.registerLifecycleResource({
        id: 'disposal-error',
        kind: 'package',
        taskKind: 'agent',
        estCostMB: 1,
        suspend: () => {
          throw new Error(rawSecret);
        },
        evict: () => {
          throw new Error(`${rawSecret}-evict`);
        },
      });
      await coordinator.activateLifecycleResource('disposal-error');

      await coordinator.dispose();

      expect(coordinator.getState().active).toHaveLength(0);
      expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
      expect(warn).toHaveBeenCalledWith('[Resource] Lifecycle disposal cleanup failed.');
      expect(warn.mock.calls.some((args) => args.some((arg) => String(arg).includes(rawSecret)))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('coalesces repeated pressure while a lifecycle hook is still running', async () => {
    let finishSuspend: (() => void) | undefined;
    const released: string[] = [];
    const pool = new LifecycleResourcePool({
      requestLease: async (request) => ({ id: 'lease-1', kind: request.kind, grantedAt: 0, estCostMB: request.estCostMB }),
      releaseLease: (id) => released.push(id),
      cancelQueuedRequest: () => false,
      maxResources: 2,
      maxWarmResources: 2,
      now: () => 0,
      generateRequestId: () => 'request-1',
      scheduleDeadline: () => 0,
      clearDeadline: () => undefined,
    });
    pool.register({
      id: 'slow-tab',
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 1,
      suspend: () =>
        new Promise<void>((resolve) => {
          finishSuspend = resolve;
        }),
    });
    await pool.activate('slow-tab');
    await pool.deactivate('slow-tab');

    const first = pool.handlePressure('constrained');
    await vi.waitFor(() => expect(finishSuspend).toBeTypeOf('function'));
    const second = pool.handlePressure('critical');

    expect(second).toBe(first);
    finishSuspend?.();
    await first;

    expect(pool.getSnapshot().entries).toMatchObject([{ id: 'slow-tab', state: 'evicted', hasLease: false }]);
    expect(released).toEqual(['lease-1']);
    await pool.dispose();
  });

  it('does not overlap stale constrained-pressure work with unregister maintenance', async () => {
    let nextLeaseId = 0;
    let finishFirstSuspend: (() => void) | undefined;
    let finishSecondSuspend: (() => void) | undefined;
    let secondSuspendCalls = 0;
    let secondEvictCalls = 0;
    const secondSuspendGate = new Promise<void>((resolve) => {
      finishSecondSuspend = resolve;
    });
    const pool = new LifecycleResourcePool({
      requestLease: async (request) => ({
        id: `lease-${++nextLeaseId}`,
        kind: request.kind,
        grantedAt: 0,
        estCostMB: request.estCostMB,
      }),
      releaseLease: () => undefined,
      cancelQueuedRequest: () => false,
      maxResources: 2,
      maxWarmResources: 2,
      now: () => 0,
      generateRequestId: () => 'request-1',
      scheduleDeadline: () => 0,
      clearDeadline: () => undefined,
    });
    pool.register({
      id: 'first-pressure-candidate',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      suspend: () =>
        new Promise<void>((resolve) => {
          finishFirstSuspend = resolve;
        }),
    });
    pool.register({
      id: 'second-pressure-candidate',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      suspend: () => {
        secondSuspendCalls += 1;
        return secondSuspendGate;
      },
      evict: () => {
        secondEvictCalls += 1;
      },
    });
    for (const id of ['first-pressure-candidate', 'second-pressure-candidate']) {
      await pool.activate(id);
      await pool.deactivate(id);
    }

    const pressure = pool.handlePressure('constrained');
    await vi.waitFor(() => expect(finishFirstSuspend).toBeTypeOf('function'));
    const unregister = pool.unregister('second-pressure-candidate');
    await vi.waitFor(() => expect(secondSuspendCalls).toBe(1));

    try {
      finishFirstSuspend?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(secondSuspendCalls).toBe(1);
      finishSecondSuspend?.();
      await Promise.all([pressure, unregister]);
      expect(secondEvictCalls).toBe(1);
      expect(pool.getSnapshot().entries).toMatchObject([{ id: 'first-pressure-candidate', state: 'suspended' }]);
    } finally {
      finishFirstSuspend?.();
      finishSecondSuspend?.();
      await Promise.allSettled([pressure, unregister]);
      await pool.dispose();
    }
  });

  it('carries critical pressure through an in-flight warm activation cleanup', async () => {
    const events: string[] = [];
    const released: string[] = [];
    let activationCalls = 0;
    let finishActivate: (() => void) | undefined;
    const pool = new LifecycleResourcePool({
      requestLease: async (request) => ({ id: 'lease-1', kind: request.kind, grantedAt: 0, estCostMB: request.estCostMB }),
      releaseLease: (id) => released.push(id),
      cancelQueuedRequest: () => false,
      maxResources: 1,
      maxWarmResources: 1,
      now: () => 0,
      generateRequestId: () => 'request-1',
      scheduleDeadline: () => 0,
      clearDeadline: () => undefined,
    });
    pool.register({
      id: 'pressure-during-activation',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      activate: (signal) => {
        activationCalls += 1;
        if (activationCalls === 1) return;
        events.push('activate');
        return new Promise<void>((resolve, reject) => {
          finishActivate = resolve;
          signal.addEventListener(
            'abort',
            () => {
              events.push('abort');
              reject(new Error('activation aborted'));
            },
            { once: true }
          );
        });
      },
      suspend: () => events.push('suspend'),
      evict: () => events.push('evict'),
    });
    await pool.activate('pressure-during-activation');
    await pool.deactivate('pressure-during-activation');
    const activation = pool.activate('pressure-during-activation');
    await vi.waitFor(() => expect(events).toEqual(['activate']));

    try {
      await pool.handlePressure('critical');
      expect(events).toEqual(['activate', 'abort', 'suspend', 'evict']);
      await expect(activation).rejects.toBeInstanceOf(LifecycleOperationCancelledError);
      expect(pool.getSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
      expect(released).toEqual(['lease-1']);
    } finally {
      finishActivate?.();
      await activation.catch(() => undefined);
      await pool.dispose();
    }
  });

  it('isolates observer and suspend-hook failures while keeping accounting safe', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'hook-error',
      kind: 'tab',
      taskKind: 'browser',
      estCostMB: 1,
      suspend: () => {
        throw new Error('suspend failed');
      },
    });
    coordinator.onLifecycleStateChange(() => {
      throw new Error('observer failed');
    });
    await coordinator.activateLifecycleResource('hook-error');
    await coordinator.activateLifecycleResource('hook-error');
    await coordinator.deactivateLifecycleResource('hook-error');

    await expect(coordinator.suspendLifecycleResource('hook-error')).rejects.toBeInstanceOf(LifecycleOperationFailedError);
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'suspended', hasLease: false });
    expect(warn).toHaveBeenCalled();
    coordinator.dispose();
    coordinator.dispose();
    expect(() =>
      coordinator.registerLifecycleResource({ id: 'after-dispose', kind: 'tab', taskKind: 'browser', estCostMB: 1 })
    ).toThrow('Lifecycle resource pool is disposed');
  });
});
