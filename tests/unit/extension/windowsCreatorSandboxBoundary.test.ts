import * as path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  WINDOWS_CREATOR_SANDBOX_DRIVER_ID,
  parseWindowsCreatorSandboxAuthenticode,
  prepareWindowsCreatorSandboxBoundary,
  type WindowsCreatorSandboxBoundaryFileSystem,
  type WindowsCreatorSandboxBoundaryOptions,
} from '@/process/extensions/windowsSandboxBoundary';
import {
  WINDOWS_CREATOR_SANDBOX_PROTOCOL,
  WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
  WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES,
  WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_NEGOTIATION,
  WINDOWS_CREATOR_SANDBOX_PERMISSION_POLICY_CAPABILITY,
  WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA,
  WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
  WINDOWS_CREATOR_SANDBOX_SIDECAR_CAPABILITY,
  type WindowsCreatorSandboxNativeClient,
  type WindowsCreatorSandboxWorkspaceFileSystem,
} from '@/process/extensions/windowsSandboxProtocol';
import { compilePackageSandboxPermissionPolicy } from '@/process/extensions/windowsSandboxPermissionPolicy';
import {
  WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
  WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA,
  canonicalizeWindowsCreatorSandboxTrustManifest,
  canonicalizeWindowsCreatorSandboxTrustManifestPayload,
  getWindowsCreatorSandboxPublicKeyPin,
  type WindowsCreatorSandboxTrustAdmissionFileSystem,
  type WindowsCreatorSandboxTrustManifestPayload,
  type WindowsCreatorSandboxTrustPolicy,
} from '@/process/extensions/windowsSandboxTrustAdmission';

import type {
  WindowsCreatorSandboxTrustRevocationSnapshot,
  WindowsCreatorSandboxTrustRevocationSource,
} from '@/process/extensions/windowsSandboxTrustRevocation';
import type { CreatorSandboxCreateInput } from '@/process/workspace/creatorPreviewTypes';

const HASH = 'a'.repeat(64);
const ATTESTATION_CHALLENGE = 'c'.repeat(64);
const THUMBPRINT = 'b'.repeat(40);
const RESOURCES_PATH = path.resolve('C:\\Tomni\\resources');
const DATA_ROOT = path.resolve('C:\\Tomni\\data\\creator-preview');
const WORKSPACE_ROOT = path.resolve('C:\\Projects\\alarm');
const ENTRYPOINT_PATH = path.resolve(WORKSPACE_ROOT, 'dist/index.html');
const TRUST_PACKAGE_ROOT = path.resolve(RESOURCES_PATH, 'bundled-tomny-runtime', 'win32-x64');
const TRUST_BINARY_PATH = path.resolve(TRUST_PACKAGE_ROOT, 'tomny-runtime.exe');
const TRUST_MANIFEST_PATH = path.resolve(TRUST_PACKAGE_ROOT, 'tomny-runtime.trust.json');
const TRUST_BINARY_SIZE = 1_024;
const { privateKey: trustPrivateKey, publicKey: trustPublicKey } = generateKeyPairSync('ed25519');
const TRUST_PUBLIC_KEY = trustPublicKey.export({ format: 'pem', type: 'spki' }).toString();
const TRUST_KEY_PIN = getWindowsCreatorSandboxPublicKeyPin(TRUST_PUBLIC_KEY);

const directoryStat = {
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
};
const fileStat = {
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
};

const createBoundaryFileSystem = (): WindowsCreatorSandboxBoundaryFileSystem => ({
  lstat: vi.fn(async (filePath) => (filePath.endsWith('.exe') ? fileStat : directoryStat)),
  realpath: vi.fn(async (filePath) => filePath),
  hashFile: vi.fn(async () => HASH),
  ensureDirectory: vi.fn(async () => undefined),
});

