/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';

export const WINDOWS_CREATOR_SANDBOX_PACKAGE_ID = 'tomni.creator-preview.os-sandbox';
export const WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA = 'tomni.windows-sandbox.trust.v1';
export const WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_FILE_NAME = 'tomny-runtime.trust.json';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ED25519_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;

export type WindowsCreatorSandboxTrustManifestPayload = {
  schema: typeof WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA;
  manifestId: string;
  issuedAt: number;
  expiresAt: number;
  package: {
    id: string;
    version: string;
  };
  binary: {
    path: string;
    sha256: string;
    sizeBytes: number;
  };
  signer: {
    id: string;
    keyPinSha256: string;
  };
};

export type WindowsCreatorSandboxTrustManifest = WindowsCreatorSandboxTrustManifestPayload & {
  signature: {
    algorithm: 'ed25519';
    value: string;
  };
};

export type WindowsCreatorSandboxTrustedSigner = {
  id: string;
  publicKey: string;
  keyPinSha256: string;
};

/** Every revocation collection is mandatory so callers cannot silently omit a revocation dimension. */
export type WindowsCreatorSandboxTrustPolicy = {
  packageId: string;
  minimumPackageVersion: string;
  trustedSigners: readonly WindowsCreatorSandboxTrustedSigner[];
  revokedManifestIds: readonly string[];
  revokedSignerIds: readonly string[];
  revokedKeyPins: readonly string[];
  revokedPackageVersions: readonly string[];
};

export type WindowsCreatorSandboxTrustAdmissionFileSystem = {
  lstat(filePath: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    size: number;
  }>;
  realpath(filePath: string): Promise<string>;
  readFile(filePath: string): Promise<string>;
  hashFile(filePath: string): Promise<string>;
};

export type WindowsCreatorSandboxTrustAdmissionInput = {
  packageRoot: string;
  binaryPath: string;
  policy: WindowsCreatorSandboxTrustPolicy;
  now?: () => number;
  fileSystem?: WindowsCreatorSandboxTrustAdmissionFileSystem;
};

export type WindowsCreatorSandboxTrustAdmissionCode =
  | 'TRUST_POLICY_INVALID'
  | 'TRUST_MANIFEST_UNAVAILABLE'
  | 'TRUST_MANIFEST_PATH_UNTRUSTED'
  | 'TRUST_MANIFEST_UNCANONICAL'
  | 'TRUST_MANIFEST_INVALID'
  | 'TRUST_MANIFEST_SIGNER_UNTRUSTED'
  | 'TRUST_MANIFEST_SIGNATURE_INVALID'
  | 'TRUST_MANIFEST_TIME_UNTRUSTED'
  | 'TRUST_MANIFEST_EXPIRED'
  | 'TRUST_MANIFEST_REVOKED'
  | 'TRUST_MANIFEST_VERSION_REJECTED'
  | 'TRUST_MANIFEST_BINARY_UNTRUSTED';

export type WindowsCreatorSandboxTrustAdmissionResult =
  | { state: 'accepted'; manifest: WindowsCreatorSandboxTrustManifest }
  | { state: 'rejected'; code: WindowsCreatorSandboxTrustAdmissionCode };

type ValidatedPolicy = {
  packageId: string;
  minimumPackageVersion: readonly [number, number, number];
  trustedSigners: ReadonlyMap<string, { publicKey: string; keyPinSha256: string }>;
  revokedManifestIds: ReadonlySet<string>;
  revokedSignerIds: ReadonlySet<string>;
  revokedKeyPins: ReadonlySet<string>;
  revokedPackageVersions: ReadonlySet<string>;
};

const hashFileSha256 = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const defaultFileSystem: WindowsCreatorSandboxTrustAdmissionFileSystem = {
  lstat,
  realpath,
  readFile: async (filePath) => readFile(filePath, 'utf8'),
  hashFile: hashFileSha256,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requireExactRecord = (value: unknown, label: string, keys: readonly string[]): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unexpected shape.`);
  }
  return value;
};

const requireIdentifier = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!IDENTIFIER_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
};

const normalizeSha256 = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
};

const requireEpochMilliseconds = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative epoch timestamp.`);
  }
  return value;
};

const parseVersion = (value: unknown, label: string): readonly [number, number, number] => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const match = SEMVER_PATTERN.exec(normalized);
  if (!match) throw new Error(`${label} must be a stable semantic version.`);
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new Error(`${label} is out of range.`);
  return [parts[0], parts[1], parts[2]];
};

const requireVersion = (value: unknown, label: string): string => {
  parseVersion(value, label);
  return (value as string).trim();
};

