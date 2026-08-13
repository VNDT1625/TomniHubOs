import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResourceCoordinator } from '@/process/resource/resourceCoordinator';
import {
  CreatorPreviewError,
  createCreatorPreviewRuntime,
  createCreatorSandboxDriverRegistry,
  type CreatorPreviewOpenRequest,
  type CreatorPreviewRuntimeOptions,
  type CreatorSandboxDriver,
} from '@/process/workspace/creatorPreviewRuntime';
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
const runtimes: Array<{ dispose: () => Promise<void> }> = [];

const createCoordinator = async () => {
  let id = 0;
  const coordinator = createResourceCoordinator({
    probe: async () => machine,
    autoStartBalanceLoop: false,
    generateId: () => `lease-${++id}`,
    store,
  });
  coordinators.push(coordinator);
  await coordinator.init();
  coordinator.setBudget({
    maxConcurrent: { ...coordinator.getState().budget.maxConcurrent, patchBuild: 1 },
  });
  return coordinator;
};

const createDriver = (overrides: Partial<CreatorSandboxDriver> = {}): CreatorSandboxDriver => {
  let sandbox = 0;
  let snapshot = 0;
  return {
    capabilities: { networkIsolation: 'allowlist', quotaEnforcement: true, snapshots: true },
    create: vi.fn(async () => ({ sandboxId: `sandbox-${++sandbox}` })),
    start: vi.fn(async ({ sandboxId }) => ({
      ready: true as const,
      firstMeaningfulPaintAt: 1,
      previewUrl: `https://${sandboxId}.preview.invalid`,
    })),
    suspend: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => ({ snapshotId: `snapshot-${++snapshot}` })),
    reset: vi.fn(async () => undefined),
    ...overrides,
  };
};

type RuntimeTestOptions = Omit<CreatorPreviewRuntimeOptions, 'driverRegistry' | 'driverId'> & {
  driver?: CreatorSandboxDriver;
};

const createRuntime = ({ driver, ...options }: RuntimeTestOptions) => {
  const registry = createCreatorSandboxDriverRegistry({ now: options.now ?? (() => 0) });
  if (driver) {
    registry.register({
      driverId: 'test-driver',
      driver,
      capabilityDeclaration: driver.capabilities,
      health: { state: 'healthy', observedAt: 0, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 0, reference: 'test-driver-attestation' },
    });
  }
  return createCreatorPreviewRuntime({ ...options, driverRegistry: registry, driverId: 'test-driver' });
};

const openRequest = (overrides: Partial<CreatorPreviewOpenRequest> = {}): CreatorPreviewOpenRequest => ({
  previewId: 'preview-alarm',
  projectId: 'project-alarm',
  requestId: 'request-open-1',
  correlationId: 'correlation-alarm',
  workspaceRoot: path.resolve('fixtures/creator/alarm'),
  entrypoint: 'dist/index.html',
  policy: {
    quota: { ramMiB: 256, cpuPercent: 50, diskMiB: 512, processes: 4, timeoutMs: 30_000 },
    network: { mode: 'blocked', allowedOrigins: [] },
    requestedCapabilities: ['notifications'],
    grantedCapabilities: [],
  },
  ...overrides,
});

const expectCode = async (promise: Promise<unknown>, code: CreatorPreviewError['code']): Promise<void> => {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CreatorPreviewError);
    expect((error as CreatorPreviewError).code).toBe(code);
  }
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.dispose()));
  vi.restoreAllMocks();
});

