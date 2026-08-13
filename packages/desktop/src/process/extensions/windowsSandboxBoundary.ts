/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type { PackageManifest, PackageSandboxPermissionPolicy } from '@/common/packages';
import { createWindowsCreatorSandboxProcessClient } from './windowsSandboxProcessClient';
import {
  compilePackageSandboxPermissionPolicy,
  type CanonicalPackageSandboxPermissionPolicy,
} from './windowsSandboxPermissionPolicy';
import {
  createWindowsCreatorSandboxExecutionLifecycle,
  type WindowsCreatorSandboxLifecycleEvent,
} from './windowsSandboxExecutionLifecycle';
import {
  WINDOWS_CREATOR_SANDBOX_PACKAGE_ID,
  verifyWindowsCreatorSandboxTrustAdmission,
  type WindowsCreatorSandboxTrustAdmissionFileSystem,
  type WindowsCreatorSandboxTrustPolicy,
} from './windowsSandboxTrustAdmission';
import {
  createWindowsCreatorSandboxTrustRevocationWatcher,
  type WindowsCreatorSandboxTrustRevocationSource,
} from './windowsSandboxTrustRevocation';
import type {
  CreatorSandboxDriverAttestation,
  CreatorSandboxDriverHealth,
  CreatorSandboxDriverRegistration,
} from '@process/workspace/creatorPreviewTypes';
import {
  WINDOWS_CREATOR_SANDBOX_PROTOCOL,
  WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
  WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_NEGOTIATION,
  WINDOWS_CREATOR_SANDBOX_PERMISSION_POLICY_CAPABILITY,
  WINDOWS_CREATOR_SANDBOX_SIDECAR_CAPABILITY,
  createWindowsCreatorSandboxDriverCapabilityHandshakeRequest,
  createWindowsCreatorSandboxDriver,
  parseWindowsCreatorSandboxDriverCapabilityHandshake,
  parseWindowsCreatorSandboxInitialization,
  type WindowsCreatorSandboxNativeClient,
  type WindowsCreatorSandboxWorkspaceFileSystem,
} from './windowsSandboxProtocol';

export const WINDOWS_CREATOR_SANDBOX_DRIVER_ID = WINDOWS_CREATOR_SANDBOX_PACKAGE_ID;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CERTIFICATE_THUMBPRINT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;

export type WindowsCreatorSandboxAuthenticodeObservation = {
  status: 'valid' | 'invalid' | 'unavailable';
  thumbprint?: string;
};

export type WindowsCreatorSandboxBoundaryUnavailableCode =
  | 'PLATFORM_UNSUPPORTED'
  | 'TRUST_POLICY_MISSING'
  | 'PERMISSION_POLICY_MISSING'
  | 'PERMISSION_POLICY_REJECTED'
  | 'BINARY_UNAVAILABLE'
  | 'BINARY_PATH_UNTRUSTED'
  | 'BINARY_HASH_UNTRUSTED'
  | 'BINARY_SIGNATURE_UNTRUSTED'
  | 'TRUST_ADMISSION_MISSING'
  | 'TRUST_ADMISSION_REJECTED'
  | 'TRUST_REVOCATION_UNAVAILABLE'
  | 'TRUST_REVOCATION_REJECTED'
  | 'NATIVE_PROTOCOL_UNAVAILABLE'
  | 'NATIVE_CAPABILITY_UNAVAILABLE'
  | 'NATIVE_PERMISSION_POLICY_UNAVAILABLE'
  | 'NATIVE_LIFECYCLE_UNAVAILABLE'
  | 'NATIVE_PROCESS_EXITED'
  | 'NATIVE_ATTESTATION_REJECTED';

export type PreparedWindowsCreatorSandboxBoundary = {
  state: 'ready';
  binarySha256: string;

  registration: CreatorSandboxDriverRegistration;
  observeHealth(): Promise<CreatorSandboxDriverHealth>;
  subscribeTrustRevocation(onRevoked: () => void): () => void;
  subscribeProcessExit(onExited: () => void): () => void;
  dispose(): Promise<void>;
};