const createTrustAdmission = (): {
  policy: WindowsCreatorSandboxTrustPolicy;
  fileSystem: WindowsCreatorSandboxTrustAdmissionFileSystem;
  revocationSource: WindowsCreatorSandboxTrustRevocationSource;
} => {
  const manifestPayload: WindowsCreatorSandboxTrustManifestPayload = {
    schema: WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA,
    manifestId: 'release-20260727',
    issuedAt: 1,
    expiresAt: 1_000,
    package: { id: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID, version: '1.2.3' },
    binary: { path: 'tomny-runtime.exe', sha256: HASH, sizeBytes: TRUST_BINARY_SIZE },
    signer: { id: 'tomni-release', keyPinSha256: TRUST_KEY_PIN },
  };
  const manifest = {
    ...manifestPayload,
    signature: {
      algorithm: 'ed25519' as const,
      value: sign(
        null,
        Buffer.from(canonicalizeWindowsCreatorSandboxTrustManifestPayload(manifestPayload)),
        trustPrivateKey
      ).toString('base64url'),
    },
  };
  const serialized = canonicalizeWindowsCreatorSandboxTrustManifest(manifest);
  const policy: WindowsCreatorSandboxTrustPolicy = {
    packageId: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
    minimumPackageVersion: '1.2.3',
    trustedSigners: [{ id: 'tomni-release', publicKey: TRUST_PUBLIC_KEY, keyPinSha256: TRUST_KEY_PIN }],
    revokedManifestIds: [],
    revokedSignerIds: [],
    revokedKeyPins: [],
    revokedPackageVersions: [],
  };
  const fileSystem: WindowsCreatorSandboxTrustAdmissionFileSystem = {
    lstat: vi.fn(async (filePath) => {
      if (path.resolve(filePath) === TRUST_PACKAGE_ROOT) return { ...directoryStat, size: 0 };
      if (path.resolve(filePath) === TRUST_BINARY_PATH) return { ...fileStat, size: TRUST_BINARY_SIZE };
      if (path.resolve(filePath) === TRUST_MANIFEST_PATH) return { ...fileStat, size: serialized.length };
      throw new Error('Unexpected trust admission filesystem path.');
    }),
    realpath: vi.fn(async (filePath) => filePath),
    readFile: vi.fn(async () => serialized),
    hashFile: vi.fn(async () => HASH),
  };
  const revocationSource: WindowsCreatorSandboxTrustRevocationSource = {
    readSnapshot: vi.fn(async () => ({
      revision: 'd'.repeat(64),
      observedAt: 1,
      expiresAt: 1_000,
      revokedManifestIds: [],
      revokedSignerIds: [],
      revokedKeyPins: [],
      quarantinedPackages: [],
    })),
    subscribe: vi.fn(() => vi.fn()),
  };
  return { policy, fileSystem, revocationSource };
};

const createWorkspaceFileSystem = (
  realpathImpl: (filePath: string) => string = (filePath) => filePath
): WindowsCreatorSandboxWorkspaceFileSystem => ({
  lstat: vi.fn(async (filePath) => (path.resolve(filePath) === WORKSPACE_ROOT ? directoryStat : fileStat)),
  realpath: vi.fn(async (filePath) => realpathImpl(filePath)),
});

const validInitialization = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
  protocolVersion: WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
  runtimeVersion: '1.0.0',
  binarySha256: HASH,
  attestationChallenge: ATTESTATION_CHALLENGE,
  capabilities: { networkIsolation: 'allowlist', quotaEnforcement: true, snapshots: true },
  containment: {
    appContainer: true,
    commandAllowlistEnforced: true,
    filesystemRootEnforced: true,
    jobObject: true,
    killOnJobClose: true,
    networkDefaultDeny: true,
    processMitigations: true,
    quotaEnforcement: true,
    restrictedPrimaryToken: true,
  },
  ...overrides,
});

const validDriverCapabilityHandshake = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
  protocolVersion: WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
  schema: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA,
  schemaVersion: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
  features: [...WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES],
  ...overrides,
});

const createPermissionPolicy = (): NonNullable<WindowsCreatorSandboxBoundaryOptions['permissionPolicy']> => ({
  manifest: {
    id: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
    permissions: ['workspace.read', 'network.connect', 'host.ipc'],
  },
  policy: {
    version: 1,
    packageId: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
    capabilities: [
      { capability: 'workspace.read', filesystem: { readRoots: [WORKSPACE_ROOT] } },
      { capability: 'network.connect', network: { allowedOrigins: ['https://api.tomny.dev'] } },
      { capability: 'host.ipc', ipc: { methods: ['creator.preview.status'] } },
    ],
  },
});

