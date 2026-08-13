import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResourceQueueFullError,
  ResourceRequestCancelledError,
  ResourceRequestDeadlineError,
  createResourceCoordinator,
  type Scheduler,
} from '@/process/resource/resourceCoordinator';
import type { ResourceSample } from '@/process/resource/balancePolicy';
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

afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose();
  vi.useRealTimers();
});

describe('ResourceCoordinator correctness', () => {
  it('queues pre-init requests and grants them only after machine initialization', async () => {
    const coordinator = create();
    const pending = coordinator.requestLease({ kind: 'agent', estCostMB: 128, requestId: 'startup-request' });

    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getState().queued).toEqual([
      expect.objectContaining({ requestId: 'startup-request', reason: 'coordinator-initializing' }),
    ]);

    await coordinator.init();
    const lease = await pending;
    expect(lease.kind).toBe('agent');
    expect(coordinator.getState().active).toContainEqual(expect.objectContaining({ id: lease.id }));
    coordinator.releaseLease(lease.id);
  });

  it('keeps active accounting intact when init is called again', async () => {
    const coordinator = create();
    await coordinator.init();
    const lease = await coordinator.requestLease({ kind: 'agent', estCostMB: 64 });

    await coordinator.init();

    expect(coordinator.getState().active).toContainEqual(expect.objectContaining({ id: lease.id, estCostMB: 64 }));
    coordinator.releaseLease(lease.id);
  });

  it('coalesces concurrent initialization into one machine probe', async () => {
    const probe = vi.fn(async () => machine);
    const coordinator = create({ probe });

    const [first, second] = await Promise.all([coordinator.init(), coordinator.init()]);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(first.machine).toEqual(machine);
    expect(second).toEqual(first);
  });

  it('retries initialization after a shared initialization failure', async () => {
    let attempts = 0;
    const failure = new Error('probe failed');
    const probe = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw failure;
      return machine;
    });
    const coordinator = create({ probe });

    const failed = await Promise.allSettled([coordinator.init(), coordinator.init()]);
    expect(failed).toEqual([
      expect.objectContaining({ status: 'rejected', reason: failure }),
      expect.objectContaining({ status: 'rejected', reason: failure }),
    ]);

    await expect(coordinator.init()).resolves.toMatchObject({ machine });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('stays disposed when an in-flight initialization resolves late', async () => {
    let resolveProbe: ((profile: MachineProfile) => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({
      probe: () =>
        new Promise<MachineProfile>((resolve) => {
          resolveProbe = resolve;
        }),
      scheduler,
      autoStartBalanceLoop: true,
    });

    const initializing = coordinator.init();
    await coordinator.dispose();
    resolveProbe?.(machine);

    await expect(initializing).rejects.toThrow('disposed');
    expect(scheduler.setInterval).not.toHaveBeenCalled();
    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1 })).rejects.toThrow('disposed');
  });

  it('clears direct and lifecycle-owned leases during disposal', async () => {
    const coordinator = create();
    await coordinator.init();
    await coordinator.requestLease({ kind: 'agent', estCostMB: 8, requestId: 'direct-disposal' });
    coordinator.registerLifecycleResource({
      id: 'lifecycle-disposal',
      kind: 'package',
      taskKind: 'browser',
      estCostMB: 8,
    });
    await coordinator.activateLifecycleResource('lifecycle-disposal');
    expect(coordinator.getState().active).toHaveLength(2);

    await coordinator.dispose();

    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getLifecycleSnapshot().entries[0]).toMatchObject({ state: 'evicted', hasLease: false });
  });

  it('isolates listener snapshots and keeps the current observer cohort stable', async () => {
    const coordinator = create();
    await coordinator.init();
    const laterListener = vi.fn();
    const secondListener = vi.fn((state: ResourceState) => {
      expect(state.budget.maxConcurrent.agent).toBe(2);
    });
    let unsubscribeSecond = () => undefined;
    coordinator.onStateChange((state) => {
      state.budget.maxConcurrent.agent = 0;
      unsubscribeSecond();
      coordinator.onStateChange(laterListener);
    });
    unsubscribeSecond = coordinator.onStateChange(secondListener);

    coordinator.setBudget({ maxConcurrent: { agent: 2 } });

    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(laterListener).not.toHaveBeenCalled();
    expect(coordinator.getState().budget.maxConcurrent.agent).toBe(2);
  });

  it('isolates nested state snapshots from caller and listener mutation', async () => {
    let tick: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({
      scheduler,
      sampler: () => ({ freeMemMB: 500, cpuLoad: 0.95 }),
      autoStartBalanceLoop: true,
    });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 3 } });
    tick?.();
    await vi.waitFor(() => expect(coordinator.getState().lastAdjustments).toHaveLength(1));

    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    coordinator.onStateChange((state) => {
      if (state.effectiveLimits?.agent?.reason) {
        state.effectiveLimits.agent.reason.message = 'listener mutation';
      }
    });
    coordinator.setBudget({ maxConcurrent: { agent: 2 }, maxTotalMemoryMB: 1 });
    const queued = coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'snapshot-queue' });
    const queuedResult = expect(queued).rejects.toBeInstanceOf(ResourceRequestCancelledError);

    const snapshot = coordinator.getState();
    snapshot.machine.cpuCores = 0;
    snapshot.budget.maxConcurrent.agent = 0;
    snapshot.active[0].estCostMB = 99;
    snapshot.queued[0].reason = 'caller mutation';
    snapshot.lastAdjustments[0].from.maxTotalMemoryMB = 0;
    snapshot.resourceReason!.message = 'caller mutation';
    snapshot.effectiveLimits!.agent!.reason!.message = 'caller mutation';

    const fresh = coordinator.getState();
    expect(fresh.machine.cpuCores).toBe(machine.cpuCores);
    expect(fresh.budget.maxConcurrent.agent).toBe(2);
    expect(fresh.active[0].estCostMB).toBe(1);
    expect(fresh.queued[0].reason).not.toBe('caller mutation');
    expect(fresh.lastAdjustments[0].from.maxTotalMemoryMB).not.toBe(0);
    expect(fresh.resourceReason?.message).not.toBe('caller mutation');
    expect(fresh.effectiveLimits?.agent?.reason?.message).not.toBe('listener mutation');
    expect(fresh.effectiveLimits?.agent?.reason?.message).not.toBe('caller mutation');

    expect(coordinator.cancelQueuedRequest('snapshot-queue')).toBe(true);
    await queuedResult;
    coordinator.releaseLease(held.id);
  });

  it('stops remaining callback delivery when a listener disposes the coordinator', async () => {
    const coordinator = create();
    await coordinator.init();
    const laterListener = vi.fn();
    let disposal: Promise<void> | undefined;
    coordinator.onStateChange(() => {
      disposal = coordinator.dispose();
    });
    coordinator.onStateChange(laterListener);

    coordinator.setBudget({ maxConcurrent: { agent: 2 } });
    await disposal;

    expect(laterListener).not.toHaveBeenCalled();
  });

  it('clamps a structurally valid restored budget to the live machine', async () => {
    const persisted = {
      machine,
      mode: 'suggest',
      preset: 'performance',
      budget: {
        maxConcurrent: {
          agent: 99,
          browser: 99,
          emulator: 99,
          windowsTest: 99,
          patchBuild: 99,
          ocr: 99,
          transcription: 99,
          docConvert: 99,
          semanticIndex: 99,
        },
        maxTotalMemoryMB: 99_999,
        reserveForUserMB: 0,
      },
      active: [],
      queued: [],
      lastAdjustments: [],
    };
    const coordinator = create({
      store: {
        dir: 'C:\\resource-state',
        fs: { ...store, readFile: vi.fn(async () => JSON.stringify(persisted)) },
      },
    });

    await coordinator.init();

    expect(coordinator.getState().budget).toMatchObject({ maxConcurrent: { agent: 8 }, maxTotalMemoryMB: 16_000 });
  });

  it('bounds restored adjustment history while retaining the newest automatic change', async () => {
    let tick: (() => void) | undefined;
    const now = 1_000_000;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const budget = {
      maxConcurrent: {
        agent: 2,
        browser: 2,
        emulator: 2,
        windowsTest: 2,
        patchBuild: 2,
        ocr: 2,
        transcription: 2,
        docConvert: 2,
        semanticIndex: 2,
      },
      maxTotalMemoryMB: 12_000,
      reserveForUserMB: 1_024,
    };
    const adjustment = { at: 0, reason: 'archived', from: budget, to: budget };
    const persisted = {
      machine,
      mode: 'suggest' as const,
      preset: 'balanced' as const,
      budget,
      active: [],
      queued: [],
      lastAdjustments: Array.from({ length: 101 }, () => adjustment),
    };
    const coordinator = create({
      now: () => now,
      scheduler,
      sampler: () => ({ freeMemMB: 500, cpuLoad: 0.95 }),
      autoStartBalanceLoop: true,
      store: {
        ...store,
        fs: {
          ...store.fs,
          readFile: vi.fn(async () => JSON.stringify(persisted)),
        },
      },
    });
    await coordinator.init();
    expect(coordinator.getState().lastAdjustments).toHaveLength(100);

    tick?.();
    await vi.waitFor(() => expect(coordinator.getState().lastAdjustments.at(-1)?.at).toBe(now));
    expect(coordinator.getState().lastAdjustments).toHaveLength(100);
  });

  it('rejects configuration changes after disposal', async () => {
    const coordinator = create();
    await coordinator.init();
    await coordinator.dispose();

    expect(() => coordinator.setMode('manual')).toThrow('disposed');
    expect(() => coordinator.setBudget({ maxTotalMemoryMB: 1 })).toThrow('disposed');
    expect(() => coordinator.applyPreset('balanced')).toThrow('disposed');
    expect(() => coordinator.registerIdleHook('agent', () => undefined)).toThrow('disposed');
    expect(() => coordinator.onStateChange(() => undefined)).toThrow('disposed');
  });

  it('does not re-arm idle work when a lease is released after disposal', async () => {
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({ scheduler });
    await coordinator.init();
    const lease = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    coordinator.registerIdleHook('agent', () => undefined);
    await coordinator.dispose();

    coordinator.releaseLease(lease.id);

    expect(scheduler.setTimeout).not.toHaveBeenCalled();
  });

  it('ignores an already queued idle callback after disposal', async () => {
    let idleCallback: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: (handler) => ((idleCallback = handler), 2),
      clearTimeout: vi.fn(),
    };
    const onSuspend = vi.fn();
    const coordinator = create({ scheduler });
    await coordinator.init();
    coordinator.registerIdleHook('agent', onSuspend);
    await coordinator.dispose();

    idleCallback?.();
    await Promise.resolve();

    expect(onSuspend).not.toHaveBeenCalled();
  });

  it('validates and clamps manual budget against machine safety', async () => {
    const coordinator = create();
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 99 }, maxTotalMemoryMB: 20_000, reserveForUserMB: 4_000 });
    expect(coordinator.getState().budget).toMatchObject({ maxConcurrent: { agent: 8 }, maxTotalMemoryMB: 12_000 });
    expect(() => coordinator.setBudget({ maxTotalMemoryMB: Number.NaN })).toThrow(RangeError);
  });

  it('rejects invalid configuration mutations without changing the current budget or mode', async () => {
    const coordinator = create();
    await coordinator.init();
    const before = coordinator.getState();

    expect(() => coordinator.setMode('automatic' as never)).toThrow('mode must be detailed or suggest');
    expect(() => coordinator.applyPreset('unlimited' as never)).toThrow('preset must be saver, balanced, or performance');
    expect(() => coordinator.setBudget({ maxConcurrent: { unsupported: 1 } as never })).toThrow(
      'maxConcurrent.unsupported is not supported'
    );

    expect(coordinator.getState()).toEqual(before);
  });

  it('refreshes published effective limits when a budget changes under pressure', async () => {
    let tick: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({
      scheduler,
      sampler: () => ({ freeMemMB: 500, cpuLoad: 0.95 }),
      autoStartBalanceLoop: true,
    });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 6 } });
    tick?.();
    await vi.waitFor(() => expect(coordinator.getState().effectiveLimits?.agent?.configured).toBe(6));

    coordinator.setBudget({ maxConcurrent: { agent: 3 } });

    expect(coordinator.getState().effectiveLimits?.agent).toMatchObject({ configured: 3, effective: 1 });
  });

  it('rejects invalid cost and an already expired deadline before granting', async () => {
    const coordinator = create({ now: () => 100 });
    await coordinator.init();
    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: -1 })).rejects.toThrow(RangeError);
    for (const deadlineAt of [100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await expect(
        coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'late', deadlineAt })
      ).rejects.toBeInstanceOf(ResourceRequestDeadlineError);
    }
    expect(coordinator.getState()).toMatchObject({ active: [], queued: [] });
  });

  it('rolls back a queued request when its deadline scheduler throws', async () => {
    const schedulerFailure = new Error('scheduler unavailable');
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => {
        throw schedulerFailure;
      }),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({ scheduler });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 0 } });

    await expect(
      coordinator.requestLease({
        kind: 'agent',
        estCostMB: 1,
        requestId: 'scheduler-failure',
        deadlineAt: Date.now() + 1_000,
      })
    ).rejects.toBe(schedulerFailure);

    expect(coordinator.getState().queued).toHaveLength(0);
    expect(coordinator.cancelQueuedRequest('scheduler-failure')).toBe(false);
  });

  it('rejects malformed lease inputs and duplicate queued request IDs before changing accounting', async () => {
    const coordinator = create();
    await coordinator.init();
    await expect(coordinator.requestLease({ kind: 'unsupported' as never, estCostMB: 1 })).rejects.toThrow(
      'supported task kind'
    );
    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1, priority: Number.NaN })).rejects.toThrow(
      'priority must be a finite number'
    );
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getState().queued).toHaveLength(0);

    coordinator.setBudget({ maxTotalMemoryMB: 1 });
    const first = coordinator.requestLease({ kind: 'agent', estCostMB: 2, requestId: 'duplicate-queued' });
    const firstCancelled = expect(first).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    await expect(
      coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'duplicate-queued' })
    ).rejects.toThrow('Duplicate resource request id');
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getState().queued).toContainEqual(expect.objectContaining({ requestId: 'duplicate-queued' }));

    expect(coordinator.cancelQueuedRequest('duplicate-queued')).toBe(true);
    await firstCancelled;
    const lease = await coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'already-granted' });
    expect(coordinator.cancelQueuedRequest('already-granted')).toBe(false);
    expect(coordinator.getState().active).toContainEqual(expect.objectContaining({ id: lease.id }));
  });

  it('bounds and canonicalizes request identifiers without weakening lease capabilities', async () => {
    const coordinator = create();
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 1 }, maxTotalMemoryMB: 1 });
    await expect(
      coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'x'.repeat(1025) })
    ).rejects.toThrow('character limit');
    await expect(
      coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'line\nbreak' })
    ).rejects.toThrow('control characters');
    await expect(
      coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 42 as never })
    ).rejects.toThrow('requestId must be a string');
    expect(coordinator.getState().queued).toHaveLength(0);

    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    const queued = coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: '  canonical-request  ' });
    const queuedResult = expect(queued).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    expect(coordinator.getState().queued).toContainEqual(expect.objectContaining({ requestId: 'canonical-request' }));
    expect(coordinator.cancelQueuedRequest(' canonical-request ')).toBe(true);
    await queuedResult;

    coordinator.releaseLease(` ${held.id} `);
    coordinator.releaseLease('not-the-held-lease');
    expect(coordinator.getState().active).toContainEqual(expect.objectContaining({ id: held.id }));
    coordinator.releaseLease(held.id);
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('fails closed if the lease-id generator repeats an active capability', async () => {
    const coordinator = create({ generateId: () => 'repeated-capability' });
    await coordinator.init();
    const first = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });

    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1 })).rejects.toThrow('unique lease id');

    expect(coordinator.getState().active).toEqual([expect.objectContaining({ id: first.id })]);
  });

  it('rounds positive fractional RAM costs upward before capacity accounting', async () => {
    const coordinator = create();
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 2 }, maxTotalMemoryMB: 1 });
    const first = await coordinator.requestLease({ kind: 'agent', estCostMB: 0.1 });
    const second = coordinator.requestLease({ kind: 'agent', estCostMB: 0.1 });

    expect(first.estCostMB).toBe(1);
    expect(coordinator.getState().active).toHaveLength(1);
    expect(coordinator.getState().queued).toHaveLength(1);
    coordinator.releaseLease(first.id);
    await expect(second).resolves.toMatchObject({ estCostMB: 1 });
  });

  it('rejects non-finite costs before queue mutation and preserves exact memory-bound admission', async () => {
    const coordinator = create();
    await coordinator.init();
    for (const cost of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01]) {
      await expect(coordinator.requestLease({ kind: 'agent', estCostMB: cost })).rejects.toThrow(
        'estCostMB must be a finite non-negative number'
      );
    }
    expect(coordinator.getState()).toMatchObject({ active: [], queued: [] });

    coordinator.setBudget({ maxConcurrent: { agent: 3 }, maxTotalMemoryMB: 1 });
    const charged = await coordinator.requestLease({ kind: 'agent', estCostMB: Number.MIN_VALUE });
    const zeroCost = await coordinator.requestLease({ kind: 'agent', estCostMB: 0 });
    const blocked = coordinator.requestLease({ kind: 'agent', estCostMB: Number.MIN_VALUE, requestId: 'memory-edge' });

    expect(charged.estCostMB).toBe(1);
    expect(zeroCost.estCostMB).toBe(0);
    expect(coordinator.getState().active).toHaveLength(2);
    expect(coordinator.getState().queued).toContainEqual(expect.objectContaining({ requestId: 'memory-edge', estCostMB: 1 }));

    coordinator.releaseLease(charged.id);
    await expect(blocked).resolves.toMatchObject({ estCostMB: 1 });
  });

  it('keeps the default queue bound when a runtime scheduler tunable is non-finite', async () => {
    const coordinator = create({
      maxQueueSize: Number.NaN,
      agingIntervalMs: Number.NaN,
      idleTimeoutMs: Number.NaN,
      balanceIntervalMs: Number.NaN,
      maxWarmResources: Number.NaN,
    });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 0 } });
    const requests = Array.from({ length: 101 }, (_, index) =>
      coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: `bounded-${index}` }).catch((error) => error)
    );

    await expect(requests.at(-1)).resolves.toBeInstanceOf(ResourceQueueFullError);
    await coordinator.dispose();
    const cancellations = await Promise.all(requests.slice(0, -1));
    expect(cancellations).toHaveLength(100);
    expect(cancellations.every((error) => error instanceof ResourceRequestCancelledError)).toBe(true);
  });

  it('uses the new pressure when publishing effective limits', async () => {
    let tick: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const live = create({
      scheduler,
      sampler: () => ({ freeMemMB: 500, cpuLoad: 0.95 }),
      autoStartBalanceLoop: true,
    });
    await live.init();
    live.setBudget({ maxConcurrent: { agent: 6 } });
    tick?.();
    await vi.waitFor(() => expect(live.getState().pressure).toBe('critical'));
    expect(live.getState().effectiveLimits?.agent?.effective).toBe(1);
  });

  it('uses a fail-safe normalized sample for both pressure and budget adjustment', async () => {
    let tick: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({
      scheduler,
      sampler: () => ({ freeMemMB: Number.POSITIVE_INFINITY, cpuLoad: 0 }),
      autoStartBalanceLoop: true,
    });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 3 } });

    tick?.();
    await vi.waitFor(() => expect(coordinator.getState().pressure).toBe('critical'));
    await vi.waitFor(() => expect(coordinator.getState().budget.maxConcurrent.agent).toBe(2));
  });

  it('treats negative, inconsistent, and malformed telemetry as pressure without logging raw provider data', async () => {
    let tick: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const samples: unknown[] = [
      { freeMemMB: machine.totalMemMB, cpuLoad: -0.1 },
      null,
      { freeMemMB: machine.totalMemMB + 1, cpuLoad: 0 },
    ];
    const sampler = vi.fn(() => samples.shift() as ResourceSample);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const coordinator = create({ scheduler, sampler, autoStartBalanceLoop: true });
      await coordinator.init();
      coordinator.setBudget({ maxConcurrent: { agent: 4 } });

      for (let adjustmentCount = 1; adjustmentCount <= 3; adjustmentCount++) {
        tick?.();
        await vi.waitFor(() => expect(coordinator.getState().lastAdjustments).toHaveLength(adjustmentCount));
        expect(coordinator.getState()).toMatchObject({
          pressure: 'critical',
          lastSample: { freeMemMB: 0, cpuLoad: 1 },
          resourceReason: { code: 'sample-invalid' },
        });
      }

      expect(sampler).toHaveBeenCalledTimes(3);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores a balance sample that resolves after disposal', async () => {
    let tick: (() => void) | undefined;
    let resolveSample: ((sample: { freeMemMB: number; cpuLoad: number }) => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: (handler) => ((tick = handler), 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({
      scheduler,
      sampler: () =>
        new Promise<{ freeMemMB: number; cpuLoad: number }>((resolve) => {
          resolveSample = resolve;
        }),
      autoStartBalanceLoop: true,
    });
    await coordinator.init();
    tick?.();
    await vi.waitFor(() => expect(resolveSample).toBeDefined());
    await coordinator.dispose();
    resolveSample?.({ freeMemMB: 500, cpuLoad: 0.95 });
    await Promise.resolve();

    expect(coordinator.getState().pressure).toBe('healthy');
  });

  it('ages lower-priority work fairly without letting it overtake interactive work', async () => {
    let now = 0;
    const coordinator = create({ now: () => now, agingIntervalMs: 1 });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 1 } });
    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    const old = coordinator.requestLease({ kind: 'agent', estCostMB: 1, priority: -100, requestId: 'old' });
    now = 250;
    const recent = coordinator.requestLease({ kind: 'agent', estCostMB: 1, priority: 100, requestId: 'recent' });
    coordinator.releaseLease(held.id);
    const interactiveLease = await recent;
    expect(coordinator.getState().queued).toContainEqual(expect.objectContaining({ requestId: 'old' }));
    coordinator.releaseLease(interactiveLease.id);
    expect((await old).waitMs).toBe(250);
  });

  it('does not grant an expired queued lease when the deadline callback is late', async () => {
    let now = 0;
    let deadlineCallback: (() => void) | undefined;
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: (handler) => ((deadlineCallback = handler), 2),
      clearTimeout: vi.fn(),
    };
    const coordinator = create({ now: () => now, scheduler });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 1 } });
    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    const expired = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'late-deadline',
      deadlineAt: 10,
    });
    const deadlineResult = expect(expired).rejects.toBeInstanceOf(ResourceRequestDeadlineError);

    now = 10;
    coordinator.releaseLease(held.id);
    await deadlineResult;
    deadlineCallback?.();

    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getState().queued).toHaveLength(0);
  });

  it('does not resolve a second disposal call before lifecycle cleanup finishes', async () => {
    let finishSuspend: (() => void) | undefined;
    const coordinator = create();
    await coordinator.init();
    coordinator.registerLifecycleResource({
      id: 'dispose-shared-work',
      kind: 'package',
      taskKind: 'agent',
      estCostMB: 1,
      suspend: () =>
        new Promise<void>((resolve) => {
          finishSuspend = resolve;
        }),
    });
    await coordinator.activateLifecycleResource('dispose-shared-work');

    const firstDisposal = coordinator.dispose();
    let secondDisposed = false;
    const secondDisposal = coordinator.dispose().then(() => {
      secondDisposed = true;
    });
    await vi.waitFor(() => expect(finishSuspend).toBeTypeOf('function'));

    expect(secondDisposed).toBe(false);
    finishSuspend?.();
    await Promise.all([firstDisposal, secondDisposal]);
    expect(secondDisposed).toBe(true);
  });

  it('ignores stale deadline and idle callbacks after their handles are replaced', async () => {
    let nextHandle = 0;
    const callbacks = new Map<number, () => void>();
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: (handler) => {
        const handle = ++nextHandle;
        callbacks.set(handle, handler);
        return handle;
      },
      // Deliberately retains callbacks, modelling a timer that was already
      // queued by the runtime when clearTimeout was called.
      clearTimeout: vi.fn(),
    };
    const coordinator = create({ now: () => 0, scheduler });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 1 } });
    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });

    const first = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'reused-request',
      deadlineAt: 100,
    });
    const firstCancelled = expect(first).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    coordinator.cancelQueuedRequest('reused-request');
    await firstCancelled;
    const firstDeadlineHandle = nextHandle;

    const second = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'reused-request',
      deadlineAt: 100,
    });
    callbacks.get(firstDeadlineHandle)?.();
    expect(coordinator.getState().queued).toContainEqual(expect.objectContaining({ requestId: 'reused-request' }));
    coordinator.cancelQueuedRequest('reused-request');
    await expect(second).rejects.toBeInstanceOf(ResourceRequestCancelledError);

    const onSuspend = vi.fn();
    coordinator.registerIdleHook('agent', onSuspend);
    coordinator.releaseLease(held.id);
    const originalIdleHandle = nextHandle;
    const replacementLease = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    coordinator.releaseLease(replacementLease.id);
    const replacementIdleHandle = nextHandle;
    callbacks.get(originalIdleHandle)?.();
    await Promise.resolve();
    expect(onSuspend).not.toHaveBeenCalled();

    callbacks.get(replacementIdleHandle)?.();
    await Promise.resolve();
    expect(onSuspend).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation and disposal races without letting stale deadlines affect a reused request id', async () => {
    let nextHandle = 0;
    const callbacks = new Map<number, () => void>();
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: (handler) => {
        const handle = ++nextHandle;
        callbacks.set(handle, handler);
        return handle;
      },
      // Retain callbacks to model a timeout that was already waiting in the
      // event loop when cancellation or disposal cleared its handle.
      clearTimeout: vi.fn(),
    };
    const coordinator = create({ now: () => 0, scheduler });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 1 } });
    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });

    const first = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'cancel-dispose-race',
      deadlineAt: 100,
    });
    const firstResult = expect(first).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    const firstHandle = nextHandle;
    expect(coordinator.cancelQueuedRequest('cancel-dispose-race')).toBe(true);
    await firstResult;

    const replacement = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'cancel-dispose-race',
      deadlineAt: 100,
    });
    const replacementResult = expect(replacement).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    const replacementHandle = nextHandle;
    const disposal = coordinator.dispose();

    callbacks.get(firstHandle)?.();
    callbacks.get(replacementHandle)?.();
    expect(coordinator.cancelQueuedRequest('cancel-dispose-race')).toBe(false);
    await Promise.all([replacementResult, disposal]);

    expect(coordinator.getState().queued).toHaveLength(0);
    expect(coordinator.getState().active).toHaveLength(0);
    coordinator.releaseLease(held.id);
  });

  it('rejects cancellation, deadline, and bounded-capacity failures with typed errors', async () => {
    vi.useFakeTimers();
    const coordinator = create({ now: () => Date.now(), maxQueueSize: 1 });
    await coordinator.init();
    coordinator.setBudget({ maxConcurrent: { agent: 1 } });
    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    const timed = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      requestId: 'timed',
      deadlineAt: Date.now() + 10,
    });
    const deadlineResult = expect(timed).rejects.toBeInstanceOf(ResourceRequestDeadlineError);
    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1 })).rejects.toBeInstanceOf(
      ResourceQueueFullError
    );
    await vi.advanceTimersByTimeAsync(10);
    await deadlineResult;
    coordinator.releaseLease(held.id);
  });
});
