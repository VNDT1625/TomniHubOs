import { describe, expect, it, vi } from 'vitest';
import {
  activateWindowsCreatorSandboxBoundary,
  activateWindowsCreatorSandboxFromProductionConfiguration,
  validateWindowsCreatorSandboxProductionConfiguration,
  type WindowsCreatorSandboxActivationOptions,
} from '@/process/extensions/windowsSandboxActivation';
import type {
  PreparedWindowsCreatorSandboxBoundary,
  WindowsCreatorSandboxBoundaryOptions,
  WindowsCreatorSandboxBoundaryResult,
} from '@/process/extensions/windowsSandboxBoundary';
import type { ICreatorSandboxDriverRegistry } from '@/process/workspace/creatorPreviewRuntime';
import type {
  CreatorSandboxDriverHealth,
  CreatorSandboxDriverRegistration,
} from '@/process/workspace/creatorPreviewTypes';

const HASH = 'a'.repeat(64);
const THUMBPRINT = 'b'.repeat(40);

const registration = (): CreatorSandboxDriverRegistration => ({
  driverId: 'tomni.creator-preview.os-sandbox',
  driver: {
    capabilities: { networkIsolation: 'allowlist', quotaEnforcement: true, snapshots: false },
    create: vi.fn(async () => ({ sandboxId: 'sandbox-1' })),
    start: vi.fn(async () => ({ ready: true, firstMeaningfulPaintAt: 1 })),
    suspend: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
  },
  capabilityDeclaration: { networkIsolation: 'allowlist', quotaEnforcement: true, snapshots: false },
  health: { state: 'healthy', observedAt: 100, code: 'WINDOWS_SANDBOX_READY' },
  attestation: { state: 'accepted', attestedAt: 100, reference: `sha256:${HASH}` },
});

type BoundaryFixture = {
  boundary: PreparedWindowsCreatorSandboxBoundary;
  dispose: ReturnType<typeof vi.fn>;
  observeHealth: ReturnType<typeof vi.fn>;
  subscribeTrustRevocation: ReturnType<typeof vi.fn>;
  subscribeProcessExit: ReturnType<typeof vi.fn>;
  triggerTrustRevocation(): void;
  triggerProcessExit(): void;
};

const boundaryFixture = (
  health: CreatorSandboxDriverHealth = { state: 'healthy', observedAt: 110, code: 'WINDOWS_SANDBOX_READY' }
): BoundaryFixture => {
  const dispose = vi.fn(async () => undefined);
  const observeHealth = vi.fn(async () => health);

  let trustRevocationListener: (() => void) | undefined;
  const unsubscribeTrustRevocation = vi.fn();
  const subscribeTrustRevocation = vi.fn((listener: () => void) => {
    trustRevocationListener = listener;
    return unsubscribeTrustRevocation;
  });
  let processExitListener: (() => void) | undefined;
  const unsubscribeProcessExit = vi.fn();
  const subscribeProcessExit = vi.fn((listener: () => void) => {
    processExitListener = listener;
    return unsubscribeProcessExit;
  });
  return {
    boundary: {
      state: 'ready',
      binarySha256: HASH,
      registration: registration(),
      observeHealth,
      subscribeTrustRevocation,
      subscribeProcessExit,
      dispose,
    },
    dispose,
    observeHealth,
    subscribeTrustRevocation,
    subscribeProcessExit,
    triggerTrustRevocation: () => trustRevocationListener?.(),
    triggerProcessExit: () => processExitListener?.(),
  };
};

type RegistryFixture = {
  registry: WindowsCreatorSandboxActivationOptions['driverRegistry'];
  register: ReturnType<typeof vi.fn>;
  unregisterRegistration: ReturnType<typeof vi.fn>;
  updateHealth: ReturnType<typeof vi.fn>;
};

const registryFixture = (): RegistryFixture => {
  const unregisterRegistration = vi.fn();
  const register = vi.fn(() => unregisterRegistration);
  const updateHealth = vi.fn(() => true);
  const unregister = vi.fn(() => true);
  return {
    registry: { register, unregister, updateHealth } as Pick<
      ICreatorSandboxDriverRegistry,
      'register' | 'unregister' | 'updateHealth'
    >,
    register,
    unregisterRegistration,
    updateHealth,
  };
};