export type WindowsCreatorSandboxBoundaryResult =
  | PreparedWindowsCreatorSandboxBoundary
  | { state: 'unavailable'; code: WindowsCreatorSandboxBoundaryUnavailableCode };

export type WindowsCreatorSandboxBoundaryFileSystem = {
  lstat(filePath: string): Promise<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath(filePath: string): Promise<string>;
  hashFile(filePath: string): Promise<string>;
  ensureDirectory(directoryPath: string): Promise<void>;
};

export type WindowsCreatorSandboxBoundaryOptions = {
  resourcesPath: string;
  dataRoot: string;
  trustedBinarySha256: readonly string[];
  trustedSignerThumbprints: readonly string[];
  /**
   * Required runtime grant set for the signed package. The boundary serializes only
   * its validated canonical form to the native helper.
   */
  permissionPolicy?: {
    manifest: Pick<PackageManifest, 'id' | 'permissions'>;
    policy: PackageSandboxPermissionPolicy;
  };
  /**
   * A signed package manifest and a pinned Ed25519 release signer are required in
   * addition to Authenticode. Omit this only to obtain an unavailable boundary.
   */
  trustAdmission?: {
    policy: WindowsCreatorSandboxTrustPolicy;
    fileSystem?: WindowsCreatorSandboxTrustAdmissionFileSystem;
    /** Live revocation is mandatory; unavailable or stale evidence blocks the boundary. */
    revocationSource: WindowsCreatorSandboxTrustRevocationSource;
  };
  platform?: NodeJS.Platform;
  arch?: string;
  now?: () => number;
  createAttestationChallenge?: () => string;
  requestTimeoutMs?: number;
  fileSystem?: WindowsCreatorSandboxBoundaryFileSystem;
  workspaceFileSystem?: WindowsCreatorSandboxWorkspaceFileSystem;
  onLifecycleEvent?: (event: WindowsCreatorSandboxLifecycleEvent) => void;
  verifyAuthenticode?: (binaryPath: string) => Promise<WindowsCreatorSandboxAuthenticodeObservation>;
  createClient?: (input: {
    command: string;
    args: string[];
    cwd: string;
    requestTimeoutMs: number;
  }) => WindowsCreatorSandboxNativeClient;
};

const hashFileSha256 = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const defaultFileSystem: WindowsCreatorSandboxBoundaryFileSystem = {
  lstat,
  realpath,
  hashFile: hashFileSha256,
  ensureDirectory: async (directoryPath) => {
    await mkdir(directoryPath, { recursive: true });
  },
};

const normalizeSha256 = (value: string): string | undefined => {
  const normalized = value.trim().toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : undefined;
};

const normalizeThumbprint = (value: string): string | undefined => {
  const normalized = value.replaceAll(/\s+/g, '').toLowerCase();
  return CERTIFICATE_THUMBPRINT_PATTERN.test(normalized) ? normalized : undefined;
};

const normalizeWindowsPath = (value: string): string => path.resolve(value).toLowerCase();

const createPermissionPolicyBindingSha256 = (policy: CanonicalPackageSandboxPermissionPolicy): string =>
  createHash('sha256').update(JSON.stringify(policy)).digest('hex');

const requirePermissionPolicyBinding = (value: unknown, expectedBindingSha256: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native sandbox permission policy binding acknowledgement is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const bindingSha256 =
    typeof candidate.policyBindingSha256 === 'string' ? candidate.policyBindingSha256.trim().toLowerCase() : '';
  if (candidate.acknowledged !== true || bindingSha256 !== expectedBindingSha256) {
    throw new Error('Native sandbox did not bind the package permission policy.');
  }
};

const pathIsContained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const binaryName = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'tomny-runtime.exe' : 'tomny-runtime';

const resolveVerifiedBinaryPath = async (
  options: WindowsCreatorSandboxBoundaryOptions,
  fileSystem: WindowsCreatorSandboxBoundaryFileSystem,
  platform: NodeJS.Platform,
  arch: string
): Promise<
  | { state: 'ready'; binaryPath: string; packageRoot: string }
  | { state: 'unavailable'; code: WindowsCreatorSandboxBoundaryUnavailableCode }
