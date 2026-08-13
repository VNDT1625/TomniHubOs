/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

import { lstat, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CreatorPreviewPolicy,
  CreatorSandboxCapabilities,
  CreatorSandboxDriver,
  CreatorSandboxStartResult,
} from '@process/workspace/creatorPreviewTypes';
import {
  createWindowsCreatorSandboxExecutionLifecycle,
  type WindowsCreatorSandboxExecutionLifecycle,
  type WindowsCreatorSandboxLifecycleSession,
} from './windowsSandboxExecutionLifecycle';
import type { CanonicalPackageSandboxPermissionPolicy } from './windowsSandboxPermissionPolicy';

export const WINDOWS_CREATOR_SANDBOX_PROTOCOL = 'tomni.creator-sandbox.v1';
export const WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION = 1;
export const WINDOWS_CREATOR_SANDBOX_SIDECAR_CAPABILITY = 'creator-sandbox.v1';
export const WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_NEGOTIATION = 'creator-sandbox.driver-capabilities.v1';
export const WINDOWS_CREATOR_SANDBOX_PERMISSION_POLICY_CAPABILITY = 'creator-sandbox.permission-policy.v1';
export const WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA = 'tomni.creator-sandbox.driver-capabilities.v1';
export const WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION = 1;
export const WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES = [
  'attestation',
  'lifecycle-events',
  'terminate-tree',
  'permission-policy',
] as const;

export type WindowsCreatorSandboxDriverCapability = (typeof WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES)[number];

export type WindowsCreatorSandboxDriverCapabilityHandshakeRequest = {
  protocol: typeof WINDOWS_CREATOR_SANDBOX_PROTOCOL;
  protocolVersion: typeof WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION;
  schema: typeof WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA;
  minimumSchemaVersion: typeof WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION;
  maximumSchemaVersion: typeof WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION;
  requiredFeatures: readonly WindowsCreatorSandboxDriverCapability[];
};

export type WindowsCreatorSandboxDriverCapabilityHandshake = {
  protocol: typeof WINDOWS_CREATOR_SANDBOX_PROTOCOL;
  protocolVersion: typeof WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION;
  schema: typeof WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA;
  schemaVersion: typeof WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION;
  features: readonly WindowsCreatorSandboxDriverCapability[];
};

const TECHNICAL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const TECHNICAL_CODE_PATTERN = /^[A-Z0-9_.:-]{1,80}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PREVIEW_PATH_PATTERN = /^\/preview\/[A-Za-z0-9_-]{16,128}\/?$/;

const DRIVER_CAPABILITY_FEATURE_SET = new Set<string>(WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES);

export type WindowsCreatorSandboxContainment = {
  appContainer: true;
  commandAllowlistEnforced: true;
  filesystemRootEnforced: true;
  jobObject: true;
  killOnJobClose: true;
  networkDefaultDeny: true;
  processMitigations: true;
  quotaEnforcement: true;
  restrictedPrimaryToken: true;
};

export type WindowsCreatorSandboxInitializeResult = {
  protocol: typeof WINDOWS_CREATOR_SANDBOX_PROTOCOL;
  protocolVersion: typeof WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION;
  runtimeVersion: string;
  binarySha256: string;
  attestationChallenge: string;
  capabilities: CreatorSandboxCapabilities;
  containment: WindowsCreatorSandboxContainment;
};

export type WindowsCreatorSandboxRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type WindowsCreatorSandboxNativeClient = {
  start(): Promise<{ capabilities: string[] }>;
  request<T>(method: string, params?: unknown, options?: WindowsCreatorSandboxRequestOptions): Promise<T>;
  stop(): Promise<void>;
  /** Subscribe to a sidecar exit not initiated by this boundary. */
  subscribeUnexpectedExit(listener: () => void): () => void;
};

export type WindowsCreatorSandboxWorkspaceFileSystem = {
  lstat(filePath: string): Promise<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath(filePath: string): Promise<string>;
};