const options = (
  registry: WindowsCreatorSandboxActivationOptions['driverRegistry'],
  scheduleHealthCheck: WindowsCreatorSandboxActivationOptions['scheduleHealthCheck'] = vi.fn(() => vi.fn())
): WindowsCreatorSandboxActivationOptions => ({
  resourcesPath: 'C:\\Tomni\\resources',
  dataRoot: 'C:\\Tomni\\data',
  trustedBinarySha256: [HASH],
  trustedSignerThumbprints: [THUMBPRINT],
  driverRegistry: registry,
  scheduleHealthCheck,
});

const prepare = (fixture: BoundaryFixture) =>
  vi.fn(async (_options: WindowsCreatorSandboxBoundaryOptions) => fixture.boundary);
const productionConfiguration = () => ({
  resourcesPath: 'C:\\Tomni\\resources',
  dataRoot: 'C:\\Tomni\\data',
  sidecar: {
    expectedBinarySha256: [HASH],
    expectedSignerThumbprints: [THUMBPRINT],
    trustAdmission: {
      policy: {
        packageId: 'tomni.creator-preview.os-sandbox',
        minimumPackageVersion: '1.0.0',
        trustedSigners: [{ id: 'release', publicKey: 'test-public-key', keyPinSha256: HASH }],
        revokedManifestIds: [],
        revokedSignerIds: [],
        revokedKeyPins: [],
        revokedPackageVersions: [],
      },
      revocationSource: {
        readSnapshot: async () => ({}),
        subscribe: () => () => undefined,
      },
    },
  },
  permissionPolicy: {
    manifest: { id: 'tomni.creator-preview.os-sandbox', permissions: [] },
    policy: {},
  },
});