> => {
  if (!path.isAbsolute(options.resourcesPath)) return { state: 'unavailable', code: 'BINARY_PATH_UNTRUSTED' };
  const requestedRoot = path.resolve(options.resourcesPath, 'bundled-tomny-runtime', `${platform}-${arch}`);
  const requestedBinary = path.join(requestedRoot, binaryName(platform));
  try {
    const [rootStat, binaryStat, canonicalRootValue, canonicalBinaryValue] = await Promise.all([
      fileSystem.lstat(requestedRoot),
      fileSystem.lstat(requestedBinary),
      fileSystem.realpath(requestedRoot),
      fileSystem.realpath(requestedBinary),
    ]);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !binaryStat.isFile() || binaryStat.isSymbolicLink()) {
      return { state: 'unavailable', code: 'BINARY_PATH_UNTRUSTED' };
    }
    const canonicalRoot = path.resolve(canonicalRootValue);
    const canonicalBinary = path.resolve(canonicalBinaryValue);
    if (
      normalizeWindowsPath(canonicalRoot) !== normalizeWindowsPath(requestedRoot) ||
      normalizeWindowsPath(canonicalBinary) !== normalizeWindowsPath(requestedBinary) ||
      !pathIsContained(canonicalRoot, canonicalBinary)
    ) {
      return { state: 'unavailable', code: 'BINARY_PATH_UNTRUSTED' };
    }
    return { state: 'ready', binaryPath: canonicalBinary, packageRoot: canonicalRoot };
  } catch {
    return { state: 'unavailable', code: 'BINARY_UNAVAILABLE' };
  }
};

export const parseWindowsCreatorSandboxAuthenticode = (
  value: unknown
): WindowsCreatorSandboxAuthenticodeObservation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid' };
  const candidate = value as Record<string, unknown>;
  const status = typeof candidate.Status === 'string' ? candidate.Status.trim().toLowerCase() : '';
  const thumbprint = typeof candidate.Thumbprint === 'string' ? normalizeThumbprint(candidate.Thumbprint) : undefined;
  return status === 'valid' && thumbprint ? { status: 'valid', thumbprint } : { status: 'invalid' };
};

/** Verify Authenticode without interpolating the file path into PowerShell source. */
export const verifyWindowsCreatorSandboxAuthenticode = (
  binaryPath: string
): Promise<WindowsCreatorSandboxAuthenticodeObservation> =>
  new Promise((resolve) => {
    const script =
      "$ErrorActionPreference='Stop'; $signature=Get-AuthenticodeSignature -LiteralPath $args[0]; " +
      "$thumbprint=if($signature.SignerCertificate){$signature.SignerCertificate.Thumbprint}else{''}; " +
      '[Console]::Out.Write((@{Status=$signature.Status.ToString();Thumbprint=$thumbprint}|ConvertTo-Json -Compress))';
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script, binaryPath],
      { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 5_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ status: 'unavailable' });
          return;
        }
        try {
          resolve(parseWindowsCreatorSandboxAuthenticode(JSON.parse(stdout) as unknown));
        } catch {
          resolve({ status: 'invalid' });
        }
      }
    );
  });

const defaultClientFactory = (input: {
  command: string;
  args: string[];
  cwd: string;
  requestTimeoutMs: number;
}): WindowsCreatorSandboxNativeClient => createWindowsCreatorSandboxProcessClient(input);

const stoppedClient = async (client: WindowsCreatorSandboxNativeClient | undefined): Promise<void> => {
  await client?.stop().catch((): undefined => undefined);
};

/**
 * Prepare a production registration only after immutable path, hash, Authenticode,
 * runtime capability and native containment evidence all agree. Any missing primitive
 * leaves Creator Preview fail-closed; there is deliberately no TypeScript fallback.
 */