describe('creator preview runtime isolation contract', () => {
  it('fails closed until a declared healthy and accepted sandbox driver is registered', async () => {
    const coordinator = await createCoordinator();
    const unavailableRuntime = createRuntime({ coordinator });
    runtimes.push(unavailableRuntime);

    await expectCode(unavailableRuntime.open(openRequest()), 'SANDBOX_DRIVER_UNAVAILABLE');
    expect(coordinator.getState().active).toHaveLength(0);

    const registry = createCreatorSandboxDriverRegistry({ now: () => 100 });
    const driver = createDriver();
    const lifecycle = {
      onRegistered: vi.fn(),
      onHealthChanged: vi.fn(),
      onAttestationChanged: vi.fn(),
      onUnregistered: vi.fn(),
    };
    const unregister = registry.register({
      driverId: 'registry-driver',
      driver,
      capabilityDeclaration: driver.capabilities,
      health: { state: 'healthy', observedAt: 100, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 100, reference: 'registry-attestation' },
      lifecycle,
    });

    expect(lifecycle.onRegistered).toHaveBeenCalledTimes(1);
    expect(registry.getStatus('registry-driver')).toEqual(
      expect.objectContaining({ driverId: 'registry-driver', health: expect.objectContaining({ state: 'healthy' }) })
    );
    expect(registry.getStatus('registry-driver')).not.toHaveProperty('driver');
    expect(() =>
      registry.register({
        driverId: 'mismatched-driver',
        driver,
        capabilityDeclaration: { ...driver.capabilities, snapshots: false },
        health: { state: 'healthy', observedAt: 100, code: 'HEALTH_OK' },
        attestation: { state: 'accepted', attestedAt: 100, reference: 'mismatch-attestation' },
      })
    ).toThrow('capability declaration');
    expect(registry.resolve('mismatched-driver')).toMatchObject({ state: 'missing' });
    const expiryRegistry = createCreatorSandboxDriverRegistry({ now: () => 200 });
    expiryRegistry.register({
      driverId: 'expired-driver',
      driver,
      capabilityDeclaration: driver.capabilities,
      health: { state: 'healthy', observedAt: 200, code: 'HEALTH_OK' },
      attestation: {
        state: 'accepted',
        attestedAt: 100,
        expiresAt: 200,
        reference: 'expired-attestation',
      },
    });
    expect(expiryRegistry.resolve('expired-driver')).toMatchObject({ state: 'untrusted' });

    const runtime = createCreatorPreviewRuntime({
      coordinator,
      driverRegistry: registry,
      driverId: 'registry-driver',
    });
    runtimes.push(runtime);
    await runtime.open(openRequest({ requestId: 'registered-open' }));

    expect(
      registry.updateHealth('registry-driver', { state: 'degraded', observedAt: 101, code: 'DRIVER_DEGRADED' })
    ).toBe(true);
    await expectCode(runtime.open(openRequest({ requestId: 'degraded-open' })), 'SANDBOX_DRIVER_UNHEALTHY');
    expect(lifecycle.onHealthChanged).toHaveBeenCalledTimes(1);

    registry.updateHealth('registry-driver', { state: 'healthy', observedAt: 102, code: 'HEALTH_OK' });
    registry.updateAttestation('registry-driver', {
      state: 'unverified',
      attestedAt: 102,
      reference: 'registry-attestation',
    });
    await expectCode(runtime.open(openRequest({ requestId: 'untrusted-open' })), 'SANDBOX_DRIVER_UNTRUSTED');
    expect(lifecycle.onAttestationChanged).toHaveBeenCalledTimes(1);

    registry.updateAttestation('registry-driver', {
      state: 'accepted',
      attestedAt: 103,
      reference: 'registry-attestation',
    });
    await runtime.remove({
      previewId: 'preview-alarm',
      requestId: 'registered-remove',
      correlationId: 'correlation-alarm',
    });
    unregister();
    expect(lifecycle.onUnregistered).toHaveBeenCalledTimes(1);
  });

  it('rejects stale health and future-dated trust evidence until the clock catches up', () => {
    let clock = 100;
    const registry = createCreatorSandboxDriverRegistry({ now: () => clock, maxHealthAgeMs: 50 });
    const driver = createDriver();
    registry.register({
      driverId: 'freshness-driver',
      driver,
      capabilityDeclaration: driver.capabilities,
      health: { state: 'healthy', observedAt: 100, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 100, reference: 'freshness-attestation' },
    });

    expect(registry.resolve('freshness-driver')).toMatchObject({ state: 'active' });
    clock = 151;
    expect(registry.resolve('freshness-driver')).toMatchObject({ state: 'unhealthy' });
    registry.updateHealth('freshness-driver', { state: 'healthy', observedAt: 151, code: 'HEALTH_REFRESHED' });
    expect(registry.resolve('freshness-driver')).toMatchObject({ state: 'active' });

    registry.updateAttestation('freshness-driver', {
      state: 'accepted',
      attestedAt: 152,
      reference: 'future-attestation',
    });
    expect(registry.resolve('freshness-driver')).toMatchObject({ state: 'untrusted' });
    clock = 152;
    expect(registry.resolve('freshness-driver')).toMatchObject({ state: 'active' });
    expect(() => createCreatorSandboxDriverRegistry({ maxHealthAgeMs: 0 })).toThrow('maxHealthAgeMs');
  });

  it('reuses one isolated sandbox across suspend/reactivate and releases every lifecycle lease', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({
      coordinator,
      driver,
      generateId: (() => {
        let id = 0;
        return () => `runtime-${++id}`;
      })(),
    });
    runtimes.push(runtime);

    const opened = await runtime.open(openRequest());
    expect(opened).toMatchObject({ operation: 'open', status: 'succeeded', to: 'active' });
    expect(runtime.getSession('preview-alarm')).toMatchObject({
      state: 'active',
      sandboxId: 'sandbox-1',
      previewUrl: 'https://sandbox-1.preview.invalid',
    });
    expect(coordinator.getState().active).toHaveLength(1);

    await runtime.suspend({
      previewId: 'preview-alarm',
      requestId: 'request-suspend-1',
      correlationId: 'correlation-alarm',
    });
    expect(runtime.getSession('preview-alarm')?.state).toBe('suspended');
    expect(coordinator.getState().active).toHaveLength(0);

    await runtime.open(openRequest({ requestId: 'request-open-2' }));
    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(driver.start).toHaveBeenCalledTimes(2);
    expect(coordinator.getState().active).toHaveLength(1);

    await runtime.remove({
      previewId: 'preview-alarm',
      requestId: 'request-remove-1',
      correlationId: 'correlation-alarm',
    });
    expect(driver.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.getSession('preview-alarm')).toBeUndefined();
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('coalesces repeated idempotency keys and cancels queued work without creating a phantom sandbox', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);
    const held = await coordinator.requestLease({ kind: 'patchBuild', estCostMB: 1 });
    const request = openRequest();

    const repeated = Array.from({ length: 100 }, () => runtime.open(request));
    await vi.waitFor(() => expect(coordinator.getState().queued).toHaveLength(1));
    coordinator.releaseLease(held.id);
    const receipts = await Promise.all(repeated);
    expect(new Set(receipts.map((receipt) => receipt.receiptId))).toHaveLength(1);
    expect(driver.create).toHaveBeenCalledTimes(1);

    await expectCode(
      runtime.open(openRequest({ previewId: 'other-preview', requestId: request.requestId })),
      'IDEMPOTENCY_CONFLICT'
    );

    await runtime.suspend({
      previewId: request.previewId,
      requestId: 'suspend-before-cancel',
      correlationId: request.correlationId,
    });
    const blocker = await coordinator.requestLease({ kind: 'patchBuild', estCostMB: 1 });
    const controller = new AbortController();
    const cancelled = runtime.open(
      openRequest({
        previewId: 'cancelled-preview',
        projectId: 'cancelled-project',
        requestId: 'cancelled-open',
        signal: controller.signal,
      })
    );
    await vi.waitFor(() => expect(coordinator.getState().queued).toHaveLength(1));
    controller.abort();
    await expectCode(cancelled, 'PREVIEW_CANCELLED');
    coordinator.releaseLease(blocker.id);
    expect(runtime.getSession('cancelled-preview')?.state).toBe('cold');
    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('rejects path escapes, excessive quota, and unenforceable network policy before driver execution', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver({
      capabilities: { networkIsolation: 'blocked-only', quotaEnforcement: true, snapshots: true },
    });
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);

    await expectCode(runtime.open(openRequest({ entrypoint: '../secret.js' })), 'INVALID_PREVIEW_REQUEST');
    await expectCode(
      runtime.open(
        openRequest({
          requestId: 'quota-too-high',
          policy: {
            ...openRequest().policy,
            quota: { ...openRequest().policy.quota, ramMiB: 20_000 },
          },
        })
      ),
      'POLICY_UNENFORCEABLE'
    );
    await expectCode(
      runtime.open(
        openRequest({
          requestId: 'allowlist-not-enforced',
          policy: {
            ...openRequest().policy,
            network: { mode: 'allowlist', allowedOrigins: ['https://api.example.com'] },
          },
        })
      ),
      'POLICY_UNENFORCEABLE'
    );

    expect(driver.create).not.toHaveBeenCalled();
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('captures a snapshot and resets an active preview without replacing its sandbox', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);
    await runtime.open(openRequest());

    const snapshot = await runtime.captureSnapshot({
      previewId: 'preview-alarm',
      requestId: 'snapshot-1',
      correlationId: 'correlation-alarm',
    });
    expect(snapshot).toMatchObject({ operation: 'snapshot', status: 'succeeded', snapshotId: 'snapshot-1' });

    const reset = await runtime.reset({
      previewId: 'preview-alarm',
      requestId: 'reset-1',
      correlationId: 'correlation-alarm',
    });
    expect(reset).toMatchObject({ operation: 'reset', status: 'succeeded', to: 'active' });
    expect(driver.reset).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'sandbox-1', snapshotId: 'snapshot-1' })
    );
    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(driver.start).toHaveBeenCalledTimes(2);
    expect(coordinator.getState().active).toHaveLength(1);
  });

  it('contains driver crashes, releases leases, and quarantines a repeatedly failing preview', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({ coordinator, driver, crashQuarantineThreshold: 3 });
    runtimes.push(runtime);

    await runtime.open(openRequest());
    for (let crash = 1; crash <= 3; crash += 1) {
      // Stateful crash/recovery drills must run in order.
      // oxlint-disable-next-line no-await-in-loop
      await runtime.reportCrash({
        previewId: 'preview-alarm',
        requestId: `crash-${crash}`,
        correlationId: 'correlation-alarm',
        code: 'WORKER_EXITED',
      });
      expect(coordinator.getState().active).toHaveLength(0);
      expect(runtime.getSession('preview-alarm')?.state).toBe(crash === 3 ? 'quarantined' : 'failed');
      if (crash < 3) {
        // Recovery must complete before the next simulated crash.
        // oxlint-disable-next-line no-await-in-loop
        await runtime.open(openRequest({ requestId: `recover-${crash}` }));
      }
    }

    await expectCode(runtime.open(openRequest({ requestId: 'blocked-after-quarantine' })), 'PREVIEW_QUARANTINED');
    expect(driver.destroy).toHaveBeenCalledTimes(3);
  });

  it('bounds local observability history and isolates a failing event listener', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({ coordinator, driver, maxEvents: 5, maxReceipts: 3 });
    runtimes.push(runtime);
    runtime.onEvent(() => {
      throw new Error('listener failure');
    });
    await runtime.open(openRequest());

    await Promise.all(
      Array.from({ length: 8 }, (_value, index) =>
        runtime.captureSnapshot({
          previewId: 'preview-alarm',
          requestId: `bounded-snapshot-${index}`,
          correlationId: 'correlation-alarm',
        })
      )
    );

    expect(runtime.listEvents()).toHaveLength(5);
    expect(runtime.listReceipts()).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
  });

  it('cancels in-flight sandbox creation and unregisters lifecycle state during disposal', async () => {
    const coordinator = await createCoordinator();
    const create = vi.fn(
      ({ signal }: Parameters<CreatorSandboxDriver['create']>[0]) =>
        new Promise<never>((_resolve, reject) => {
          const rejectAbort = (): void => reject(new Error('sandbox creation aborted'));
          if (signal.aborted) rejectAbort();
          else signal.addEventListener('abort', rejectAbort, { once: true });
        })
    );
    const driver = createDriver({ create });
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);

    const opening = runtime.open(openRequest());
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const disposal = runtime.dispose();

    await expectCode(opening, 'PREVIEW_CANCELLED');
    await disposal;
    expect(driver.start).not.toHaveBeenCalled();
    expect(coordinator.getState().active).toHaveLength(0);
    expect(coordinator.getState().queued).toHaveLength(0);
    expect(
      coordinator.getLifecycleSnapshot().entries.find((entry) => entry.id === 'creator-preview:preview-alarm')
    ).toBeUndefined();
    await runtime.dispose();
  });

  it('rejects unsafe crash diagnostics and fingerprints normalized crash codes', async () => {
    const coordinator = await createCoordinator();
    const runtime = createRuntime({ coordinator, driver: createDriver() });
    runtimes.push(runtime);
    await runtime.open(openRequest());

    await expectCode(
      runtime.reportCrash({
        previewId: 'preview-alarm',
        requestId: 'unsafe-crash',
        code: '../private/project/source.ts',
      }),
      'INVALID_PREVIEW_REQUEST'
    );
    expect(runtime.getSession('preview-alarm')?.crashCount).toBe(0);

    const crash = await runtime.reportCrash({
      previewId: 'preview-alarm',
      requestId: 'safe-crash',
      code: ' worker_exited ',
    });
    expect(crash.code).toBe('WORKER_EXITED');
    await expectCode(
      runtime.reportCrash({ previewId: 'preview-alarm', requestId: 'safe-crash', code: 'OTHER_EXIT' }),
      'IDEMPOTENCY_CONFLICT'
    );
    expect(runtime.listEvents().some((event) => event.code.includes('private'))).toBe(false);
  });

  it('does not mark a surface active until the driver confirms readiness and first paint', async () => {
    const coordinator = await createCoordinator();
    const start = vi.fn(async () => ({
      previewUrl: 'https://sandbox-1.preview.invalid',
      ready: true as const,
    })) as unknown as CreatorSandboxDriver['start'];
    const driver = createDriver({ start });
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);

    await expectCode(runtime.open(openRequest()), 'SANDBOX_DRIVER_FAILURE');
    expect(driver.destroy).toHaveBeenCalledWith({ sandboxId: 'sandbox-1' });
    expect(runtime.getSession('preview-alarm')?.state).toBe('failed');
  });

  it('forwards only redacted and correlated sandbox events', async () => {
    const coordinator = await createCoordinator();
    let onEvent: Parameters<CreatorSandboxDriver['create']>[0]['onEvent'] | undefined;
    const create = vi.fn(async (input: Parameters<CreatorSandboxDriver['create']>[0]) => {
      onEvent = input.onEvent;
      return { sandboxId: 'sandbox-1' };
    });
    const driver = createDriver({ create });
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);

    await runtime.open(openRequest());
    expect(onEvent).toEqual(expect.any(Function));
    onEvent?.({
      type: 'egress-blocked',
      code: 'EGRESS_DENIED',
      origin: 'https://api.example.com/private?token=secret',
    });
    onEvent?.({ type: 'quota-warning', code: 'RAM_NEAR_LIMIT', resource: 'ram' });
    onEvent?.({ type: 'egress-blocked', code: '../unsafe/code', origin: 'https://leak.example/private' });

    const event = runtime.listEvents().find((candidate) => candidate.type === 'egress-blocked');
    expect(event).toMatchObject({
      requestId: 'request-open-1',
      correlationId: 'correlation-alarm',
      code: 'EGRESS_DENIED',
      origin: 'https://api.example.com',
    });
    expect(runtime.listEvents().find((candidate) => candidate.type === 'quota-warning')).toMatchObject({
      code: 'RAM_NEAR_LIMIT',
      resource: 'ram',
    });
    expect(runtime.listEvents().some((candidate) => candidate.code.includes('unsafe'))).toBe(false);
    expect(JSON.stringify(event)).not.toContain('private');
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('rejects unsafe snapshot identifiers without persisting driver payloads', async () => {
    const coordinator = await createCoordinator();
    const snapshot = vi.fn(async () => ({ snapshotId: '../private/project/source.ts' }));
    const runtime = createRuntime({ coordinator, driver: createDriver({ snapshot }) });
    runtimes.push(runtime);
    await runtime.open(openRequest());

    await expectCode(
      runtime.captureSnapshot({
        previewId: 'preview-alarm',
        requestId: 'unsafe-snapshot',
        correlationId: 'correlation-alarm',
      }),
      'SANDBOX_DRIVER_FAILURE'
    );
    expect(runtime.getSession('preview-alarm')?.lastSnapshotId).toBeUndefined();
    expect(JSON.stringify(runtime.listEvents())).not.toContain('private');
    expect(JSON.stringify(runtime.listReceipts())).not.toContain('private');
  });

  it('rejects unsafe operation identifiers before invoking the sandbox driver', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);

    await expectCode(runtime.open(openRequest({ requestId: 'request/with?secret' })), 'INVALID_PREVIEW_REQUEST');
    expect(driver.create).not.toHaveBeenCalled();
  });

  it('binds cleanup to the original driver and rejects a replacement registration', async () => {
    const coordinator = await createCoordinator();
    const registry = createCreatorSandboxDriverRegistry({ now: () => 0 });
    const originalDriver = createDriver();
    const replacementDriver = createDriver();
    const unregisterOriginal = registry.register({
      driverId: 'replaceable-driver',
      driver: originalDriver,
      capabilityDeclaration: originalDriver.capabilities,
      health: { state: 'healthy', observedAt: 0, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 0, reference: 'original-attestation' },
    });
    const runtime = createCreatorPreviewRuntime({
      coordinator,
      driverRegistry: registry,
      driverId: 'replaceable-driver',
    });
    runtimes.push(runtime);
    await runtime.open(openRequest());

    unregisterOriginal();
    registry.register({
      driverId: 'replaceable-driver',
      driver: replacementDriver,
      capabilityDeclaration: replacementDriver.capabilities,
      health: { state: 'healthy', observedAt: 0, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 0, reference: 'replacement-attestation' },
    });

    await expectCode(runtime.open(openRequest({ requestId: 'replacement-open' })), 'SANDBOX_DRIVER_UNTRUSTED');
    expect(replacementDriver.start).not.toHaveBeenCalled();
    await runtime.remove({
      previewId: 'preview-alarm',
      requestId: 'cleanup-original-driver',
      correlationId: 'correlation-alarm',
    });
    expect(originalDriver.destroy).toHaveBeenCalledWith({ sandboxId: 'sandbox-1' });
    expect(replacementDriver.destroy).not.toHaveBeenCalled();
    expect(runtime.getSession('preview-alarm')).toBeUndefined();
  });

  it('contains a crash after driver health becomes unhealthy', async () => {
    const coordinator = await createCoordinator();
    const registry = createCreatorSandboxDriverRegistry({ now: () => 1 });
    const driver = createDriver();
    registry.register({
      driverId: 'health-driver',
      driver,
      capabilityDeclaration: driver.capabilities,
      health: { state: 'healthy', observedAt: 0, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 0, reference: 'health-attestation' },
    });
    const runtime = createCreatorPreviewRuntime({ coordinator, driverRegistry: registry, driverId: 'health-driver' });
    runtimes.push(runtime);
    await runtime.open(openRequest());

    registry.updateHealth('health-driver', { state: 'unhealthy', observedAt: 1, code: 'DRIVER_UNHEALTHY' });
    await expectCode(runtime.open(openRequest({ requestId: 'blocked-unhealthy-open' })), 'SANDBOX_DRIVER_UNHEALTHY');
    const crash = await runtime.reportCrash({
      previewId: 'preview-alarm',
      requestId: 'unhealthy-driver-crash',
      correlationId: 'correlation-alarm',
      code: 'DRIVER_HEALTH_LOST',
    });

    expect(crash).toMatchObject({ operation: 'crash', status: 'failed', code: 'DRIVER_HEALTH_LOST' });
    expect(driver.destroy).toHaveBeenCalledWith({ sandboxId: 'sandbox-1' });
    expect(runtime.getSession('preview-alarm')).toMatchObject({ state: 'failed', sandboxId: undefined });
    expect(coordinator.getState().active).toHaveLength(0);
  });

  it('keeps failed cleanup quarantined and permits a later cleanup retry after unregister', async () => {
    const coordinator = await createCoordinator();
    const registry = createCreatorSandboxDriverRegistry({ now: () => 0 });
    const destroy = vi.fn<CreatorSandboxDriver['destroy']>(async () => {
      throw new Error('destroy unavailable');
    });
    const driver = createDriver({ destroy });
    const unregister = registry.register({
      driverId: 'cleanup-driver',
      driver,
      capabilityDeclaration: driver.capabilities,
      health: { state: 'healthy', observedAt: 0, code: 'HEALTH_OK' },
      attestation: { state: 'accepted', attestedAt: 0, reference: 'cleanup-attestation' },
    });
    const runtime = createCreatorPreviewRuntime({ coordinator, driverRegistry: registry, driverId: 'cleanup-driver' });
    runtimes.push(runtime);
    await runtime.open(openRequest());
    unregister();

    await expectCode(
      runtime.remove({
        previewId: 'preview-alarm',
        requestId: 'failed-cleanup',
        correlationId: 'correlation-alarm',
      }),
      'SANDBOX_DRIVER_FAILURE'
    );
    expect(runtime.getSession('preview-alarm')).toMatchObject({ state: 'quarantined', sandboxId: 'sandbox-1' });
    expect(runtime.listEvents().some((event) => event.code === 'CONTAINMENT_UNCONFIRMED')).toBe(true);

    destroy.mockResolvedValue(undefined);
    await runtime.remove({
      previewId: 'preview-alarm',
      requestId: 'retried-cleanup',
      correlationId: 'correlation-alarm',
    });
    expect(destroy).toHaveBeenCalledTimes(3);
    expect(runtime.getSession('preview-alarm')).toBeUndefined();
    expect(
      coordinator.getLifecycleSnapshot().entries.find((entry) => entry.id === 'creator-preview:preview-alarm')
    ).toBeUndefined();
  });

  it('quarantines a preview when crash eviction cannot be confirmed', async () => {
    const coordinator = await createCoordinator();
    const driver = createDriver();
    const runtime = createRuntime({ coordinator, driver });
    runtimes.push(runtime);
    await runtime.open(openRequest());
    const eviction = vi
      .spyOn(coordinator, 'evictLifecycleResource')
      .mockRejectedValue(new Error('eviction unavailable'));

    const crash = await runtime.reportCrash({
      previewId: 'preview-alarm',
      requestId: 'crash-unconfirmed-eviction',
      correlationId: 'correlation-alarm',
      code: 'WORKER_EXITED',
    });

    expect(crash.status).toBe('failed');
    expect(runtime.getSession('preview-alarm')?.state).toBe('quarantined');
    expect(driver.destroy).toHaveBeenCalledWith({ sandboxId: 'sandbox-1' });
    eviction.mockRestore();
  });
});
