import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResourceOwnerRevokedError,
  ResourceRequestCancelledError,
  createResourceCoordinator,
  type Scheduler,
} from '@/process/resource/resourceCoordinator';
import type { LeaseOwner, MachineProfile } from '@/process/resource/leaseTypes';

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

type Timer = { handler: () => void; ms: number; cleared: boolean };

const coordinators: ReturnType<typeof createResourceCoordinator>[] = [];

const createHarness = async () => {
  let now = 1_000;
  let id = 0;
  const timers: Timer[] = [];
  const scheduler: Scheduler = {
    setInterval: vi.fn(() => ({ kind: 'interval' })),
    clearInterval: vi.fn(),
    setTimeout: (handler, ms) => {
      const timer = { handler, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as Timer).cleared = true;
    },
  };
  const coordinator = createResourceCoordinator({
    probe: async () => machine,
    autoStartBalanceLoop: false,
    generateId: () => `lease-${++id}`,
    now: () => now,
    scheduler,
    store,
  });
  coordinators.push(coordinator);
  await coordinator.init();
  coordinator.setBudget({ maxTotalMemoryMB: 1, reserveForUserMB: 0 });
  return { coordinator, timers, setNow: (value: number) => (now = value) };
};

const ownerA: LeaseOwner = { processKind: 'worker', serviceId: 'inference', taskId: 'task-a' };
const ownerB: LeaseOwner = { processKind: 'worker', serviceId: 'inference', taskId: 'task-b' };

afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.dispose()));
});