const requireRelativeBinaryPath = (value: unknown): string => {
  const requested = typeof value === 'string' ? value : '';
  const normalized = requested.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.includes('\u0000') ||
    normalized !== requested ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized)
  ) {
    throw new Error('Manifest binary path must be a bounded relative path.');
  }
  const canonical = path.posix.normalize(normalized);
  if (canonical !== normalized || canonical === '.' || canonical.startsWith('../') || canonical.includes('/../')) {
    throw new Error('Manifest binary path escapes the package root.');
  }
  return canonical;
};

const normalizePayload = (value: unknown): WindowsCreatorSandboxTrustManifestPayload => {
  const candidate = requireExactRecord(value, 'Trust manifest payload', [
    'schema',
    'manifestId',
    'issuedAt',
    'expiresAt',
    'package',
    'binary',
    'signer',
  ]);
  if (candidate.schema !== WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA) {
    throw new Error('Trust manifest schema is unsupported.');
  }
  const issuedAt = requireEpochMilliseconds(candidate.issuedAt, 'Trust manifest issuedAt');
  const expiresAt = requireEpochMilliseconds(candidate.expiresAt, 'Trust manifest expiresAt');
  if (expiresAt <= issuedAt) throw new Error('Trust manifest expiry must follow issuance.');
  const packageRecord = requireExactRecord(candidate.package, 'Trust manifest package', ['id', 'version']);
  const binaryRecord = requireExactRecord(candidate.binary, 'Trust manifest binary', ['path', 'sha256', 'sizeBytes']);
  const signerRecord = requireExactRecord(candidate.signer, 'Trust manifest signer', ['id', 'keyPinSha256']);
  const sizeBytes = binaryRecord.sizeBytes;
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new Error('Trust manifest binary size is invalid.');
  }
  return {
    schema: WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_SCHEMA,
    manifestId: requireIdentifier(candidate.manifestId, 'Trust manifest id'),
    issuedAt,
    expiresAt,
    package: {
      id: requireIdentifier(packageRecord.id, 'Trust manifest package id'),
      version: requireVersion(packageRecord.version, 'Trust manifest package version'),
    },
    binary: {
      path: requireRelativeBinaryPath(binaryRecord.path),
      sha256: normalizeSha256(binaryRecord.sha256, 'Trust manifest binary hash'),
      sizeBytes,
    },
    signer: {
      id: requireIdentifier(signerRecord.id, 'Trust manifest signer id'),
      keyPinSha256: normalizeSha256(signerRecord.keyPinSha256, 'Trust manifest signer key pin'),
    },
  };
};

const normalizeManifest = (value: unknown): WindowsCreatorSandboxTrustManifest => {
  const candidate = requireExactRecord(value, 'Trust manifest', [
    'schema',
    'manifestId',
    'issuedAt',
    'expiresAt',
    'package',
    'binary',
    'signer',
    'signature',
  ]);
  const signatureRecord = requireExactRecord(candidate.signature, 'Trust manifest signature', ['algorithm', 'value']);
  const signature = typeof signatureRecord.value === 'string' ? signatureRecord.value : '';
  if (signatureRecord.algorithm !== 'ed25519' || !ED25519_SIGNATURE_PATTERN.test(signature)) {
    throw new Error('Trust manifest signature is invalid.');
  }
  return {
    ...normalizePayload({
      schema: candidate.schema,
      manifestId: candidate.manifestId,
      issuedAt: candidate.issuedAt,
      expiresAt: candidate.expiresAt,
      package: candidate.package,
      binary: candidate.binary,
      signer: candidate.signer,
    }),
    signature: { algorithm: 'ed25519', value: signature },
  };
};

const canonicalPayloadValue = (manifest: WindowsCreatorSandboxTrustManifestPayload): Record<string, unknown> => ({
  binary: {
    path: manifest.binary.path,
    sha256: manifest.binary.sha256,
    sizeBytes: manifest.binary.sizeBytes,
  },
  expiresAt: manifest.expiresAt,
  issuedAt: manifest.issuedAt,
  manifestId: manifest.manifestId,
  package: { id: manifest.package.id, version: manifest.package.version },
  schema: manifest.schema,
  signer: { id: manifest.signer.id, keyPinSha256: manifest.signer.keyPinSha256 },
});

const normalizeCanonicalPayload = (
  value: WindowsCreatorSandboxTrustManifestPayload
): WindowsCreatorSandboxTrustManifestPayload =>
  normalizePayload({
    schema: value.schema,
    manifestId: value.manifestId,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    package: value.package,
    binary: value.binary,
    signer: value.signer,
  });

/** Serialize a validated payload in the exact byte form covered by an Ed25519 signature. */
export const canonicalizeWindowsCreatorSandboxTrustManifestPayload = (
  value: WindowsCreatorSandboxTrustManifestPayload
): string => JSON.stringify(canonicalPayloadValue(normalizeCanonicalPayload(value)));