export type WindowsCreatorSandboxDriverOptions = {
  client: WindowsCreatorSandboxNativeClient;
  initialization: WindowsCreatorSandboxInitializeResult;
  permissionPolicy: CanonicalPackageSandboxPermissionPolicy;
  fileSystem?: WindowsCreatorSandboxWorkspaceFileSystem;
  platform?: NodeJS.Platform;
  requestTimeoutMs?: number;
  executionLifecycle?: WindowsCreatorSandboxExecutionLifecycle;
};

const defaultWorkspaceFileSystem: WindowsCreatorSandboxWorkspaceFileSystem = { lstat, realpath };

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const requireTechnicalIdentifier = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!TECHNICAL_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a bounded technical identifier.`);
  }
  return normalized;
};

const normalizeTechnicalCode = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!TECHNICAL_CODE_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const requireCapabilities = (value: unknown): CreatorSandboxCapabilities => {
  const candidate = requireRecord(value, 'Sandbox capabilities');
  const networkIsolation = candidate.networkIsolation;
  if (networkIsolation !== 'blocked-only' && networkIsolation !== 'allowlist') {
    throw new Error('Native sandbox must enforce default-deny network isolation.');
  }
  if (candidate.quotaEnforcement !== true || typeof candidate.snapshots !== 'boolean') {
    throw new Error('Native sandbox capability declaration is incomplete.');
  }
  return {
    networkIsolation,
    quotaEnforcement: true,
    snapshots: candidate.snapshots,
  };
};

const requireDriverCapabilityFeatures = (value: unknown): WindowsCreatorSandboxDriverCapability[] => {
  if (!Array.isArray(value)) throw new Error('Native sandbox driver capability features must be an array.');
  const features = new Set<WindowsCreatorSandboxDriverCapability>();
  for (const feature of value) {
    if (typeof feature !== 'string' || !DRIVER_CAPABILITY_FEATURE_SET.has(feature)) {
      throw new Error('Native sandbox driver declared an unknown capability feature.');
    }
    if (features.has(feature as WindowsCreatorSandboxDriverCapability)) {
      throw new Error('Native sandbox driver declared a duplicate capability feature.');
    }
    features.add(feature as WindowsCreatorSandboxDriverCapability);
  }
  for (const feature of WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES) {
    if (!features.has(feature)) {
      throw new Error('Native sandbox driver capability feature is missing: ' + feature);
    }
  }
  return [...WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES];
};

export const createWindowsCreatorSandboxDriverCapabilityHandshakeRequest =
  (): WindowsCreatorSandboxDriverCapabilityHandshakeRequest => ({
    protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
    protocolVersion: WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
    schema: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA,
    minimumSchemaVersion: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
    maximumSchemaVersion: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
    requiredFeatures: [...WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_FEATURES],
  });

export const parseWindowsCreatorSandboxDriverCapabilityHandshake = (
  value: unknown
): WindowsCreatorSandboxDriverCapabilityHandshake => {
  const candidate = requireRecord(value, 'Native sandbox driver capability handshake');
  if (
    candidate.protocol !== WINDOWS_CREATOR_SANDBOX_PROTOCOL ||
    candidate.protocolVersion !== WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION ||
    candidate.schema !== WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA ||
    candidate.schemaVersion !== WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION
  ) {
    throw new Error('Native sandbox driver capability schema is incompatible.');
  }
  return {
    protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
    protocolVersion: WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
    schema: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA,
    schemaVersion: WINDOWS_CREATOR_SANDBOX_DRIVER_CAPABILITY_SCHEMA_VERSION,
    features: requireDriverCapabilityFeatures(candidate.features),
  };
};

const requireContainment = (value: unknown): WindowsCreatorSandboxContainment => {
  const candidate = requireRecord(value, 'Sandbox containment claims');
  const requiredClaims = [
    'appContainer',
    'commandAllowlistEnforced',
    'filesystemRootEnforced',
    'jobObject',
    'killOnJobClose',
    'networkDefaultDeny',
    'processMitigations',
    'quotaEnforcement',
    'restrictedPrimaryToken',
  ] as const;
  for (const claim of requiredClaims) {
    if (candidate[claim] !== true) throw new Error(`Native sandbox containment claim '${claim}' is missing.`);
  }
  return {
    appContainer: true,
    commandAllowlistEnforced: true,
    filesystemRootEnforced: true,
    jobObject: true,
    killOnJobClose: true,
    networkDefaultDeny: true,
    processMitigations: true,
    quotaEnforcement: true,
    restrictedPrimaryToken: true,
  };
};

export const parseWindowsCreatorSandboxInitialization = (
  value: unknown,
  expectedBinarySha256: string,
  expectedAttestationChallenge: string
): WindowsCreatorSandboxInitializeResult => {
  const candidate = requireRecord(value, 'Sandbox initialization');
  const runtimeVersion =
    typeof candidate.runtimeVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/.test(candidate.runtimeVersion)
      ? candidate.runtimeVersion
      : '';
  const binarySha256 = typeof candidate.binarySha256 === 'string' ? candidate.binarySha256.trim().toLowerCase() : '';
  const attestationChallenge =
    typeof candidate.attestationChallenge === 'string' ? candidate.attestationChallenge.trim().toLowerCase() : '';
  if (
    candidate.protocol !== WINDOWS_CREATOR_SANDBOX_PROTOCOL ||
    candidate.protocolVersion !== WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION ||
    !runtimeVersion ||
    !SHA256_PATTERN.test(binarySha256) ||
    binarySha256 !== expectedBinarySha256.toLowerCase() ||
    !SHA256_PATTERN.test(attestationChallenge) ||
    attestationChallenge !== expectedAttestationChallenge.toLowerCase()
  ) {
    throw new Error('Native sandbox initialization evidence is invalid.');
  }
  return {
    protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
    protocolVersion: WINDOWS_CREATOR_SANDBOX_PROTOCOL_VERSION,
    runtimeVersion,
    binarySha256,
    attestationChallenge,
    capabilities: requireCapabilities(candidate.capabilities),
    containment: requireContainment(candidate.containment),
  };
};

const normalizedForPlatform = (value: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? value.toLowerCase() : value;

const requireContainedPath = (root: string, target: string, platform: NodeJS.Platform): void => {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Creator preview entrypoint must resolve to a file inside the canonical workspace root.');
  }
  if (
    normalizedForPlatform(path.resolve(root, relative), platform) !==
    normalizedForPlatform(path.resolve(target), platform)
  ) {
    throw new Error('Creator preview entrypoint path is ambiguous.');
  }
};

const canonicalizeWorkspace = async (
  workspaceRoot: string,
  entrypoint: string,
  fileSystem: WindowsCreatorSandboxWorkspaceFileSystem,
  platform: NodeJS.Platform
): Promise<{ root: string; entrypoint: string }> => {
  if (!path.isAbsolute(workspaceRoot)) throw new Error('Creator preview workspace root must be absolute.');
  const requestedRoot = path.resolve(workspaceRoot);
  const rootStat = await fileSystem.lstat(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Creator preview workspace root must be a non-reparse directory.');
  }
  const canonicalRoot = path.resolve(await fileSystem.realpath(requestedRoot));
  if (normalizedForPlatform(canonicalRoot, platform) !== normalizedForPlatform(requestedRoot, platform)) {
    throw new Error('Creator preview workspace root contains a reparse or alias boundary.');
  }

  const requestedEntry = path.resolve(canonicalRoot, entrypoint);
  requireContainedPath(canonicalRoot, requestedEntry, platform);
  const entryStat = await fileSystem.lstat(requestedEntry);
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
    throw new Error('Creator preview entrypoint must be a non-reparse file.');
  }
  const canonicalEntry = path.resolve(await fileSystem.realpath(requestedEntry));
  requireContainedPath(canonicalRoot, canonicalEntry, platform);
  if (normalizedForPlatform(canonicalEntry, platform) !== normalizedForPlatform(requestedEntry, platform)) {
    throw new Error('Creator preview entrypoint contains a reparse or alias boundary.');
  }
  return {
    root: canonicalRoot,
    entrypoint: path.relative(canonicalRoot, canonicalEntry).replaceAll('\\', '/'),
  };
};

const requireAcknowledgement = (value: unknown, operation: string): void => {
  const candidate = requireRecord(value, `${operation} acknowledgement`);
  if (candidate.acknowledged !== true) throw new Error(`Native sandbox did not acknowledge ${operation}.`);
};

const parseStartResult = (value: unknown): CreatorSandboxStartResult => {
  const candidate = requireRecord(value, 'Sandbox start result');
  if (candidate.ready !== true || typeof candidate.firstMeaningfulPaintAt !== 'number') {
    throw new Error('Native sandbox omitted the readiness handshake.');
  }
  if (!Number.isFinite(candidate.firstMeaningfulPaintAt) || candidate.firstMeaningfulPaintAt < 0) {
    throw new Error('Native sandbox returned an invalid first meaningful paint timestamp.');
  }
  const previewUrl = typeof candidate.previewUrl === 'string' ? candidate.previewUrl.trim() : '';
  let parsed: URL;
  try {
    parsed = new URL(previewUrl);
  } catch {
    throw new Error('Native sandbox returned an invalid preview URL.');
  }
  if (
    parsed.protocol !== 'http:' ||
    (parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]') ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !PREVIEW_PATH_PATTERN.test(parsed.pathname)
  ) {
    throw new Error('Native sandbox preview URL is outside the loopback capability surface.');
  }
  return {
    ready: true,
    firstMeaningfulPaintAt: candidate.firstMeaningfulPaintAt,
    previewUrl: parsed.toString(),
    degradedCode: normalizeTechnicalCode(candidate.degradedCode, 'Sandbox degraded code'),
  };
};

const clonePolicy = (policy: CreatorPreviewPolicy): CreatorPreviewPolicy => ({
  quota: { ...policy.quota },
  network: { ...policy.network, allowedOrigins: [...policy.network.allowedOrigins] },
  requestedCapabilities: [...policy.requestedCapabilities],
  grantedCapabilities: [...policy.grantedCapabilities],
});

const clonePackageSandboxPermissionPolicy = (
  policy: CanonicalPackageSandboxPermissionPolicy
): CanonicalPackageSandboxPermissionPolicy => ({
  version: policy.version,
  packageId: policy.packageId,
  capabilities: policy.capabilities.map(({ capability, operations }) => ({
    capability,
    operations: {
      filesystem: {
        readRoots: [...operations.filesystem.readRoots],
        writeRoots: [...operations.filesystem.writeRoots],
      },
      network: { allowedOrigins: [...operations.network.allowedOrigins] },
      ipc: { methods: [...operations.ipc.methods] },
    },
  })),
});

/**
 * Adapt a verified native helper to the Creator Preview driver contract. This layer
 * never accepts an executable command: the helper owns a fixed internal preview host.
 */
export const createWindowsCreatorSandboxDriver = (
  options: WindowsCreatorSandboxDriverOptions
): CreatorSandboxDriver => {
  const fileSystem = options.fileSystem ?? defaultWorkspaceFileSystem;
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  const executionLifecycle = options.executionLifecycle ?? createWindowsCreatorSandboxExecutionLifecycle();
  const liveSandboxes = new Map<string, WindowsCreatorSandboxLifecycleSession>();
  const destroyedSandboxes = new Set<string>();
  const destroyInFlight = new Map<string, Promise<void>>();

  const requireLiveSandbox = (value: unknown): { sandboxId: string; session: WindowsCreatorSandboxLifecycleSession } => {
    const sandboxId = requireTechnicalIdentifier(value, 'Sandbox id');
    const session = liveSandboxes.get(sandboxId);
    if (!session) throw new Error('Sandbox id is not owned by this native driver instance.');
    return { sandboxId, session };
  };

  const request = <T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> =>
    options.client.request<T>(method, params, { signal, timeoutMs });

  const driver: CreatorSandboxDriver = {
    capabilities: { ...options.initialization.capabilities },
    create: async (input) => {
      if (input.signal.aborted) throw new DOMException('Creator preview was cancelled.', 'AbortError');
      const workspace = await canonicalizeWorkspace(input.workspaceRoot, input.entrypoint, fileSystem, platform);
      const descriptor = {
        protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
        previewId: requireTechnicalIdentifier(input.previewId, 'Preview id'),
        projectId: requireTechnicalIdentifier(input.projectId, 'Project id'),
        workspace,
        policy: clonePolicy(input.policy),
        packagePermissionPolicy: clonePackageSandboxPermissionPolicy(options.permissionPolicy),
      };
      const policyBindingSha256 = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
      const result = requireRecord(
        await request('sandbox.create', { ...descriptor, policyBindingSha256 }, input.signal),
        'Sandbox create result'
      );
      const returnedBinding =
        typeof result.policyBindingSha256 === 'string' ? result.policyBindingSha256.trim().toLowerCase() : '';
      if (returnedBinding !== policyBindingSha256) {
        throw new Error('Native sandbox did not bind the requested root and resource policy.');
      }
      const sandboxId = requireTechnicalIdentifier(result.sandboxId, 'Sandbox id');
      if (liveSandboxes.has(sandboxId) || destroyedSandboxes.has(sandboxId)) {
        throw new Error('Native sandbox reused a sandbox id.');
      }
      let session: WindowsCreatorSandboxLifecycleSession;
      try {
        session = executionLifecycle.openSession({ sessionId: sandboxId, ownerId: descriptor.projectId });
      } catch (error) {
        await request('sandbox.destroy', { protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL, sandboxId }, input.signal).catch(
          (): undefined => undefined
        );
        throw error;
      }
      liveSandboxes.set(sandboxId, session);
      return { sandboxId };
    },
    start: async ({ sandboxId, signal }) => {
      const liveSandbox = requireLiveSandbox(sandboxId);
      const execution = executionLifecycle.beginExecution(liveSandbox.session);
      try {
        return parseStartResult(
          await request(
            'sandbox.start',
            { protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL, sandboxId: liveSandbox.sandboxId },
            signal
          )
        );
      } catch (error) {
        executionLifecycle.failExecution(execution);
        throw error;
      }
    },
    suspend: async ({ sandboxId }) => {
      const liveSandbox = requireLiveSandbox(sandboxId);
      requireAcknowledgement(
        await request('sandbox.suspend', {
          protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
          sandboxId: liveSandbox.sandboxId,
        }),
        'suspend'
      );
    },
    destroy: async ({ sandboxId: rawSandboxId }) => {
      const sandboxId = requireTechnicalIdentifier(rawSandboxId, 'Sandbox id');
      if (destroyedSandboxes.has(sandboxId)) return;
      const existing = destroyInFlight.get(sandboxId);
      if (existing) return existing;
      const session = liveSandboxes.get(sandboxId);
      if (!session) throw new Error('Sandbox id is not owned by this native driver instance.');
      const work = (async () => {
        requireAcknowledgement(
          await request('sandbox.destroy', { protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL, sandboxId }),
          'destroy'
        );
        executionLifecycle.terminateSession(session);
        liveSandboxes.delete(sandboxId);
        destroyedSandboxes.add(sandboxId);
      })();
      destroyInFlight.set(sandboxId, work);
      try {
        await work;
      } finally {
        if (destroyInFlight.get(sandboxId) === work) destroyInFlight.delete(sandboxId);
      }
    },
    reset: async ({ sandboxId, snapshotId, signal }) => {
      const normalizedSnapshotId =
        snapshotId === undefined ? undefined : requireTechnicalIdentifier(snapshotId, 'Snapshot id');
      const liveSandbox = requireLiveSandbox(sandboxId);
      requireAcknowledgement(
        await request(
          'sandbox.reset',
          {
            protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL,
            sandboxId: liveSandbox.sandboxId,
            ...(normalizedSnapshotId ? { snapshotId: normalizedSnapshotId } : {}),
          },
          signal
        ),
        'reset'
      );
    },
  };

  if (options.initialization.capabilities.snapshots) {
    driver.snapshot = async ({ sandboxId, signal }) => {
      const liveSandbox = requireLiveSandbox(sandboxId);
      const result = requireRecord(
        await request(
          'sandbox.snapshot',
          { protocol: WINDOWS_CREATOR_SANDBOX_PROTOCOL, sandboxId: liveSandbox.sandboxId },
          signal
        ),
        'Sandbox snapshot result'
      );
      return { snapshotId: requireTechnicalIdentifier(result.snapshotId, 'Snapshot id') };
    };
  }

  return driver;
};