describe('Windows Creator Preview sandbox activation', () => {
  it('accepts a complete production configuration without test-driver hooks', () => {
    const result = validateWindowsCreatorSandboxProductionConfiguration(productionConfiguration());

    expect(result).toMatchObject({
      state: 'ready',
      configuration: {
        sidecar: {
          expectedBinarySha256: [HASH],
          expectedSignerThumbprints: [THUMBPRINT],
        },
      },
    });
  });

  it('rejects a production configuration that attempts to inject a fake sandbox dependency', () => {
    const result = validateWindowsCreatorSandboxProductionConfiguration({
      ...productionConfiguration(),
      createClient: vi.fn(),
    });

    expect(result).toEqual({ state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' });
  });

  it('keeps the registry empty when production configuration lacks a binary trust identity', async () => {
    const configuration = productionConfiguration();
    const registry = registryFixture();
    const result = await activateWindowsCreatorSandboxFromProductionConfiguration(
      {
        ...configuration,
        sidecar: {
          ...configuration.sidecar,
          expectedBinarySha256: [],
        },
      },
      registry.registry
    );

    expect(result).toEqual({ state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' });
    expect(registry.register).not.toHaveBeenCalled();
  });
  it('rejects a production configuration without a live trust-revocation source', () => {
    const configuration = productionConfiguration();
    const result = validateWindowsCreatorSandboxProductionConfiguration({
      ...configuration,
      sidecar: {
        ...configuration.sidecar,
        trustAdmission: { policy: configuration.sidecar.trustAdmission.policy },
      },
    });

    expect(result).toEqual({ state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' });
  });

  it('leaves the registry empty when package trust admission rejects the native helper', async () => {
    const registry = registryFixture();
    const prepareBoundary = vi.fn(
      async (): Promise<WindowsCreatorSandboxBoundaryResult> => ({
        state: 'unavailable',
        code: 'TRUST_ADMISSION_REJECTED',
      })
    );

    const result = await activateWindowsCreatorSandboxBoundary(options(registry.registry), { prepareBoundary });

    expect(result).toEqual({ state: 'unavailable', code: 'TRUST_ADMISSION_REJECTED' });
    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.updateHealth).not.toHaveBeenCalled();
  });

  it('registers the attested driver and refreshes health before the registry evidence becomes stale', async () => {
    const boundary = boundaryFixture();
    const registry = registryFixture();
    let scheduledCheck: (() => Promise<void>) | undefined;
    const cancelSchedule = vi.fn();
    const schedule = vi.fn((check: () => Promise<void>, intervalMs: number) => {
      scheduledCheck = check;
      expect(intervalMs).toBe(10_000);
      return cancelSchedule;
    });

    const active = await activateWindowsCreatorSandboxBoundary(options(registry.registry, schedule), {
      prepareBoundary: prepare(boundary),
    });
    expect(active.state).toBe('ready');
    if (active.state !== 'ready') throw new Error('Expected active sandbox boundary.');

    await scheduledCheck?.();
    expect(registry.register).toHaveBeenCalledOnce();
    expect(registry.updateHealth).toHaveBeenCalledWith(
      'tomni.creator-preview.os-sandbox',
      expect.objectContaining({ state: 'healthy' })
    );

    await active.dispose();
    await active.dispose();
    expect(cancelSchedule).toHaveBeenCalledOnce();
    expect(registry.unregisterRegistration).toHaveBeenCalledOnce();
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });

  it('still tears down the native helper when registry unregistration fails', async () => {
    const boundary = boundaryFixture();
    const registry = registryFixture();
    registry.unregisterRegistration.mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    const active = await activateWindowsCreatorSandboxBoundary(options(registry.registry), {
      prepareBoundary: prepare(boundary),
    });
    if (active.state !== 'ready') throw new Error('Expected active sandbox boundary.');

    await expect(active.dispose()).rejects.toThrow(/registry unavailable/i);
    expect(registry.unregisterRegistration).toHaveBeenCalledOnce();
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });

  it('disposes the helper and stays unavailable when registry admission rejects it', async () => {
    const boundary = boundaryFixture();
    const registry = registryFixture();
    registry.register.mockImplementation(() => {
      throw new Error('duplicate driver');
    });

    const result = await activateWindowsCreatorSandboxBoundary(options(registry.registry), {
      prepareBoundary: prepare(boundary),
    });

    expect(result).toEqual({ state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' });
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });

  it('unregisters and tears down the active driver when package trust is revoked live', async () => {
    const boundary = boundaryFixture();
    const registry = registryFixture();

    const active = await activateWindowsCreatorSandboxBoundary(options(registry.registry), {
      prepareBoundary: prepare(boundary),
    });
    if (active.state !== 'ready') throw new Error('Expected active sandbox boundary.');

    boundary.triggerTrustRevocation();

    expect(boundary.subscribeTrustRevocation).toHaveBeenCalledOnce();
    expect(registry.unregisterRegistration).toHaveBeenCalledOnce();
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });

  it('unregisters and tears down the active driver when its native process exits unexpectedly', async () => {
    const boundary = boundaryFixture();
    const registry = registryFixture();

    const active = await activateWindowsCreatorSandboxBoundary(options(registry.registry), {
      prepareBoundary: prepare(boundary),
    });
    if (active.state !== 'ready') throw new Error('Expected active sandbox boundary.');

    boundary.triggerProcessExit();

    expect(boundary.subscribeProcessExit).toHaveBeenCalledOnce();
    expect(registry.unregisterRegistration).toHaveBeenCalledOnce();
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });

  it('unregisters and tears down every contained process when health loses containment', async () => {
    const boundary = boundaryFixture({
      state: 'unhealthy',
      observedAt: 120,
      code: 'WINDOWS_SANDBOX_CONTAINMENT_LOST',
    });
    const registry = registryFixture();

    const active = await activateWindowsCreatorSandboxBoundary(options(registry.registry), {
      prepareBoundary: prepare(boundary),
    });
    if (active.state !== 'ready') throw new Error('Expected active sandbox boundary.');

    await expect(active.checkHealth()).resolves.toMatchObject({ state: 'unhealthy' });
    expect(registry.updateHealth).toHaveBeenCalledOnce();
    expect(registry.unregisterRegistration).toHaveBeenCalledOnce();
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });

  it('rolls registration back when health monitoring cannot be scheduled', async () => {
    const boundary = boundaryFixture();
    const registry = registryFixture();
    const schedule = vi.fn(() => {
      throw new Error('scheduler unavailable');
    });

    const result = await activateWindowsCreatorSandboxBoundary(options(registry.registry, schedule), {
      prepareBoundary: prepare(boundary),
    });

    expect(result).toEqual({ state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' });
    expect(registry.unregisterRegistration).toHaveBeenCalledOnce();
    expect(boundary.dispose).toHaveBeenCalledOnce();
  });
});