/** Serialize a complete manifest in its only accepted on-disk representation. */
export const canonicalizeWindowsCreatorSandboxTrustManifest = (value: WindowsCreatorSandboxTrustManifest): string => {
  const manifest = normalizeManifest(value);
  return JSON.stringify({
    ...canonicalPayloadValue(manifest),
    signature: { algorithm: manifest.signature.algorithm, value: manifest.signature.value },
  });
};

export const getWindowsCreatorSandboxPublicKeyPin = (publicKey: string): string =>
  createHash('sha256')
    .update(createPublicKey(publicKey).export({ format: 'der', type: 'spki' }))
    .digest('hex');

const compareVersions = (left: readonly [number, number, number], right: readonly [number, number, number]): number => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
};

const validatePolicy = (value: WindowsCreatorSandboxTrustPolicy): ValidatedPolicy => {
  const packageId = requireIdentifier(value.packageId, 'Trust policy package id');
  const minimumPackageVersion = parseVersion(value.minimumPackageVersion, 'Trust policy minimum package version');
  if (!Array.isArray(value.trustedSigners) || value.trustedSigners.length === 0) {
    throw new Error('Trust policy must pin at least one signer.');
  }
  const trustedSigners = new Map<string, { publicKey: string; keyPinSha256: string }>();
  for (const signer of value.trustedSigners) {
    const id = requireIdentifier(signer.id, 'Trust policy signer id');
    const keyPinSha256 = normalizeSha256(signer.keyPinSha256, 'Trust policy signer key pin');
    const publicKey = typeof signer.publicKey === 'string' && signer.publicKey.trim() ? signer.publicKey : '';
    if (!publicKey || getWindowsCreatorSandboxPublicKeyPin(publicKey) !== keyPinSha256 || trustedSigners.has(id)) {
      throw new Error('Trust policy signer pin is invalid.');
    }
    trustedSigners.set(id, { publicKey, keyPinSha256 });
  }
  const manifestIds = value.revokedManifestIds.map((manifestId) =>
    requireIdentifier(manifestId, 'Revoked manifest id')
  );
  const signerIds = value.revokedSignerIds.map((signerId) => requireIdentifier(signerId, 'Revoked signer id'));
  const keyPins = value.revokedKeyPins.map((keyPin) => normalizeSha256(keyPin, 'Revoked signer key pin'));
  const packageVersions = value.revokedPackageVersions.map((version) =>
    requireVersion(version, 'Revoked package version')
  );
  return {
    packageId,
    minimumPackageVersion,
    trustedSigners,
    revokedManifestIds: new Set(manifestIds),
    revokedSignerIds: new Set(signerIds),
    revokedKeyPins: new Set(keyPins),
    revokedPackageVersions: new Set(packageVersions),
  };
};

const normalizePath = (value: string): string => path.resolve(value).toLowerCase();

const isContained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const resolveAdmissionPaths = async (
  input: WindowsCreatorSandboxTrustAdmissionInput,
  fileSystem: WindowsCreatorSandboxTrustAdmissionFileSystem
): Promise<
  | { state: 'ready'; binaryPath: string; manifestPath: string; binarySize: number }
  | { state: 'rejected'; code: 'TRUST_MANIFEST_UNAVAILABLE' | 'TRUST_MANIFEST_PATH_UNTRUSTED' }
> => {
  if (!path.isAbsolute(input.packageRoot) || !path.isAbsolute(input.binaryPath)) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_PATH_UNTRUSTED' };
  }
  const requestedRoot = path.resolve(input.packageRoot);
  const requestedBinary = path.resolve(input.binaryPath);
  const requestedManifest = path.resolve(requestedRoot, WINDOWS_CREATOR_SANDBOX_TRUST_MANIFEST_FILE_NAME);
  if (!isContained(requestedRoot, requestedBinary) || !isContained(requestedRoot, requestedManifest)) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_PATH_UNTRUSTED' };
  }
  try {
    const [rootStat, binaryStat, manifestStat, canonicalRootValue, canonicalBinaryValue, canonicalManifestValue] =
      await Promise.all([
        fileSystem.lstat(requestedRoot),
        fileSystem.lstat(requestedBinary),
        fileSystem.lstat(requestedManifest),
        fileSystem.realpath(requestedRoot),
        fileSystem.realpath(requestedBinary),
        fileSystem.realpath(requestedManifest),
      ]);
    const canonicalRoot = path.resolve(canonicalRootValue);
    const canonicalBinary = path.resolve(canonicalBinaryValue);
    const canonicalManifest = path.resolve(canonicalManifestValue);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      !binaryStat.isFile() ||
      binaryStat.isSymbolicLink() ||
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      !Number.isSafeInteger(binaryStat.size) ||
      binaryStat.size < 1 ||
      normalizePath(canonicalRoot) !== normalizePath(requestedRoot) ||
      normalizePath(canonicalBinary) !== normalizePath(requestedBinary) ||
      normalizePath(canonicalManifest) !== normalizePath(requestedManifest) ||
      !isContained(canonicalRoot, canonicalBinary) ||
      !isContained(canonicalRoot, canonicalManifest)
    ) {
      return { state: 'rejected', code: 'TRUST_MANIFEST_PATH_UNTRUSTED' };
    }
    return {
      state: 'ready',
      binaryPath: canonicalBinary,
      manifestPath: canonicalManifest,
      binarySize: binaryStat.size,
    };
  } catch {
    return { state: 'rejected', code: 'TRUST_MANIFEST_UNAVAILABLE' };
  }
};

