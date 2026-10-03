/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { PackageManifest } from '@/common/packages';

export const PACKAGE_SANDBOX_PERMISSION_POLICY_VERSION = 1;

export const PACKAGE_SANDBOX_RUNTIME_CAPABILITIES = [
  'workspace.read',
  'workspace.write',
  'network.connect',
  'host.ipc',
] as const;

export type PackageSandboxRuntimeCapability = (typeof PACKAGE_SANDBOX_RUNTIME_CAPABILITIES)[number];

export type CanonicalPackageSandboxPermissionOperations = {
  filesystem: { readRoots: string[]; writeRoots: string[] };
  network: { allowedOrigins: string[] };
  ipc: { methods: string[] };
};

export type CanonicalPackageSandboxPermissionGrant = {
  capability: PackageSandboxRuntimeCapability;
  operations: CanonicalPackageSandboxPermissionOperations;
};

/** Canonical, native-bindable output of the package sandbox permission-policy validator. */
export type CanonicalPackageSandboxPermissionPolicy = {
  version: typeof PACKAGE_SANDBOX_PERMISSION_POLICY_VERSION;
  packageId: string;
  capabilities: CanonicalPackageSandboxPermissionGrant[];
};

export class PackageSandboxPermissionPolicyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PackageSandboxPermissionPolicyError';
  }
}

const PACKAGE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const IPC_METHOD_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const RUNTIME_CAPABILITY_SET = new Set<string>(PACKAGE_SANDBOX_RUNTIME_CAPABILITIES);

type GrantScope = 'filesystem' | 'network' | 'ipc';

const CAPABILITY_SCOPE: Record<PackageSandboxRuntimeCapability, GrantScope> = {
  'workspace.read': 'filesystem',
  'workspace.write': 'filesystem',
  'network.connect': 'network',
  'host.ipc': 'ipc',
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageSandboxPermissionPolicyError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const rejectUnknownKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new PackageSandboxPermissionPolicyError(`${label} contains an unsupported field: ${key}.`);
    }
  }
};

const requireCanonicalPackageId = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!PACKAGE_ID_PATTERN.test(normalized)) {
    throw new PackageSandboxPermissionPolicyError(`${label} must be a canonical package identifier.`);
  }
  return normalized;
};

const requireCapabilityId = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!CAPABILITY_PATTERN.test(normalized)) {
    throw new PackageSandboxPermissionPolicyError(`${label} must be a canonical capability identifier.`);
  }
  return normalized;
};

const requireStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new PackageSandboxPermissionPolicyError(`${label} must be an array.`);
  return value.map((item, index) => {
    if (typeof item !== 'string') throw new PackageSandboxPermissionPolicyError(`${label}[${index}] must be a string.`);
    return item;
  });
};

const sortUnique = (values: readonly string[]): string[] => [...new Set(values)].toSorted();

const canonicalizeFilesystemRoot = (value: string, platform: NodeJS.Platform): string => {
  const requested = value.trim();
  if (!requested || !path.isAbsolute(requested)) {
    throw new PackageSandboxPermissionPolicyError('Filesystem roots must be absolute paths.');
  }
  const resolved = path.resolve(requested);
  if (resolved === path.parse(resolved).root) {
    throw new PackageSandboxPermissionPolicyError('Filesystem roots must not grant an entire volume.');
  }
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const canonicalizeOrigin = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new PackageSandboxPermissionPolicyError('Network origins must be valid HTTPS origins.');
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.origin === 'null'
  ) {
    throw new PackageSandboxPermissionPolicyError('Network origins must be exact credential-free HTTPS origins.');
  }
  return parsed.origin;
};

const canonicalizeIpcMethod = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!IPC_METHOD_PATTERN.test(normalized)) {
    throw new PackageSandboxPermissionPolicyError('IPC methods must be canonical technical identifiers.');
  }
  return normalized;
};

const emptyOperations = (): CanonicalPackageSandboxPermissionOperations => ({
  filesystem: { readRoots: [], writeRoots: [] },
  network: { allowedOrigins: [] },
  ipc: { methods: [] },
});

const parseFilesystemScope = (
  value: unknown,
  capability: Extract<PackageSandboxRuntimeCapability, 'workspace.read' | 'workspace.write'>,
  platform: NodeJS.Platform
): CanonicalPackageSandboxPermissionOperations => {
  const candidate = requireRecord(value, 'Filesystem permission scope');
  const permitsRead = capability === 'workspace.read';
  const permitsWrite = capability === 'workspace.write';
  rejectUnknownKeys(candidate, permitsRead ? ['readRoots'] : ['writeRoots'], 'Filesystem permission scope');
  const operations = emptyOperations();
  if (permitsRead) {
    operations.filesystem.readRoots = sortUnique(
      requireStringArray(candidate.readRoots, 'filesystem.readRoots').map((root) =>
        canonicalizeFilesystemRoot(root, platform)
      )
    );
  }
  if (permitsWrite) {
    operations.filesystem.writeRoots = sortUnique(
      requireStringArray(candidate.writeRoots, 'filesystem.writeRoots').map((root) =>
        canonicalizeFilesystemRoot(root, platform)
      )
    );
  }
  if (operations.filesystem.readRoots.length + operations.filesystem.writeRoots.length === 0) {
    throw new PackageSandboxPermissionPolicyError('Filesystem permission scopes must grant at least one root.');
  }
  return operations;
};