export const prepareWindowsCreatorSandboxBoundary = async (
  options: WindowsCreatorSandboxBoundaryOptions
): Promise<WindowsCreatorSandboxBoundaryResult> => {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return { state: 'unavailable', code: 'PLATFORM_UNSUPPORTED' };
  if (!options.permissionPolicy) return { state: 'unavailable', code: 'PERMISSION_POLICY_MISSING' };
  let permissionPolicy: CanonicalPackageSandboxPermissionPolicy;
  try {
    permissionPolicy = compilePackageSandboxPermissionPolicy(
      options.permissionPolicy.manifest,
      options.permissionPolicy.policy,
      platform
    );
  } catch {
    return { state: 'unavailable', code: 'PERMISSION_POLICY_REJECTED' };
  }

  const trustedHashes = options.trustedBinarySha256.map(normalizeSha256);
  const trustedThumbprints = options.trustedSignerThumbprints.map(normalizeThumbprint);
  if (
    trustedHashes.length === 0 ||
    trustedThumbprints.length === 0 ||
    trustedHashes.some((value) => value === undefined) ||
    trustedThumbprints.some((value) => value === undefined)
  ) {
    return { state: 'unavailable', code: 'TRUST_POLICY_MISSING' };
  }
  if (!path.isAbsolute(options.dataRoot)) return { state: 'unavailable', code: 'BINARY_PATH_UNTRUSTED' };

  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const resolved = await resolveVerifiedBinaryPath(options, fileSystem, platform, options.arch ?? process.arch);
  if (resolved.state === 'unavailable') return resolved;
  if (!options.trustAdmission) return { state: 'unavailable', code: 'TRUST_ADMISSION_MISSING' };

  const trustAdmission = await verifyWindowsCreatorSandboxTrustAdmission({
    packageRoot: resolved.packageRoot,
    binaryPath: resolved.binaryPath,
    policy: options.trustAdmission.policy,
    fileSystem: options.trustAdmission.fileSystem,
    now: options.now,
  });
  if (trustAdmission.state === 'rejected') return { state: 'unavailable', code: 'TRUST_ADMISSION_REJECTED' };
  if (permissionPolicy.packageId !== trustAdmission.manifest.package.id.trim().toLowerCase()) {
    return { state: 'unavailable', code: 'PERMISSION_POLICY_REJECTED' };
  }
  if (!options.trustAdmission.revocationSource) {
    return { state: 'unavailable', code: 'TRUST_REVOCATION_UNAVAILABLE' };
  }

  const revocationListeners = new Set<() => void>();
  let revocationTriggered = false;
  let client: WindowsCreatorSandboxNativeClient | undefined;
  const revocationWatcher = await createWindowsCreatorSandboxTrustRevocationWatcher({
    identity: {
      manifestId: trustAdmission.manifest.manifestId,
      packageId: trustAdmission.manifest.package.id,
      packageVersion: trustAdmission.manifest.package.version,
      signerId: trustAdmission.manifest.signer.id,
      keyPinSha256: trustAdmission.manifest.signer.keyPinSha256,
    },
    source: options.trustAdmission.revocationSource,
    now: options.now,
    onRevoked: async () => {
      revocationTriggered = true;
      for (const listener of revocationListeners) {
        try {
          listener();
        } catch {
          // A listener cannot weaken the terminal revocation decision.
        }
      }
      await stoppedClient(client);
    },
  });
  if (revocationWatcher.state === 'unavailable') {
    return {
      state: 'unavailable',
      code:
        revocationWatcher.code === 'TRUST_REVOCATION_REVOKED' ? 'TRUST_REVOCATION_REJECTED' : revocationWatcher.code,
    };
  }

  let binarySha256: string;
  try {
    binarySha256 = (await fileSystem.hashFile(resolved.binaryPath)).trim().toLowerCase();
  } catch {
    revocationWatcher.dispose();
    return { state: 'unavailable', code: 'BINARY_UNAVAILABLE' };
  }
  if (revocationTriggered) {
    revocationWatcher.dispose();
    return { state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' };
  }
  if (!SHA256_PATTERN.test(binarySha256) || !trustedHashes.includes(binarySha256)) {
    revocationWatcher.dispose();
    return { state: 'unavailable', code: 'BINARY_HASH_UNTRUSTED' };
  }

  const authenticode = await (options.verifyAuthenticode ?? verifyWindowsCreatorSandboxAuthenticode)(
    resolved.binaryPath
  ).catch((): WindowsCreatorSandboxAuthenticodeObservation => ({ status: 'unavailable' }));
  if (revocationTriggered) {
    revocationWatcher.dispose();
    return { state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' };
  }
  if (
    authenticode.status !== 'valid' ||
    !authenticode.thumbprint ||
    !trustedThumbprints.includes(authenticode.thumbprint)
  ) {
    revocationWatcher.dispose();
    return { state: 'unavailable', code: 'BINARY_SIGNATURE_UNTRUSTED' };
  }

  const requestTimeoutMs = Math.min(
    30_000,
    Math.max(1_000, Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS))
  );
  try {
    await fileSystem.ensureDirectory(options.dataRoot);

    if (revocationTriggered) {
      revocationWatcher.dispose();
      return { state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' };
    }
    client = (options.createClient ?? defaultClientFactory)({
      command: resolved.binaryPath,
      args: ['--data-dir', path.resolve(options.dataRoot), '--max-processes', '1'],
      cwd: path.dirname(resolved.binaryPath),
      requestTimeoutMs,
    });
    const runtime = await client.start();

    if (revocationTriggered) {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' };
    }
    if (
      !Array.isArray(runtime.capabilities) ||
      !runtime.capabilities.includes(WINDOWS_CREATOR_SANDBOX_SIDECAR_CAPABILITY) ||
      !runtime.capabilities.includes(WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_NEGOTIATION)
    ) {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'NATIVE_PROTOCOL_UNAVAILABLE' };
    }
    if (!runtime.capabilities.includes(WINDOWS_CREATOR_SANDBOX_PERMISSION_POLICY_CAPABILITY)) {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'NATIVE_PERMISSION_POLICY_UNAVAILABLE' };
    }

    try {
      parseWindowsCreatorSandboxDriverCapabilityHandshake(
        await client.request(
          'sandbox.capabilities.negotiate',
          createWindowsCreatorSandboxDriverCapabilityHandshakeRequest(),
          { timeoutMs: requestTimeoutMs }
        )
      );
    } catch {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'NATIVE_CAPABILITY_UNAVAILABLE' };
    }
    const permissionPolicyBindingSha256 = createPermissionPolicyBindingSha256(permissionPolicy);
    try {
      requirePermissionPolicyBinding(
        await client.request(
          'sandbox.permission-policy.bind',
          {
            protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
            policy: permissionPolicy,
            policyBindingSha256: permissionPolicyBindingSha256,
          },
          { timeoutMs: requestTimeoutMs }
        ),
        permissionPolicyBindingSha256
      );
    } catch {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'NATIVE_PERMISSION_POLICY_UNAVAILABLE' };
    }
    if (revocationTriggered) {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' };
    }

    const attestationChallenge = (options.createAttestationChallenge?.() ?? randomBytes(32).toString('hex'))
      .trim()
      .toLowerCase();
    if (!SHA256_PATTERN.test(attestationChallenge)) {
      throw new Error('Native sandbox attestation challenge is invalid.');
    }
    const initialization = parseWindowsCreatorSandboxInitialization(
      await client.request(
        'sandbox.initialize',
        {
          protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
          protocolVersion: WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
          binarySha256,
          attestationChallenge,
        },
        { timeoutMs: requestTimeoutMs }
      ),
      binarySha256,
      attestationChallenge
    );
    if (revocationTriggered) {
      revocationWatcher.dispose();
      await stoppedClient(client);
      return { state: 'unavailable', code: 'TRUST_REVOCATION_REJECTED' };
    }
    const readyClient = client;
    const now = options.now ?? (() => Date.now());
    const executionLifecycle = createWindowsCreatorSandboxExecutionLifecycle({
      now,
      onEvent: options.onLifecycleEvent,
    });
    const processExitListeners = new Set<() => void>();
    let disposed = false;
    let processExited = false;
    let unsubscribeProcessExit: (() => void) | undefined;
    const notifyUnexpectedProcessExit = (): void => {
      if (disposed || processExited) return;
      processExited = true;
      void executionLifecycle.handleUnexpectedProcessExit();
      for (const listener of processExitListeners) {
        try {
          listener();
        } catch {
          // The native process is terminal even if a boundary observer fails.
        }
      }
    };
    try {
      unsubscribeProcessExit = readyClient.subscribeUnexpectedExit(notifyUnexpectedProcessExit);
    } catch {
      revocationWatcher.dispose();
      await executionLifecycle.dispose();
      await stoppedClient(readyClient);
      return { state: 'unavailable', code: 'NATIVE_LIFECYCLE_UNAVAILABLE' };
    }
    if (processExited) {
      unsubscribeProcessExit();
      revocationWatcher.dispose();
      await executionLifecycle.handleUnexpectedProcessExit();
      await stoppedClient(readyClient);
      return { state: 'unavailable', code: 'NATIVE_PROCESS_EXITED' };
    }
    const driver = createWindowsCreatorSandboxDriver({
      client: readyClient,
      initialization,
      permissionPolicy,
      fileSystem: options.workspaceFileSystem,
      platform,
      requestTimeoutMs,
      executionLifecycle,
    });
    const health: CreatorSandboxDriverHealth = {
      state: 'healthy',
      observedAt: now(),
      code: 'WINDOWS_SANDBOX_READY',
    };
    const attestation: CreatorSandboxDriverAttestation = {
      state: 'accepted',
      attestedAt: now(),
      reference: `sha256:${binarySha256}`,
    };
    let disposeInFlight: Promise<void> | undefined;
    const prepared: PreparedWindowsCreatorSandboxBoundary = {
      state: 'ready',
      binarySha256,

      registration: {
        driverId: WINDOWS_CREATOR_SANDBOX_DRIVER_ID,
        driver,
        capabilityDeclaration: { ...initialization.capabilities },
        health,
        attestation,
      },
      observeHealth: async () => {
        if (disposed) return { state: 'unhealthy', observedAt: now(), code: 'WINDOWS_SANDBOX_STOPPED' };
        if (processExited) return { state: 'unhealthy', observedAt: now(), code: 'WINDOWS_SANDBOX_PROCESS_EXITED' };
        try {
          const observation = await readyClient.request<Record<string, unknown>>(
            'sandbox.health',
            { protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL },
            { timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS }
          );
          if (observation.status !== 'healthy' || observation.containmentReady !== true) {
            return { state: 'unhealthy', observedAt: now(), code: 'WINDOWS_SANDBOX_CONTAINMENT_LOST' };
          }
          return { state: 'healthy', observedAt: now(), code: 'WINDOWS_SANDBOX_READY' };
        } catch {
          return { state: 'unhealthy', observedAt: now(), code: 'WINDOWS_SANDBOX_UNREACHABLE' };
        }
      },
      subscribeTrustRevocation: (onRevoked) => {
        if (revocationTriggered) {
          try {
            onRevoked();
          } catch {
            // The boundary is terminal regardless of a registry listener fault.
          }
          return () => undefined;
        }
        revocationListeners.add(onRevoked);
        return () => {
          revocationListeners.delete(onRevoked);
        };
      },

      subscribeProcessExit: (onExited) => {
        if (processExited) {
          try {
            onExited();
          } catch {
            // The boundary remains terminal regardless of a listener fault.
          }
          return () => undefined;
        }
        processExitListeners.add(onExited);
        return () => {
          processExitListeners.delete(onExited);
        };
      },

      dispose: () => {
        if (disposeInFlight) return disposeInFlight;
        disposed = true;
        disposeInFlight = (async () => {
          unsubscribeProcessExit?.();
          unsubscribeProcessExit = undefined;
          processExitListeners.clear();
          revocationWatcher.dispose();
          revocationListeners.clear();
          await executionLifecycle.dispose();
          await readyClient
            .request(
              'sandbox.shutdown',
              { protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL },
              { timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS }
            )
            .catch((): undefined => undefined);
          await stoppedClient(readyClient);
        })();
        return disposeInFlight;
      },
    };
    return prepared;
  } catch {
    revocationWatcher.dispose();
    await stoppedClient(client);
    return { state: 'unavailable', code: 'NATIVE_ATTESTATION_REJECTED' };
  }
};