describe('ResourceCoordinator timed lease lifecycle', () => {
  it('returns expired lease budget to the next queued request', async () => {
    const { coordinator, timers, setNow } = await createHarness();
    const expiring = await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA, ttlMs: 100 });
    const queued = coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'next' });

    expect(expiring.expiresAt).toBe(1_100);
    expect(timers[0].ms).toBe(100);

    setNow(1_100);
    timers[0].handler();
    const granted = await queued;

    expect(coordinator.getState().active.map((lease) => lease.id)).toEqual([granted.id]);
    coordinator.releaseLease(granted.id);
  });

  it('ignores a stale expiry callback after heartbeat renewal', async () => {
    const { coordinator, timers, setNow } = await createHarness();
    const lease = await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA, ttlMs: 100 });
    const originalTimer = timers[0];

    setNow(1_050);
    expect(coordinator.renewLease(lease.id)).toBe(true);
    const renewedTimer = timers[1];
    expect(originalTimer.cleared).toBe(true);

    setNow(1_100);
    originalTimer.handler();
    expect(coordinator.getState().active).toHaveLength(1);

    setNow(1_150);
    renewedTimer.handler();
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('rejects a heartbeat at expiry and returns its budget before a delayed timer runs', async () => {
    const { coordinator, timers, setNow } = await createHarness();
    const lease = await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA, ttlMs: 100 });
    const queued = coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'after-expired-renewal' });

    setNow(1_100);
    expect(coordinator.renewLease(lease.id)).toBe(false);
    const granted = await queued;
    expect(coordinator.getState().active.map((active) => active.id)).toEqual([granted.id]);

    timers[0].handler();
    expect(coordinator.getState().active.map((active) => active.id)).toEqual([granted.id]);
    coordinator.releaseLease(granted.id);
  });

  it('revokes active and queued work for only the crashed owner', async () => {
    const { coordinator, timers } = await createHarness();
    coordinator.setBudget({ maxTotalMemoryMB: 2 });
    const leaseA = await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA, ttlMs: 100 });
    const leaseB = await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerB, ttlMs: 100 });
    const queuedA = coordinator.requestLease({
      kind: 'agent',
      estCostMB: 1,
      owner: ownerA,
      requestId: 'owner-a-queued',
    });
    const rejected = expect(queuedA).rejects.toBeInstanceOf(ResourceOwnerRevokedError);

    expect(coordinator.ownerCrashed(ownerA)).toBe(2);
    await rejected;

    expect(coordinator.getState().active.map((lease) => lease.id)).toEqual([leaseB.id]);
    expect(timers[0].cleared).toBe(true);
    expect(timers[1].cleared).toBe(false);
    coordinator.releaseLease(leaseB.id);
    expect(coordinator.ownerCrashed(ownerA)).toBe(0);
    expect(leaseA.id).not.toBe(leaseB.id);
  });

  it('blocks reentrant lease acquisition for an owner while crash revocation is in progress', async () => {
    const { coordinator } = await createHarness();
    await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA });
    let replacement: ReturnType<typeof coordinator.requestLease> | undefined;
    coordinator.onStateChange((state) => {
      if (state.active.length === 0 && !replacement) {
        replacement = coordinator.requestLease({
          kind: 'agent',
          estCostMB: 1,
          owner: ownerA,
          requestId: 'reentrant-owner-request',
        });
      }
    });

    expect(coordinator.ownerCrashed(ownerA)).toBe(1);
    if (!replacement) throw new Error('Expected the state listener to request a replacement lease.');
    await expect(replacement).rejects.toBeInstanceOf(ResourceOwnerRevokedError);
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('coalesces reentrant owner crash cleanup without double-counting revoked leases', async () => {
    const { coordinator } = await createHarness();
    coordinator.setBudget({ maxTotalMemoryMB: 2 });
    await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA });
    await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA });
    let nestedRevoked: number | undefined;

    coordinator.onStateChange((state) => {
      if (state.active.length === 1 && nestedRevoked === undefined) {
        nestedRevoked = coordinator.ownerCrashed(ownerA);
      }
    });

    expect(coordinator.ownerCrashed(ownerA)).toBe(2);
    expect(nestedRevoked).toBe(0);
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('removes an aborted queued request so another caller can use its queue slot', async () => {
    const { coordinator } = await createHarness();
    const controller = new AbortController();
    const held = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });
    const aborted = coordinator.requestLease(
      { kind: 'agent', estCostMB: 1, requestId: 'aborted-waiter' },
      { signal: controller.signal }
    );

    controller.abort();

    await expect(aborted).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    expect(coordinator.getState().queued).toHaveLength(0);

    const replacement = coordinator.requestLease({ kind: 'agent', estCostMB: 1, requestId: 'replacement-waiter' });
    expect(coordinator.getState().queued.map((request) => request.requestId)).toEqual(['replacement-waiter']);

    expect(coordinator.cancelQueuedRequest('replacement-waiter')).toBe(true);
    await expect(replacement).rejects.toBeInstanceOf(ResourceRequestCancelledError);
    coordinator.releaseLease(held.id);
  });

  it('keeps v1 leases untimed when no TTL is requested', async () => {
    const { coordinator, timers } = await createHarness();
    const lease = await coordinator.requestLease({ kind: 'agent', estCostMB: 1 });

    expect(lease.expiresAt).toBeUndefined();
    expect(timers).toHaveLength(0);
    expect(coordinator.renewLease(lease.id)).toBe(false);

    coordinator.releaseLease(lease.id);
  });

  it('rejects invalid lifetimes and incomplete sandbox ownership without consuming budget', async () => {
    const { coordinator } = await createHarness();

    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1, ttlMs: 0 })).rejects.toBeInstanceOf(
      RangeError
    );
    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1, renewable: true })).rejects.toBeInstanceOf(
      TypeError
    );
    await expect(
      coordinator.requestLease({
        kind: 'agent',
        estCostMB: 1,
        owner: { processKind: 'sandbox-package', serviceId: 'sandbox' },
      })
    ).rejects.toBeInstanceOf(TypeError);

    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('isolates owner identity from mutable state snapshots', async () => {
    const { coordinator } = await createHarness();
    await coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA, ttlMs: 100 });
    const snapshot = coordinator.getState();

    snapshot.active[0].owner!.serviceId = 'mutated';

    expect(coordinator.getState().active[0].owner?.serviceId).toBe('inference');
    expect(coordinator.ownerCrashed(ownerA)).toBe(1);
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('rolls back accounting when the expiry scheduler rejects a grant', async () => {
    const scheduler: Scheduler = {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: () => {
        throw new Error('timer unavailable');
      },
      clearTimeout: vi.fn(),
    };
    const coordinator = createResourceCoordinator({
      probe: async () => machine,
      autoStartBalanceLoop: false,
      scheduler,
      store,
    });
    coordinators.push(coordinator);
    await coordinator.init();

    await expect(coordinator.requestLease({ kind: 'agent', estCostMB: 1, owner: ownerA, ttlMs: 100 })).rejects.toThrow(
      'timer unavailable'
    );
    expect(coordinator.getState().active).toHaveLength(0);
  });
});