const parseNetworkScope = (value: unknown): CanonicalPackageSandboxPermissionOperations => {
  const candidate = requireRecord(value, 'Network permission scope');
  rejectUnknownKeys(candidate, ['allowedOrigins'], 'Network permission scope');
  const operations = emptyOperations();
  operations.network.allowedOrigins = sortUnique(
    requireStringArray(candidate.allowedOrigins, 'network.allowedOrigins').map(canonicalizeOrigin)
  );
  if (operations.network.allowedOrigins.length === 0) {
    throw new PackageSandboxPermissionPolicyError('Network permission scopes must grant at least one origin.');
  }
  return operations;
};

const parseIpcScope = (value: unknown): CanonicalPackageSandboxPermissionOperations => {
  const candidate = requireRecord(value, 'IPC permission scope');
  rejectUnknownKeys(candidate, ['methods'], 'IPC permission scope');
  const operations = emptyOperations();
  operations.ipc.methods = sortUnique(requireStringArray(candidate.methods, 'ipc.methods').map(canonicalizeIpcMethod));
  if (operations.ipc.methods.length === 0) {
    throw new PackageSandboxPermissionPolicyError('IPC permission scopes must grant at least one method.');
  }
  return operations;
};

const parseGrant = (
  value: unknown,
  manifestPermissions: ReadonlySet<string>,
  platform: NodeJS.Platform
): CanonicalPackageSandboxPermissionGrant => {
  const candidate = requireRecord(value, 'Sandbox capability grant');
  rejectUnknownKeys(candidate, ['capability', 'filesystem', 'network', 'ipc'], 'Sandbox capability grant');
  const capability = requireCapabilityId(candidate.capability, 'Sandbox capability grant capability');
  if (!RUNTIME_CAPABILITY_SET.has(capability)) {
    throw new PackageSandboxPermissionPolicyError(`Sandbox capability is not supported and is denied: ${capability}.`);
  }
  if (!manifestPermissions.has(capability)) {
    throw new PackageSandboxPermissionPolicyError(
      `Sandbox capability is not declared by the package manifest: ${capability}.`
    );
  }
  const runtimeCapability = capability as PackageSandboxRuntimeCapability;
  const expectedScope = CAPABILITY_SCOPE[runtimeCapability];
  const suppliedScopes = (['filesystem', 'network', 'ipc'] as const).filter((scope) => candidate[scope] !== undefined);
  if (suppliedScopes.length !== 1 || suppliedScopes[0] !== expectedScope) {
    throw new PackageSandboxPermissionPolicyError(
      `Sandbox capability ${runtimeCapability} must declare only its ${expectedScope} operation scope.`
    );
  }
  const operations =
    runtimeCapability === 'workspace.read' || runtimeCapability === 'workspace.write'
      ? parseFilesystemScope(candidate.filesystem, runtimeCapability, platform)
      : runtimeCapability === 'network.connect'
        ? parseNetworkScope(candidate.network)
        : parseIpcScope(candidate.ipc);
  return { capability: runtimeCapability, operations };
};

/**
 * Validate and canonicalize the only package permission shapes the Windows native
 * sandbox may receive. Unknown manifest permissions never create runtime access.
 */
export const compilePackageSandboxPermissionPolicy = (
  manifest: Pick<PackageManifest, 'id' | 'permissions'>,
  policy: unknown,
  platform: NodeJS.Platform = process.platform
): CanonicalPackageSandboxPermissionPolicy => {
  const manifestId = requireCanonicalPackageId(manifest.id, 'Manifest id');
  if (!Array.isArray(manifest.permissions)) {
    throw new PackageSandboxPermissionPolicyError('Manifest permissions must be an array.');
  }
  const manifestPermissions = new Set(
    manifest.permissions.map((capability) => requireCapabilityId(capability, 'Manifest permission'))
  );
  const candidate = requireRecord(policy, 'Package sandbox permission policy');
  rejectUnknownKeys(candidate, ['version', 'packageId', 'capabilities'], 'Package sandbox permission policy');
  if (candidate.version !== PACKAGE_SANDBOX_PERMISSION_POLICY_VERSION) {
    throw new PackageSandboxPermissionPolicyError('Package sandbox permission policy version is unsupported.');
  }
  const packageId = requireCanonicalPackageId(candidate.packageId, 'Package sandbox permission policy packageId');
  if (packageId !== manifestId) {
    throw new PackageSandboxPermissionPolicyError(
      'Package sandbox permission policy does not bind the manifest package.'
    );
  }
  if (!Array.isArray(candidate.capabilities)) {
    throw new PackageSandboxPermissionPolicyError('Package sandbox permission policy capabilities must be an array.');
  }
  const grants = candidate.capabilities.map((grant) => parseGrant(grant, manifestPermissions, platform));
  const capabilityIds = new Set<string>();
  for (const grant of grants) {
    if (capabilityIds.has(grant.capability)) {
      throw new PackageSandboxPermissionPolicyError(
        `Package sandbox permission policy duplicates ${grant.capability}.`
      );
    }
    capabilityIds.add(grant.capability);
  }
  return {
    version: PACKAGE_SANDBOX_PERMISSION_POLICY_VERSION,
    packageId,
    capabilities: grants.toSorted(({ capability: left }, { capability: right }) => left.localeCompare(right)),
  };
};