type ClientFixture = {
  client: WindowsCreatorSandboxNativeClient;
  request: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  subscribeUnexpectedExit: ReturnType<typeof vi.fn>;
  triggerUnexpectedExit(): void;
};

const createClient = (
  overrides: {
    capabilities?: string[];
    driverCapabilityHandshake?: Record<string, unknown>;
    initialization?: Record<string, unknown>;
    createResult?: Record<string, unknown>;
    startResult?: Record<string, unknown>;
    permissionPolicyBinding?: Record<string, unknown>;
  } = {}
): ClientFixture => {
  const start = vi.fn(async () => ({
    capabilities: overrides.capabilities ?? [
      WINDOWS_CREATOR_SANDBOX_SIDECAR_CAPABILITY,
      WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_NEGOTIATION,
      WINDOWS_CREATOR_SANDBOX_PERMISSION_POLICY_CAPABILITY,
    ],
  }));
  const stop = vi.fn(async () => undefined);
  let unexpectedExitListener: (() => void) | undefined;
  const subscribeUnexpectedExit = vi.fn((listener: () => void) => {
    unexpectedExitListener = listener;
    return () => {
      unexpectedExitListener = undefined;
    };
  });
  const request = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'sandbox.capabilities.negotiate':
        return overrides.driverCapabilityHandshake ?? validDriverCapabilityHandshake();
      case 'sandbox.permission-policy.bind':
        return (
          overrides.permissionPolicyBinding ?? {
            acknowledged: true,
            policyBindingSha256: (params as Record<string, unknown>).policyBindingSha256,
          }
        );
      case 'sandbox.initialize':
        return overrides.initialization ?? validInitialization();
      case 'sandbox.create':
        return (
          overrides.createResult ?? {
            sandboxId: 'sandbox-alarm-1',
            policyBindingSha256: (params as Record<string, unknown>).policyBindingSha256,
          }
        );
      case 'sandbox.start':
        return (
          overrides.startResult ?? {
            ready: true,
            firstMeaningfulPaintAt: 12,
            previewUrl: 'http://127.0.0.1:43123/preview/abcdefghijklmnop',
          }
        );
      case 'sandbox.snapshot':
        return { snapshotId: 'snapshot-alarm-1' };
      case 'sandbox.health':
        return { status: 'healthy', containmentReady: true };
      default:
        return { acknowledged: true };
    }
  });
  return {
    client: {
      start,
      stop,
      request: request as WindowsCreatorSandboxNativeClient['request'],
      subscribeUnexpectedExit,
    },
    request,
    start,
    stop,
    subscribeUnexpectedExit,
    triggerUnexpectedExit: () => unexpectedExitListener?.(),
  };
};

const boundaryOptions = (
  fixture: ClientFixture,
  overrides: Partial<WindowsCreatorSandboxBoundaryOptions> = {}
): WindowsCreatorSandboxBoundaryOptions => ({
  resourcesPath: RESOURCES_PATH,
  dataRoot: DATA_ROOT,
  trustedBinarySha256: [HASH],
  trustedSignerThumbprints: [THUMBPRINT],
  permissionPolicy: createPermissionPolicy(),
  trustAdmission: createTrustAdmission(),
  platform: 'win32',
  arch: 'x64',
  now: () => 100,
  createAttestationChallenge: () => ATTESTATION_CHALLENGE,
  fileSystem: createBoundaryFileSystem(),
  workspaceFileSystem: createWorkspaceFileSystem(),
  verifyAuthenticode: vi.fn(async () => ({ status: 'valid', thumbprint: THUMBPRINT })),
  createClient: () => fixture.client,
  ...overrides,
});