/**
 * Independently verify the signed, canonical package admission manifest before a native
 * helper may be spawned. A rejection contains no executable driver and cannot be bypassed.
 */
export const verifyWindowsCreatorSandboxTrustAdmission = async (
  input: WindowsCreatorSandboxTrustAdmissionInput
): Promise<WindowsCreatorSandboxTrustAdmissionResult> => {
  let policy: ValidatedPolicy;
  try {
    policy = validatePolicy(input.policy);
  } catch {
    return { state: 'rejected', code: 'TRUST_POLICY_INVALID' };
  }
  const fileSystem = input.fileSystem ?? defaultFileSystem;
  const paths = await resolveAdmissionPaths(input, fileSystem);
  if (paths.state === 'rejected') return paths;

  let serialized: string;
  try {
    serialized = await fileSystem.readFile(paths.manifestPath);
  } catch {
    return { state: 'rejected', code: 'TRUST_MANIFEST_UNAVAILABLE' };
  }
  let manifest: WindowsCreatorSandboxTrustManifest;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    manifest = normalizeManifest(parsed);
    if (serialized !== canonicalizeWindowsCreatorSandboxTrustManifest(manifest)) {
      return { state: 'rejected', code: 'TRUST_MANIFEST_UNCANONICAL' };
    }
  } catch {
    return { state: 'rejected', code: 'TRUST_MANIFEST_INVALID' };
  }

  const signer = policy.trustedSigners.get(manifest.signer.id);
  if (!signer || signer.keyPinSha256 !== manifest.signer.keyPinSha256) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_SIGNER_UNTRUSTED' };
  }
  try {
    const signature = Buffer.from(manifest.signature.value, 'base64url');
    if (
      !verify(
        null,
        Buffer.from(canonicalizeWindowsCreatorSandboxTrustManifestPayload(manifest)),
        signer.publicKey,
        signature
      )
    ) {
      return { state: 'rejected', code: 'TRUST_MANIFEST_SIGNATURE_INVALID' };
    }
  } catch {
    return { state: 'rejected', code: 'TRUST_MANIFEST_SIGNATURE_INVALID' };
  }

  const now = input.now?.() ?? Date.now();
  if (!Number.isSafeInteger(now) || now < manifest.issuedAt) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_TIME_UNTRUSTED' };
  }
  if (now >= manifest.expiresAt) return { state: 'rejected', code: 'TRUST_MANIFEST_EXPIRED' };
  if (
    policy.revokedManifestIds.has(manifest.manifestId) ||
    policy.revokedSignerIds.has(manifest.signer.id) ||
    policy.revokedKeyPins.has(manifest.signer.keyPinSha256)
  ) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_REVOKED' };
  }
  if (
    manifest.package.id !== policy.packageId ||
    policy.revokedPackageVersions.has(manifest.package.version) ||
    compareVersions(
      parseVersion(manifest.package.version, 'Trust manifest package version'),
      policy.minimumPackageVersion
    ) < 0
  ) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_VERSION_REJECTED' };
  }
  if (manifest.binary.sizeBytes !== paths.binarySize) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_BINARY_UNTRUSTED' };
  }
  const expectedBinaryPath = path.resolve(input.packageRoot, manifest.binary.path);
  if (
    !isContained(path.resolve(input.packageRoot), expectedBinaryPath) ||
    normalizePath(expectedBinaryPath) !== normalizePath(paths.binaryPath)
  ) {
    return { state: 'rejected', code: 'TRUST_MANIFEST_PATH_UNTRUSTED' };
  }
  try {
    if (
      normalizeSha256(await fileSystem.hashFile(paths.binaryPath), 'Observed binary hash') !== manifest.binary.sha256
    ) {
      return { state: 'rejected', code: 'TRUST_MANIFEST_BINARY_UNTRUSTED' };
    }
  } catch {
    return { state: 'rejected', code: 'TRUST_MANIFEST_BINARY_UNTRUSTED' };
  }
  return { state: 'accepted', manifest };
};