const createInput = (overrides: Partial<CreatorSandboxCreateInput> = {}): CreatorSandboxCreateInput => ({
  previewId: 'preview-alarm',
  projectId: 'project-alarm',
  workspaceRoot: WORKSPACE_ROOT,
  entrypoint: 'dist/index.html',
  policy: {
    quota: { ramMiB: 256, cpuPercent: 25, diskMiB: 512, processes: 2, timeoutMs: 30_000 },
    network: { mode: 'blocked', allowedOrigins: [] },
    requestedCapabilities: [],
    grantedCapabilities: [],
  },
  signal: new AbortController().signal,
  onEvent: vi.fn(),
  ...overrides,
});

describe('Windows Creator Preview native sandbox boundary', () => {
  it('stays unavailable off Windows without touching the binary', async () => {
    const fixture = createClient();
    const fileSystem = createBoundaryFileSystem();

    const result = await prepareWindowsCreatorSandboxBoundary(
      boundaryOptions(fixture, { platform: 'linux', fileSystem })
    );

    expect(result).toEqual({ state: 'unavailable', code: 'PLATFORM_UNSUPPORTED' });
    expect(fileSystem.lstat).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it('canonicalizes manifest-declared sandbox grants and denies unrelated future capabilities', () => {
    const compiled = compilePackageSandboxPermissionPolicy(
      {
        id: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
        permissions: ['workspace.read', 'workspace.write', 'network.connect', 'host.ipc', 'future.experimental'],
      },
      {
        version: 1,
        packageId: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
        capabilities: [
          { capability: 'workspace.read', filesystem: { readRoots: [WORKSPACE_ROOT, WORKSPACE_ROOT] } },
          { capability: 'workspace.write', filesystem: { writeRoots: [DATA_ROOT] } },
          {
            capability: 'network.connect',
            network: { allowedOrigins: ['https://API.tomny.dev', 'https://api.tomny.dev'] },
          },
          { capability: 'host.ipc', ipc: { methods: ['Host.Inspect', 'host.inspect'] } },
        ],
      },
      'win32'
    );

    expect(compiled.capabilities).toEqual([
      {
        capability: 'host.ipc',
        operations: {
          filesystem: { readRoots: [], writeRoots: [] },
          network: { allowedOrigins: [] },
          ipc: { methods: ['host.inspect'] },
        },
      },
      {
        capability: 'network.connect',
        operations: {
          filesystem: { readRoots: [], writeRoots: [] },
          network: { allowedOrigins: ['https://api.tomny.dev'] },
          ipc: { methods: [] },
        },
      },
      {
        capability: 'workspace.read',
        operations: {
          filesystem: { readRoots: [WORKSPACE_ROOT.toLowerCase()], writeRoots: [] },
          network: { allowedOrigins: [] },
          ipc: { methods: [] },
        },
      },
      {
        capability: 'workspace.write',
        operations: {
          filesystem: { readRoots: [], writeRoots: [DATA_ROOT.toLowerCase()] },
          network: { allowedOrigins: [] },
          ipc: { methods: [] },
        },
      },
    ]);
  });

  it('rejects policy grants for unknown capabilities even when a manifest declares them', () => {
    expect(() =>
      compilePackageSandboxPermissionPolicy(
        { id: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID, permissions: ['future.experimental'] },
        {
          version: 1,
          packageId: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
          capabilities: [{ capability: 'future.experimental', ipc: { methods: ['host.inspect'] } }],
        },
        'win32'
      )
    ).toThrow('not supported');
  });

  it('does not launch when the package permission policy is missing or invalid', async () => {
    const missing = createClient();
    const invalid = createClient();
    const invalidPolicy = createPermissionPolicy();
    invalidPolicy.policy.capabilities = [{ capability: 'future.experimental', ipc: { methods: ['host.inspect'] } }];

    await expect(
      prepareWindowsCreatorSandboxBoundary(boundaryOptions(missing, { permissionPolicy: undefined }))
    ).resolves.toEqual({ state: 'unavailable', code: 'PERMISSION_POLICY_MISSING' });
    await expect(
      prepareWindowsCreatorSandboxBoundary(boundaryOptions(invalid, { permissionPolicy: invalidPolicy }))
    ).resolves.toEqual({ state: 'unavailable', code: 'PERMISSION_POLICY_REJECTED' });
    expect(missing.start).not.toHaveBeenCalled();
    expect(invalid.start).not.toHaveBeenCalled();
  });

  it('requires native permission-policy support and a matching bind acknowledgement before registration', async () => {
    const missingCapability = createClient({
      capabilities: [WINDOWS_CREATOR_SANDBOX_SIDECAR_CAPABILITY, WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_NEGOTIATION],
    });
    const mismatchedBinding = createClient({
      permissionPolicyBinding: { acknowledged: true, policyBindingSha256: 'd'.repeat(64) },
    });

    await expect(prepareWindowsCreatorSandboxBoundary(boundaryOptions(missingCapability))).resolves.toEqual({
      state: 'unavailable',
      code: 'NATIVE_PERMISSION_POLICY_UNAVAILABLE',
    });
    await expect(prepareWindowsCreatorSandboxBoundary(boundaryOptions(mismatchedBinding))).resolves.toEqual({
      state: 'unavailable',
      code: 'NATIVE_PERMISSION_POLICY_UNAVAILABLE',
    });
    expect(missingCapability.stop).toHaveBeenCalledOnce();
    expect(mismatchedBinding.stop).toHaveBeenCalledOnce();
  });

  it('rejects an empty or malformed binary trust policy before spawning', async () => {
    const fixture = createClient();

    const result = await prepareWindowsCreatorSandboxBoundary(
      boundaryOptions(fixture, { trustedBinarySha256: [], trustedSignerThumbprints: ['not-a-thumbprint'] })
    );

    expect(result).toEqual({ state: 'unavailable', code: 'TRUST_POLICY_MISSING' });
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it('keeps the native helper unavailable when signed package admission is missing', async () => {
    const fixture = createClient();

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture, { trustAdmission: undefined }));

    expect(result).toEqual({ state: 'unavailable', code: 'TRUST_ADMISSION_MISSING' });
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it('blocks a new native launch when the package signing key is revoked', async () => {
    const fixture = createClient();
    const trustAdmission = createTrustAdmission();
    trustAdmission.revocationSource.readSnapshot = vi.fn(async () => ({
      revision: 'd'.repeat(64),
      observedAt: 1,
      expiresAt: 1_000,
      revokedManifestIds: [],
      revokedSignerIds: [],
      revokedKeyPins: [TRUST_KEY_PIN],
      quarantinedPackages: [],
    }));

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture, { trustAdmission }));

    expect(result).toEqual({ state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' });
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it('stops a running native helper when its signer is revoked live', async () => {
    const fixture = createClient();
    const trustAdmission = createTrustAdmission();
    let currentSnapshot: WindowsCreatorSandboxTrustRevocationSnapshot = {
      revision: 'd'.repeat(64),
      observedAt: 1,
      expiresAt: 1_000,
      revokedManifestIds: [],
      revokedSignerIds: [],
      revokedKeyPins: [],
      quarantinedPackages: [],
    };
    const changeListeners = new Set<() => void>();
    trustAdmission.revocationSource = {
      readSnapshot: vi.fn(async () => currentSnapshot),
      subscribe: vi.fn((onChanged) => {
        changeListeners.add(onChanged);
        return () => changeListeners.delete(onChanged);
      }),
    };

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture, { trustAdmission }));
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');
    let resolveRevoked: (() => void) | undefined;
    const revoked = new Promise<void>((resolve) => {
      resolveRevoked = resolve;
    });
    result.subscribeTrustRevocation(() => resolveRevoked?.());

    currentSnapshot = { ...currentSnapshot, revokedSignerIds: ['tomni-release'] };
    for (const onChanged of changeListeners) onChanged();
    await revoked;
    await vi.waitFor(() => expect(fixture.stop).toHaveBeenCalled());

    await result.dispose();
  });

  it('rejects a binary whose hash is not explicitly allowlisted', async () => {
    const fixture = createClient();

    const result = await prepareWindowsCreatorSandboxBoundary(
      boundaryOptions(fixture, { trustedBinarySha256: ['c'.repeat(64)] })
    );

    expect(result).toEqual({ state: 'unavailable', code: 'BINARY_HASH_UNTRUSTED' });
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it('rejects a signed binary from a non-allowlisted publisher', async () => {
    const fixture = createClient();

    const result = await prepareWindowsCreatorSandboxBoundary(
      boundaryOptions(fixture, {
        verifyAuthenticode: vi.fn(async () => ({ status: 'valid', thumbprint: 'd'.repeat(40) })),
      })
    );

    expect(result).toEqual({ state: 'unavailable', code: 'BINARY_SIGNATURE_UNTRUSTED' });
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it('keeps the driver unavailable when the current sidecar lacks the native sandbox capability', async () => {
    const fixture = createClient({ capabilities: ['health.check', 'process.spawn'] });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_PROTOCOL_UNAVAILABLE' });
    expect(fixture.stop).toHaveBeenCalledOnce();
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it('requires an exact typed driver capability handshake before registering the sandbox driver', async () => {
    const fixture = createClient();
    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');

    expect(fixture.request).toHaveBeenCalledWith(
      'sandbox.capabilities.negotiate',
      expect.objectContaining({
        schema: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA,
        minimumSchemaVersion: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
        maximumSchemaVersion: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
        requiredFeatures: [...WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES],
      }),
      expect.objectContaining({ timeoutMs: 10_000 })
    );

    await result.dispose();
  });

  it('rejects a driver capability handshake with a required feature missing', async () => {
    const fixture = createClient({
      driverCapabilityHandshake: validDriverCapabilityHandshake({
        features: ['attestation', 'lifecycle-events'],
      }),
    });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_CAPABILITY_UNAVAILABLE' });
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('rejects a driver capability handshake with an unknown feature', async () => {
    const fixture = createClient({
      driverCapabilityHandshake: validDriverCapabilityHandshake({
        features: [...WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES, 'remote-shell'],
      }),
    });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_CAPABILITY_UNAVAILABLE' });
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('rejects a driver capability handshake with an incompatible schema identifier', async () => {
    const fixture = createClient({
      driverCapabilityHandshake: validDriverCapabilityHandshake({
        schema: 'tomni.creator-sandbox.driver-capabilities.v2',
      }),
    });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_CAPABILITY_UNAVAILABLE' });
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('rejects a driver capability handshake with an incompatible schema version', async () => {
    const fixture = createClient({
      driverCapabilityHandshake: validDriverCapabilityHandshake({ schemaVersion: 2 }),
    });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_CAPABILITY_UNAVAILABLE' });
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('rejects native initialization when any containment primitive is missing', async () => {
    const fixture = createClient({
      initialization: validInitialization({
        containment: { ...(validInitialization().containment as Record<string, unknown>), appContainer: false },
      }),
    });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_ATTESTATION_REJECTED' });
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('rejects initialization evidence replayed from a different process challenge', async () => {
    const fixture = createClient({
      initialization: validInitialization({ attestationChallenge: 'd'.repeat(64) }),
    });

    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));

    expect(result).toEqual({ state: 'unavailable', code: 'NATIVE_ATTESTATION_REJECTED' });
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('registers only the attested driver and sends no caller-controlled command to native code', async () => {
    const fixture = createClient();
    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');

    expect(result.registration.driverId).toBe(WINDOWS_CREATOR_SANDBOX_DRIVER_ID);
    expect(result.registration.attestation).toEqual(
      expect.objectContaining({ state: 'accepted', reference: `sha256:${HASH}` })
    );
    const permissionPolicyBindCall = fixture.request.mock.calls.find(
      ([method]) => method === 'sandbox.permission-policy.bind'
    );
    expect(permissionPolicyBindCall?.[1]).toEqual(
      expect.objectContaining({
        protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
        policy: expect.objectContaining({
          packageId: WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              capability: 'workspace.read',
              operations: expect.objectContaining({
                filesystem: { readRoots: [WORKSPACE_ROOT.toLowerCase()], writeRoots: [] },
              }),
            }),
          ]),
        }),
      })
    );
    const handle = await result.registration.driver.create(createInput());
    const createCall = fixture.request.mock.calls.find(([method]) => method === 'sandbox.create');
    expect(createCall).toBeDefined();
    expect(JSON.stringify(createCall?.[1])).not.toContain('command');
    expect(createCall?.[1]).toEqual(
      expect.objectContaining({
        workspace: { root: WORKSPACE_ROOT, entrypoint: 'dist/index.html' },
      })
    );

    await expect(
      result.registration.driver.start({ sandboxId: handle.sandboxId, signal: new AbortController().signal })
    ).resolves.toEqual(expect.objectContaining({ ready: true }));
    await result.registration.driver.destroy(handle);
    await result.registration.driver.destroy(handle);
    expect(fixture.request.mock.calls.filter(([method]) => method === 'sandbox.destroy')).toHaveLength(1);
    await expect(result.observeHealth()).resolves.toMatchObject({ state: 'healthy' });
    await result.dispose();
    await result.dispose();
    expect(fixture.stop).toHaveBeenCalledOnce();
  });

  it('cleans active execution state and notifies the boundary when the native process exits unexpectedly', async () => {
    const fixture = createClient();
    const events: unknown[] = [];
    const result = await prepareWindowsCreatorSandboxBoundary(
      boundaryOptions(fixture, { onLifecycleEvent: (event) => events.push(event) })
    );
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');
    const handle = await result.registration.driver.create(createInput());
    await result.registration.driver.start({ sandboxId: handle.sandboxId, signal: new AbortController().signal });
    const onExited = vi.fn();
    result.subscribeProcessExit(onExited);

    fixture.triggerUnexpectedExit();

    expect(onExited).toHaveBeenCalledOnce();
    expect(await result.observeHealth()).toMatchObject({ state: 'unhealthy', code: 'WINDOWS_SANDBOX_PROCESS_EXITED' });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'execution-terminated', code: 'PROCESS_EXITED' }),
        expect.objectContaining({ type: 'session-disposed', code: 'PROCESS_EXITED' }),
      ])
    );
    await result.dispose();
  });

  it('rejects a native create response that is not bound to the exact root and resource policy', async () => {
    const fixture = createClient({
      createResult: { sandboxId: 'sandbox-alarm-1', policyBindingSha256: 'f'.repeat(64) },
    });
    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');

    await expect(result.registration.driver.create(createInput())).rejects.toThrow(
      'bind the requested root and resource policy'
    );
    await result.dispose();
  });

  it('rejects a workspace entrypoint that crosses a reparse boundary before native create', async () => {
    const fixture = createClient();
    const workspaceFileSystem = createWorkspaceFileSystem((filePath) =>
      path.resolve(filePath) === ENTRYPOINT_PATH ? path.resolve('C:\\Secrets\\index.html') : filePath
    );
    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture, { workspaceFileSystem }));
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');

    await expect(result.registration.driver.create(createInput())).rejects.toThrow(
      'inside the canonical workspace root'
    );
    expect(fixture.request.mock.calls.filter(([method]) => method === 'sandbox.create')).toHaveLength(0);
    await result.dispose();
  });

  it('rejects a non-loopback preview surface even after native readiness', async () => {
    const fixture = createClient({
      startResult: {
        ready: true,
        firstMeaningfulPaintAt: 12,
        previewUrl: 'https://example.com/preview/abcdefghijklmnop',
      },
    });
    const result = await prepareWindowsCreatorSandboxBoundary(boundaryOptions(fixture));
    if (result.state !== 'ready') throw new Error('Expected a ready sandbox boundary.');
    const handle = await result.registration.driver.create(createInput());

    await expect(
      result.registration.driver.start({ sandboxId: handle.sandboxId, signal: new AbortController().signal })
    ).rejects.toThrow('loopback capability surface');
    await result.registration.driver.destroy(handle);
    await result.dispose();
  });

  it('parses only a valid Authenticode status with a bounded certificate thumbprint', () => {
    expect(parseWindowsCreatorSandboxAuthenticode({ Status: 'Valid', Thumbprint: THUMBPRINT.toUpperCase() })).toEqual({
      status: 'valid',
      thumbprint: THUMBPRINT,
    });
    expect(parseWindowsCreatorSandboxAuthenticode({ Status: 'UnknownError', Thumbprint: THUMBPRINT })).toEqual({
      status: 'invalid',
    });
  });
});
