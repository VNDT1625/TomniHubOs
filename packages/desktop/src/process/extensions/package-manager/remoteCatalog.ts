/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, createPrivateKey, createPublicKey, sign as signBytes, verify } from 'node:crypto';
import path from 'node:path';
import semver from 'semver';
import type { HubExecutionTarget } from '../../foundation/hubExecutionAdapter';
import { createSystemEgressAuthority, type SystemEgressAuthority } from '../../services/security/systemEgressAuthority';
import {
  parsePackageManifest,
  parsePackageMainContributions,
  parseProductOffer,
  parseStoreSignedPublisherKeyCertificate,
  parseStoreSignedPublisherKeyRevocation,
  storePublisherKeyCertificateSignaturePayload,
  storePublisherKeyRevocationSignaturePayload,
  type PackageCatalogEntry,
  type PackageCatalogRevocation,
  type PackagePublicationReview,
  type PackageManifest,
  type PackageIdentity,
  type PackageSigningKeyPolicy,
  type PackageTrust,
  type StoreSignedPublisherKeyCertificate,
  type StoreSignedPublisherKeyRevocation,
} from '../../../common/packages';
import { packageArtifactManifestsMatch, verifyArtifactSignature } from './artifactSecurity';
import {
  canonicalizeCatalogValue,
  catalogDigest,
  createSerializedCatalogExecutor,
  fileExists,
  parseCatalogRevisionMarker,
  quarantineCatalogFile,
  readBoundedJson,
  writeJsonAtomically,
  type CatalogRevisionMarker,
} from './catalog-federation/persistence';

const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_PACKAGES = 2_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_CATALOG_VALIDITY_MS = 31 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CONFIGURED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Opaque Main-only proof that an artifact URL was carried by a Store-root-signed
 * catalog. The module-private WeakSet prevents a caller from minting equivalent
 * structural data for an arbitrary URL.
 */
export type VerifiedRemoteStoreArtifactBinding = Readonly<{ artifactUrl: string }>;

const verifiedArtifactBindings = new WeakSet<VerifiedRemoteStoreArtifactBinding>();
const verifiedArtifactBindingByEntry = new WeakMap<PackageCatalogEntry, VerifiedRemoteStoreArtifactBinding>();

const bindVerifiedRemoteStoreArtifact = (entry: PackageCatalogEntry): void => {
  if (!entry.artifactUrl) return;
  const binding = Object.freeze({ artifactUrl: entry.artifactUrl });
  verifiedArtifactBindings.add(binding);
  verifiedArtifactBindingByEntry.set(entry, binding);
};

/** Retains catalog proof only when canonical artifact identity survives normalization. */
export const retainVerifiedRemoteStoreArtifactBinding = (
  source: PackageCatalogEntry,
  target: PackageCatalogEntry
): PackageCatalogEntry => {
  const binding = verifiedArtifactBindingByEntry.get(source);
  if (binding && target.artifactUrl === binding.artifactUrl) {
    verifiedArtifactBindingByEntry.set(target, binding);
  }
  return target;
};

export const verifiedRemoteStoreArtifactBindingFor = (
  entry: PackageCatalogEntry
): VerifiedRemoteStoreArtifactBinding | undefined => verifiedArtifactBindingByEntry.get(entry);

export const isVerifiedRemoteStoreArtifactBinding = (
  binding: VerifiedRemoteStoreArtifactBinding | undefined
): binding is VerifiedRemoteStoreArtifactBinding => binding !== undefined && verifiedArtifactBindings.has(binding);

export type RemotePackageCatalogDocument = {
  schemaVersion: 1;
  revision: number;
  issuedAt: string;
  expiresAt: string;
  packages: PackageCatalogEntry[];
  /**
   * Catalog v2 carries Store-root-signed third-party publisher enrollments. Omission deliberately
   * retains the exact v1 envelope and signature payload.
   */
  publisherKeyCertificates?: StoreSignedPublisherKeyCertificate[];
  /** Catalog v2 Store-root-signed withdrawals for enrolled publisher keys. */
  publisherKeyRevocations?: StoreSignedPublisherKeyRevocation[];
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
};

export type UnsignedRemotePackageCatalogDocument = Omit<RemotePackageCatalogDocument, 'signature'>;

/**
 * A remote capability descriptor has no desktop artifact. Its endpoint is dispatched only by a
 * caller-owned governed transport; this module never downloads, installs, or activates code.
 */
export type RemoteCapabilityDescriptor = Readonly<{
  schemaVersion: 1;
  descriptorId: string;
  package: PackageIdentity;
  capability: string;
  endpoint: string;
  dataLocation: 'region-bound' | 'remote-allowed';
  expiresAt: string;
}>;

export type RemoteCapabilityCatalogDocument = Readonly<{
  schemaVersion: 1;
  revision: number;
  issuedAt: string;
  expiresAt: string;
  capabilities: readonly RemoteCapabilityDescriptor[];
  signature: RemotePackageCatalogDocument['signature'];
}>;

export type UnsignedRemoteCapabilityCatalogDocument = Omit<RemoteCapabilityCatalogDocument, 'signature'>;

export type RemoteCapabilityInvocationRequest = Readonly<{
  descriptorId: string;
  capability: string;
  idempotencyKey: string;
  timeoutMs: number;
  payload: unknown;
  /** Cancellation is in-memory only and is never serialized to the remote service. */
  signal?: AbortSignal;
}>;

export type RemoteCapabilityInvocationReceipt = Readonly<{
  descriptor: RemoteCapabilityDescriptor;
  invokedAt: string;
  result: unknown;
}>;

/** The supplied transport must route egress through the shared TrustBroker execution seam. */
export type RemoteCapabilityTransport = Readonly<{
  invoke: (
    request: Readonly<{
      descriptor: RemoteCapabilityDescriptor;
      idempotencyKey: string;
      timeoutMs: number;
      payload: unknown;
      signal?: AbortSignal;
    }>
  ) => Promise<unknown>;
}>;

export type RemoteCapabilityBroker = Readonly<{
  discover: (capability: string) => Promise<readonly RemoteCapabilityDescriptor[]>;
  invoke: (request: RemoteCapabilityInvocationRequest) => Promise<RemoteCapabilityInvocationReceipt>;
}>;
/**
 * Main-process factory only. Register its returned targets through a governed
 * Hub bootstrap; this factory never installs a package or exposes renderer IPC.
 */
export type RemoteCapabilityHubTargetOptions = Readonly<{
  broker: RemoteCapabilityBroker;
  capability: string;
  priority?: number;
  timeoutMs?: number;
  estimatedCostMB?: number;
}>;

type RemoteCapabilityBrokerOptions = Readonly<{
  loadCatalog: () => Promise<unknown>;
  trustedKeys: Readonly<Record<string, string>>;
  transport: RemoteCapabilityTransport;
  now?: () => Date;
}>;
export type RemoteCatalogValidationOptions = {
  now?: Date;
  allowExpired?: boolean;
};

type RemoteCatalogLoaderOptions = {
  url: string;
  cachePath: string;
  fallbackCatalog: readonly PackageCatalogEntry[];
  trustedKeys: Readonly<Record<string, string>>;
  signingPolicies?: Readonly<Record<string, PackageSigningKeyPolicy>>;
  /**
   * Receives only currently valid, non-revoked third-party keys after the
   * whole catalog and every certificate/revocation signature are verified.
   * The callback must replace—not merge—its previous ephemeral key set.
   */
  onVerifiedStorePublisherKeys?: (keys: Readonly<Record<string, string>>) => void;
  fetcher?: typeof fetch;
  /** Shared Main-only authority guarding the pre-auth signed catalog refresh. */
  egressAuthority?: SystemEgressAuthority;
  /** Packaged desktop accepts only the deployment-pinned catalog endpoint. */
  isPackaged?: boolean;
  now?: () => Date;
  maxCacheAgeMs?: number;
};

type CachedRemoteCatalog = {
  schemaVersion: 1;
  cachedAt: string;
  document: unknown;
};

type RemoteCachePaths = {
  active: string;
  recovery: string;
  rollback: string;
  marker: string;
  quarantine: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseIsoDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid date.`);
  }
  return value;
};

const parsePositiveRevision = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Store catalog revision must be a positive safe integer.');
  }
  return value;
};

const parseCatalogSignature = (value: unknown): RemotePackageCatalogDocument['signature'] => {
  if (!isRecord(value) || value.algorithm !== 'ed25519' || typeof value.keyId !== 'string' || !value.keyId.trim()) {
    throw new Error('Store catalog signature header is invalid.');
  }
  if (typeof value.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value.value)) {
    throw new Error('Store catalog signature is not valid Ed25519 base64.');
  }
  if (Buffer.from(value.value, 'base64').byteLength !== 64) {
    throw new Error('Store catalog signature must contain exactly 64 bytes.');
  }
  return { algorithm: 'ed25519', keyId: value.keyId.trim(), value: value.value };
};

export const remoteCatalogSignaturePayload = (
  document: Pick<
    RemotePackageCatalogDocument,
    | 'schemaVersion'
    | 'revision'
    | 'issuedAt'
    | 'expiresAt'
    | 'packages'
    | 'publisherKeyCertificates'
    | 'publisherKeyRevocations'
    | 'signature'
  >
): string =>
  canonicalizeCatalogValue({
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    issuedAt: document.issuedAt,
    expiresAt: document.expiresAt,
    packages: document.packages,
    ...(document.publisherKeyCertificates === undefined
      ? {}
      : { publisherKeyCertificates: document.publisherKeyCertificates }),
    ...(document.publisherKeyRevocations === undefined
      ? {}
      : { publisherKeyRevocations: document.publisherKeyRevocations }),
    signature: { algorithm: document.signature.algorithm, keyId: document.signature.keyId },
  });

export const signRemotePackageCatalog = (
  document: UnsignedRemotePackageCatalogDocument,
  keyId: string,
  privateKeyPem: string
): RemotePackageCatalogDocument => {
  if (!keyId.trim()) throw new Error('Store catalog signing key ID is required.');
  const unsigned = {
    ...document,
    signature: { algorithm: 'ed25519' as const, keyId: keyId.trim(), value: '' },
  };
  const value = signBytes(
    null,
    Buffer.from(remoteCatalogSignaturePayload(unsigned)),
    createPrivateKey(privateKeyPem)
  ).toString('base64');
  return { ...unsigned, signature: { ...unsigned.signature, value } };
};

const REMOTE_CAPABILITY_MAX_COUNT = 2_000;
const MAX_REMOTE_JSON_DEPTH = 16;
const MAX_REMOTE_JSON_NODES = 10_000;
const MAX_REMOTE_STRING_LENGTH = 100_000;
const CONTRACT_ID = /^[A-Za-z0-9._:-]+$/;
const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const CAPABILITY_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;

const hasOnlyKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).every((key) => expected.includes(key)) && expected.every((key) => key in value);

const parseContractId = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !CONTRACT_ID.test(value) || value.length > 200) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
};

const parseCapabilityId = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !CAPABILITY_ID.test(value) || value.length > 160) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
};

const parseRemotePackageIdentity = (value: unknown): PackageIdentity => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['packageId', 'packageVersion', 'publisherId'])) {
    throw new Error('Remote capability package identity is invalid.');
  }
  const packageId = value.packageId;
  const publisherId = value.publisherId;
  const packageVersion = value.packageVersion;
  if (
    typeof packageId !== 'string' ||
    !PACKAGE_ID.test(packageId) ||
    packageId.length > 200 ||
    typeof publisherId !== 'string' ||
    !PACKAGE_ID.test(publisherId) ||
    publisherId.length > 200 ||
    typeof packageVersion !== 'string' ||
    packageVersion.length > 128 ||
    semver.valid(packageVersion) === null
  ) {
    throw new Error('Remote capability package identity is invalid.');
  }
  return { packageId, packageVersion, publisherId };
};

const parseCatalogRevocation = (value: unknown): PackageCatalogRevocation => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['schemaVersion', 'reasonCode', 'revokedAt']) ||
    value.schemaVersion !== 1 ||
    typeof value.reasonCode !== 'string' ||
    !/^[A-Z][A-Z0-9_]{2,63}$/.test(value.reasonCode)
  ) {
    throw new Error('Remote Store package revocation is invalid.');
  }
  return {
    schemaVersion: 1,
    reasonCode: value.reasonCode,
    revokedAt: parseIsoDate(value.revokedAt, 'Revocation time'),
  };
};

const parsePublicationReview = (
  value: unknown,
  expectedArtifactIntegrity: string | undefined
): PackagePublicationReview => {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    typeof value.fingerprint !== 'string'
  ) {
    throw new Error('Remote Store publication review is invalid.');
  }
  if (!/^sha256-[a-f0-9]{64}$/.test(value.fingerprint)) {
    throw new Error('Remote Store publication review is invalid.');
  }
  const reviewedAt = parseIsoDate(value.reviewedAt, 'Publication review time');
  if (
    value.schemaVersion === 1 &&
    value.disposition === 'auto-approved' &&
    hasOnlyKeys(value, ['schemaVersion', 'disposition', 'fingerprint', 'reviewedAt'])
  ) {
    return { schemaVersion: 1, disposition: 'auto-approved', fingerprint: value.fingerprint, reviewedAt };
  }
  if (
    value.schemaVersion === 1 &&
    value.disposition === 'human-approved' &&
    hasOnlyKeys(value, ['schemaVersion', 'disposition', 'fingerprint', 'reviewedAt', 'reviewerId']) &&
    typeof value.reviewerId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$/.test(value.reviewerId)
  ) {
    return {
      schemaVersion: 1,
      disposition: 'human-approved',
      fingerprint: value.fingerprint,
      reviewedAt,
      reviewerId: value.reviewerId,
    };
  }
  if (
    value.schemaVersion === 2 &&
    value.disposition === 'auto-approved' &&
    typeof value.artifactIntegrity === 'string' &&
    value.artifactIntegrity === expectedArtifactIntegrity &&
    /^sha256-[a-f0-9]{64}$/.test(value.artifactIntegrity) &&
    hasOnlyKeys(value, ['schemaVersion', 'disposition', 'fingerprint', 'artifactIntegrity', 'reviewedAt'])
  ) {
    return {
      schemaVersion: 2,
      disposition: 'auto-approved',
      fingerprint: value.fingerprint,
      artifactIntegrity: value.artifactIntegrity,
      reviewedAt,
    };
  }
  if (
    value.schemaVersion === 2 &&
    value.disposition === 'human-approved' &&
    typeof value.artifactIntegrity === 'string' &&
    value.artifactIntegrity === expectedArtifactIntegrity &&
    /^sha256-[a-f0-9]{64}$/.test(value.artifactIntegrity) &&
    hasOnlyKeys(value, [
      'schemaVersion',
      'disposition',
      'fingerprint',
      'artifactIntegrity',
      'reviewedAt',
      'reviewerId',
    ]) &&
    typeof value.reviewerId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$/.test(value.reviewerId)
  ) {
    return {
      schemaVersion: 2,
      disposition: 'human-approved',
      fingerprint: value.fingerprint,
      artifactIntegrity: value.artifactIntegrity,
      reviewedAt,
      reviewerId: value.reviewerId,
    };
  }
  throw new Error('Remote Store publication review is invalid.');
};

const parseRemoteCapabilityEndpoint = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 2_048) throw new Error('Remote capability endpoint is invalid.');
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Remote capability endpoint is invalid.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Remote capability endpoint must be credential-free HTTPS without a fragment.');
  }
  return endpoint.toString();
};

const parseRemoteCapabilityDescriptor = (value: unknown): RemoteCapabilityDescriptor => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'descriptorId',
      'package',
      'capability',
      'endpoint',
      'dataLocation',
      'expiresAt',
    ]) ||
    value.schemaVersion !== 1
  ) {
    throw new Error('Remote capability descriptor is invalid.');
  }
  if (value.dataLocation !== 'region-bound' && value.dataLocation !== 'remote-allowed') {
    throw new Error('Remote capability data location is invalid.');
  }
  return {
    schemaVersion: 1,
    descriptorId: parseContractId(value.descriptorId, 'Remote capability descriptor ID'),
    package: parseRemotePackageIdentity(value.package),
    capability: parseCapabilityId(value.capability, 'Remote capability name'),
    endpoint: parseRemoteCapabilityEndpoint(value.endpoint),
    dataLocation: value.dataLocation,
    expiresAt: parseIsoDate(value.expiresAt, 'Remote capability expiry time'),
  };
};

const parseBoundedRemoteJson = (value: unknown, state = { nodes: 0 }, depth = 0): unknown => {
  state.nodes += 1;
  if (state.nodes > MAX_REMOTE_JSON_NODES || depth > MAX_REMOTE_JSON_DEPTH) {
    throw new Error('Remote capability payload exceeds structural limits.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Remote capability payload contains a non-finite number.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_REMOTE_STRING_LENGTH)
      throw new Error('Remote capability payload contains an oversized string.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_REMOTE_JSON_NODES) throw new Error('Remote capability payload contains too many values.');
    return value.map((entry) => parseBoundedRemoteJson(entry, state, depth + 1));
  }
  if (!isRecord(value)) throw new Error('Remote capability payload must be JSON-compatible.');
  const entries = Object.entries(value);
  if (entries.length > MAX_REMOTE_JSON_NODES) throw new Error('Remote capability payload contains too many values.');
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (!key || key.length > 200 || key.includes('__proto__') || key === 'constructor' || key === 'prototype') {
        throw new Error('Remote capability payload contains an unsafe key.');
      }
      return [key, parseBoundedRemoteJson(entry, state, depth + 1)];
    })
  );
};

export const remoteCapabilityCatalogSignaturePayload = (
  document: Pick<
    RemoteCapabilityCatalogDocument,
    'schemaVersion' | 'revision' | 'issuedAt' | 'expiresAt' | 'capabilities' | 'signature'
  >
): string =>
  canonicalizeCatalogValue({
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    issuedAt: document.issuedAt,
    expiresAt: document.expiresAt,
    capabilities: document.capabilities,
    signature: { algorithm: document.signature.algorithm, keyId: document.signature.keyId },
  });

export const signRemoteCapabilityCatalog = (
  document: UnsignedRemoteCapabilityCatalogDocument,
  keyId: string,
  privateKeyPem: string
): RemoteCapabilityCatalogDocument => {
  if (!keyId.trim()) throw new Error('Remote capability catalog signing key ID is required.');
  const unsigned = {
    ...document,
    signature: { algorithm: 'ed25519' as const, keyId: keyId.trim(), value: '' },
  };
  const value = signBytes(
    null,
    Buffer.from(remoteCapabilityCatalogSignaturePayload(unsigned)),
    createPrivateKey(privateKeyPem)
  ).toString('base64');
  return { ...unsigned, signature: { ...unsigned.signature, value } };
};

export const parseRemoteCapabilityCatalog = (
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  { now = new Date(), allowExpired = false }: RemoteCatalogValidationOptions = {}
): RemoteCapabilityCatalogDocument => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['schemaVersion', 'revision', 'issuedAt', 'expiresAt', 'capabilities', 'signature']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > REMOTE_CAPABILITY_MAX_COUNT
  ) {
    throw new Error('Remote capability catalog envelope is invalid.');
  }
  const revision = parsePositiveRevision(value.revision);
  const issuedAt = parseIsoDate(value.issuedAt, 'Remote capability catalog issue time');
  const expiresAt = parseIsoDate(value.expiresAt, 'Remote capability catalog expiry time');
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (
    issuedMs > now.getTime() + MAX_CLOCK_SKEW_MS ||
    expiresMs <= issuedMs ||
    expiresMs - issuedMs > MAX_CATALOG_VALIDITY_MS ||
    (!allowExpired && expiresMs <= now.getTime())
  ) {
    throw new Error('Remote capability catalog validity window is invalid.');
  }
  const signature = parseCatalogSignature(value.signature);
  const trustedKey = trustedKeys[signature.keyId];
  if (!trustedKey) throw new Error(`Remote capability catalog signing key is not trusted: ${signature.keyId}`);
  const signedDocument = {
    schemaVersion: 1 as const,
    revision,
    issuedAt,
    expiresAt,
    capabilities: value.capabilities,
    signature,
  };
  if (
    !verify(
      null,
      Buffer.from(remoteCapabilityCatalogSignaturePayload(signedDocument)),
      createPublicKey(trustedKey),
      Buffer.from(signature.value, 'base64')
    )
  ) {
    throw new Error('Remote capability catalog signature verification failed.');
  }
  const descriptorIds = new Set<string>();
  const capabilities = value.capabilities.map((rawDescriptor) => {
    const descriptor = parseRemoteCapabilityDescriptor(rawDescriptor);
    if (descriptorIds.has(descriptor.descriptorId)) {
      throw new Error(`Duplicate remote capability descriptor: ${descriptor.descriptorId}`);
    }
    if (Date.parse(descriptor.expiresAt) <= now.getTime() || Date.parse(descriptor.expiresAt) > expiresMs) {
      throw new Error('Remote capability descriptor expiry is outside the catalog validity window.');
    }
    descriptorIds.add(descriptor.descriptorId);
    return descriptor;
  });
  return { schemaVersion: 1, revision, issuedAt, expiresAt, capabilities, signature };
};

/**
 * Discovery and invocation are deliberately artifact-free. The caller owns loading the signed
 * catalog and provides a transport already governed by TrustBroker; installation is impossible
 * through this API because descriptors contain no artifact or package-manager operation.
 */
export const createRemoteCapabilityBroker = ({
  loadCatalog,
  trustedKeys,
  transport,
  now = () => new Date(),
}: RemoteCapabilityBrokerOptions): RemoteCapabilityBroker => {
  const loadVerifiedCatalog = async (): Promise<RemoteCapabilityCatalogDocument> =>
    parseRemoteCapabilityCatalog(await loadCatalog(), trustedKeys, { now: now() });

  const discover = async (rawCapability: string): Promise<readonly RemoteCapabilityDescriptor[]> => {
    const capability = parseCapabilityId(rawCapability, 'Remote capability name');
    const catalog = await loadVerifiedCatalog();
    return catalog.capabilities.filter((descriptor) => descriptor.capability === capability);
  };

  const invoke = async (request: RemoteCapabilityInvocationRequest): Promise<RemoteCapabilityInvocationReceipt> => {
    const descriptorId = parseContractId(request.descriptorId, 'Remote capability descriptor ID');
    const capability = parseCapabilityId(request.capability, 'Remote capability name');
    const idempotencyKey = parseContractId(request.idempotencyKey, 'Remote capability idempotency key');
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 10 * 60 * 1_000) {
      throw new Error('Remote capability timeout is invalid.');
    }
    const payload = parseBoundedRemoteJson(request.payload);
    const catalog = await loadVerifiedCatalog();
    const descriptor = catalog.capabilities.find((candidate) => candidate.descriptorId === descriptorId);
    if (!descriptor || descriptor.capability !== capability) {
      throw new Error('Remote capability descriptor is unavailable for the requested capability.');
    }
    const result = parseBoundedRemoteJson(
      await transport.invoke({
        descriptor: structuredClone(descriptor),
        idempotencyKey,
        timeoutMs: request.timeoutMs,
        payload,
        signal: request.signal,
      })
    );
    return { descriptor, invokedAt: now().toISOString(), result };
  };

  return { discover, invoke };
};

/**
 * Converts signed remote descriptors into normal Hub targets. The surrounding
 * HubExecutionAdapter supplies Run Kernel, Trust grant, final egress, resource,
 * receipt, and cancellation governance before this transport is entered.
 */
export const createRemoteCapabilityHubTargets = async ({
  broker,
  capability: rawCapability,
  priority = 10,
  timeoutMs = 30_000,
  estimatedCostMB = 64,
}: RemoteCapabilityHubTargetOptions): Promise<readonly HubExecutionTarget[]> => {
  const capability = parseCapabilityId(rawCapability, 'Remote capability name');
  if (!Number.isSafeInteger(priority) || priority < 0) throw new Error('Remote capability target priority is invalid.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60 * 1_000) {
    throw new Error('Remote capability target timeout is invalid.');
  }
  if (!Number.isSafeInteger(estimatedCostMB) || estimatedCostMB < 1) {
    throw new Error('Remote capability target resource estimate is invalid.');
  }
  const descriptors = await broker.discover(capability);
  return [...descriptors]
    .sort((left, right) => left.descriptorId.localeCompare(right.descriptorId))
    .map((descriptor): HubExecutionTarget => {
      const endpoint = new URL(descriptor.endpoint);
      return {
        id: `remote-capability:${descriptor.descriptorId}`,
        kind: 'cloud',
        priority,
        estimatedCostMB,
        networkHost: endpoint.hostname,
        requestedCapabilities: [capability],
        execute: async ({ intent, signal }) => {
          if (signal?.aborted) throw new Error('REMOTE_CAPABILITY_ABORTED');
          const idempotencyKey = `remote:${createHash('sha256')
            .update(`${intent.runId}:${intent.rootTaskId}:${descriptor.descriptorId}`)
            .digest('hex')}`;
          const receipt = await broker.invoke({
            descriptorId: descriptor.descriptorId,
            capability,
            idempotencyKey,
            timeoutMs,
            payload: { goal: intent.goal, runId: intent.runId, taskId: intent.rootTaskId },
            signal,
          });
          if (signal?.aborted) throw new Error('REMOTE_CAPABILITY_ABORTED');
          return {
            text: JSON.stringify(receipt.result),
            evidenceRefs: [`remote-capability:${receipt.descriptor.descriptorId}:${receipt.invokedAt}`],
          };
        },
      };
    });
};

type CatalogPublisherKeyAdmission = Readonly<{
  trustedKeys: Readonly<Record<string, string>>;
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>>;
  certificatesByKeyId: ReadonlyMap<
    string,
    Readonly<{ certificate: StoreSignedPublisherKeyCertificate; revoked: boolean }>
  >;
  publisherKeyCertificates?: StoreSignedPublisherKeyCertificate[];
  publisherKeyRevocations?: StoreSignedPublisherKeyRevocation[];
}>;

const isProtectedTomniNamespace = (value: string): boolean => value === 'com.tomni' || value.startsWith('com.tomni.');

const hasOwn = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const verifyStoreRootSignature = (
  payload: string,
  signature: StoreSignedPublisherKeyCertificate['signature'],
  trustedKeys: Readonly<Record<string, string>>,
  recordName: string
): void => {
  const rootKey = trustedKeys[signature.keyId];
  if (!rootKey) throw new Error(`Store ${recordName} signing key is not trusted: ${signature.keyId}`);
  try {
    if (!verify(null, Buffer.from(payload), createPublicKey(rootKey), Buffer.from(signature.value, 'base64'))) {
      throw new Error(`Store ${recordName} signature verification failed.`);
    }
  } catch (error) {
    throw new Error(`Store ${recordName} signature verification failed.`, { cause: error });
  }
};

const publisherSigningKeyDigest = (publicKeyPem: string): string => {
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('Store publisher key certificate public key is invalid.');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Store publisher key certificate must contain an Ed25519 public key.');
  }
  return `sha256-${createHash('sha256')
    .update(publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex')}`;
};

const parseCatalogPublisherKeyAdmission = (
  rawCertificates: unknown,
  rawRevocations: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>>,
  now: Date
): CatalogPublisherKeyAdmission => {
  if (rawCertificates !== undefined && !Array.isArray(rawCertificates)) {
    throw new Error('Store catalog publisher key certificates must be an array.');
  }
  if (rawRevocations !== undefined && !Array.isArray(rawRevocations)) {
    throw new Error('Store catalog publisher key revocations must be an array.');
  }
  const publisherKeyCertificates =
    rawCertificates === undefined
      ? undefined
      : (rawCertificates as unknown[]).map((certificate) => parseStoreSignedPublisherKeyCertificate(certificate));
  const publisherKeyRevocations =
    rawRevocations === undefined
      ? undefined
      : (rawRevocations as unknown[]).map((revocation) => parseStoreSignedPublisherKeyRevocation(revocation));
  const certificateIds = new Set<string>();
  const signingKeyIds = new Set<string>();
  const signingKeyPems = new Set<string>();
  const certificatesById = new Map<string, StoreSignedPublisherKeyCertificate>();
  const certificatesByKeyId = new Map<
    string,
    Readonly<{ certificate: StoreSignedPublisherKeyCertificate; revoked: boolean }>
  >();
  const nowMs = now.getTime();

  for (const certificate of publisherKeyCertificates ?? []) {
    if (certificateIds.has(certificate.certificateId) || signingKeyIds.has(certificate.signingKey.keyId)) {
      throw new Error('Store catalog contains duplicate publisher key certificates.');
    }
    if (signingKeyPems.has(certificate.signingKey.publicKeyPem)) {
      throw new Error('Store catalog contains duplicate publisher signing key material.');
    }
    if (
      hasOwn(trustedKeys, certificate.signingKey.keyId) ||
      hasOwn(signingPolicies, certificate.signingKey.keyId) ||
      Object.values(trustedKeys).includes(certificate.signingKey.publicKeyPem)
    ) {
      throw new Error('Store publisher key certificate collides with a pinned signing key.');
    }
    const issuedMs = Date.parse(certificate.issuedAt);
    const expiresMs = Date.parse(certificate.expiresAt);
    if (issuedMs > nowMs + MAX_CLOCK_SKEW_MS || expiresMs <= nowMs) {
      throw new Error('Store publisher key certificate is not currently valid.');
    }
    if (publisherSigningKeyDigest(certificate.signingKey.publicKeyPem) !== certificate.signingKey.spkiSha256) {
      throw new Error('Store publisher key certificate public key digest does not match.');
    }
    verifyStoreRootSignature(
      storePublisherKeyCertificateSignaturePayload(certificate),
      certificate.signature,
      trustedKeys,
      'publisher key certificate'
    );
    certificateIds.add(certificate.certificateId);
    signingKeyIds.add(certificate.signingKey.keyId);
    signingKeyPems.add(certificate.signingKey.publicKeyPem);
    certificatesById.set(certificate.certificateId, certificate);
  }

  const revocationIds = new Set<string>();
  const revocationTargets = new Set<string>();
  const revokedKeyIds = new Set<string>();
  for (const revocation of publisherKeyRevocations ?? []) {
    const target = `${revocation.certificateId}\u0000${revocation.signingKeyId}`;
    if (revocationIds.has(revocation.revocationId) || revocationTargets.has(target)) {
      throw new Error('Store catalog contains duplicate publisher key revocations.');
    }
    const certificate = certificatesById.get(revocation.certificateId);
    if (
      !certificate ||
      certificate.publisherId !== revocation.publisherId ||
      certificate.signingKey.keyId !== revocation.signingKeyId
    ) {
      throw new Error('Store publisher key revocation does not match its certificate identity.');
    }
    if (Date.parse(revocation.revokedAt) < Date.parse(certificate.issuedAt)) {
      throw new Error('Store publisher key revocation predates its certificate.');
    }
    verifyStoreRootSignature(
      storePublisherKeyRevocationSignaturePayload(revocation),
      revocation.signature,
      trustedKeys,
      'publisher key revocation'
    );
    revocationIds.add(revocation.revocationId);
    revocationTargets.add(target);
    if (Date.parse(revocation.revokedAt) <= nowMs) revokedKeyIds.add(revocation.signingKeyId);
  }

  const effectiveTrustedKeys: Record<string, string> = { ...trustedKeys };
  const effectiveSigningPolicies: Record<string, PackageSigningKeyPolicy> = { ...signingPolicies };
  for (const certificate of publisherKeyCertificates ?? []) {
    effectiveTrustedKeys[certificate.signingKey.keyId] = certificate.signingKey.publicKeyPem;
    effectiveSigningPolicies[certificate.signingKey.keyId] = {
      publicKey: certificate.signingKey.publicKeyPem,
      publisherId: certificate.publisherId,
      trust: 'signed-store',
    };
    certificatesByKeyId.set(certificate.signingKey.keyId, {
      certificate,
      revoked: revokedKeyIds.has(certificate.signingKey.keyId),
    });
  }
  return {
    trustedKeys: effectiveTrustedKeys,
    signingPolicies: effectiveSigningPolicies,
    certificatesByKeyId,
    ...(publisherKeyCertificates === undefined ? {} : { publisherKeyCertificates }),
    ...(publisherKeyRevocations === undefined ? {} : { publisherKeyRevocations }),
  };
};

const verifiedStorePublisherKeys = (
  document: Pick<RemotePackageCatalogDocument, 'publisherKeyCertificates' | 'publisherKeyRevocations'>,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>>,
  now: Date
): Readonly<Record<string, string>> => {
  const admission = parseCatalogPublisherKeyAdmission(
    document.publisherKeyCertificates,
    document.publisherKeyRevocations,
    trustedKeys,
    signingPolicies,
    now
  );
  return Object.freeze(
    Object.fromEntries(
      [...admission.certificatesByKeyId.entries()]
        .filter(([, value]) => !value.revoked)
        .map(([keyId, value]) => [keyId, value.certificate.signingKey.publicKeyPem])
    )
  );
};

const derivePackageTrust = (
  manifest: PackageManifest,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>>
): Extract<PackageTrust, 'signed-first-party' | 'signed-store'> => {
  const signature = manifest.artifact?.signature;
  if (!signature) return 'signed-store';
  const policy = signingPolicies[signature.keyId];
  if (!policy || trustedKeys[signature.keyId] !== policy.publicKey || manifest.publisherId !== policy.publisherId) {
    return 'signed-store';
  }
  return policy.trust;
};

const downloadableEntry = (
  value: unknown,
  publisherKeyAdmission: CatalogPublisherKeyAdmission
): PackageCatalogEntry => {
  if (!isRecord(value)) throw new Error('Store catalog package entry must be an object.');
  if (value.delivery !== 'downloaded-package') {
    throw new Error('Remote Store catalog only accepts downloaded packages.');
  }
  if (typeof value.artifactUrl !== 'string') throw new Error('Remote Store package needs an artifact URL.');
  const artifactUrl = new URL(value.artifactUrl);
  if (artifactUrl.protocol !== 'https:' || artifactUrl.username || artifactUrl.password || artifactUrl.hash) {
    throw new Error('Remote Store artifact URL must be credential-free HTTPS.');
  }
  const manifest = parsePackageManifest(value.manifest);
  const mainContributions =
    value.mainContributions === undefined ? undefined : parsePackageMainContributions(value.mainContributions);
  if (
    (manifest.mainContributions === undefined) !== (mainContributions === undefined) ||
    (manifest.mainContributions !== undefined &&
      mainContributions !== undefined &&
      (manifest.mainContributions.length !== mainContributions.length ||
        manifest.mainContributions.some(
          (contribution, index) =>
            contribution.schemaVersion !== mainContributions[index]?.schemaVersion ||
            contribution.id !== mainContributions[index]?.id
        )))
  ) {
    throw new Error('Remote Store main contributions do not match its package manifest.');
  }
  const publisherCertificate = manifest.artifact?.signature
    ? publisherKeyAdmission.certificatesByKeyId.get(manifest.artifact.signature.keyId)
    : undefined;
  if (publisherCertificate) {
    if (isProtectedTomniNamespace(manifest.id) || isProtectedTomniNamespace(manifest.publisherId)) {
      throw new Error('A Store publisher key certificate cannot admit a protected Tomni namespace.');
    }
    if (publisherCertificate.certificate.publisherId !== manifest.publisherId) {
      throw new Error('Store publisher key certificate identity does not match its package manifest.');
    }
    if (publisherCertificate.revoked) {
      throw new Error('Store publisher signing key has been revoked.');
    }
  }
  verifyArtifactSignature(manifest, publisherKeyAdmission.trustedKeys);
  const offer = value.offer === undefined ? undefined : parseProductOffer(value.offer);
  if (
    offer !== undefined &&
    (offer.package.packageId !== manifest.id ||
      offer.package.packageVersion !== manifest.version ||
      offer.package.publisherId !== manifest.publisherId)
  ) {
    throw new Error('Remote Store offer identity does not match its package manifest.');
  }
  const revocation = value.revocation === undefined ? undefined : parseCatalogRevocation(value.revocation);
  const publicationReview =
    value.publicationReview === undefined
      ? undefined
      : parsePublicationReview(value.publicationReview, manifest.artifact?.integrity);
  return {
    delivery: value.delivery,
    trust: derivePackageTrust(manifest, publisherKeyAdmission.trustedKeys, publisherKeyAdmission.signingPolicies),
    artifactUrl: artifactUrl.toString(),
    manifest,
    ...(mainContributions ? { mainContributions } : {}),
    ...(offer ? { offer } : {}),
    ...(revocation ? { revocation } : {}),
    ...(publicationReview ? { publicationReview } : {}),
  };
};

export const parseRemotePackageCatalog = (
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  signingPolicies: Readonly<Record<string, PackageSigningKeyPolicy>> = {},
  { now = new Date(), allowExpired = false }: RemoteCatalogValidationOptions = {}
): RemotePackageCatalogDocument => {
  if (!isRecord(value)) throw new Error('Store catalog must be an object.');
  if (value.schemaVersion !== 1 || !Array.isArray(value.packages) || value.packages.length > MAX_CATALOG_PACKAGES) {
    throw new Error('Store catalog envelope is invalid.');
  }
  const revision = parsePositiveRevision(value.revision);
  const issuedAt = parseIsoDate(value.issuedAt, 'Store catalog issue time');
  const expiresAt = parseIsoDate(value.expiresAt, 'Store catalog expiry time');
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (
    issuedMs > now.getTime() + MAX_CLOCK_SKEW_MS ||
    expiresMs <= issuedMs ||
    expiresMs - issuedMs > MAX_CATALOG_VALIDITY_MS
  ) {
    throw new Error('Store catalog validity window is invalid.');
  }
  if (!allowExpired && expiresMs <= now.getTime()) throw new Error('Store catalog has expired.');

  if (
    (value.publisherKeyCertificates !== undefined && !Array.isArray(value.publisherKeyCertificates)) ||
    (value.publisherKeyRevocations !== undefined && !Array.isArray(value.publisherKeyRevocations))
  ) {
    throw new Error('Store catalog publisher-key extension is invalid.');
  }
  const signature = parseCatalogSignature(value.signature);
  const trustedKey = trustedKeys[signature.keyId];
  if (!trustedKey) throw new Error(`Store catalog signing key is not trusted: ${signature.keyId}`);
  const signedDocument: RemotePackageCatalogDocument = {
    schemaVersion: 1,
    revision,
    issuedAt,
    expiresAt,
    packages: value.packages as PackageCatalogEntry[],
    ...(value.publisherKeyCertificates === undefined
      ? {}
      : { publisherKeyCertificates: value.publisherKeyCertificates as StoreSignedPublisherKeyCertificate[] }),
    ...(value.publisherKeyRevocations === undefined
      ? {}
      : { publisherKeyRevocations: value.publisherKeyRevocations as StoreSignedPublisherKeyRevocation[] }),
    signature,
  };
  if (
    !verify(
      null,
      Buffer.from(remoteCatalogSignaturePayload(signedDocument)),
      createPublicKey(trustedKey),
      Buffer.from(signature.value, 'base64')
    )
  ) {
    throw new Error('Store catalog signature verification failed.');
  }

  const publisherKeyAdmission = parseCatalogPublisherKeyAdmission(
    value.publisherKeyCertificates,
    value.publisherKeyRevocations,
    trustedKeys,
    signingPolicies,
    now
  );
  const ids = new Set<string>();
  const packages = value.packages.map((entry) => {
    const parsed = downloadableEntry(entry, publisherKeyAdmission);
    if (ids.has(parsed.manifest.id)) throw new Error(`Duplicate Store package: ${parsed.manifest.id}`);
    ids.add(parsed.manifest.id);
    bindVerifiedRemoteStoreArtifact(parsed);
    return parsed;
  });
  return {
    schemaVersion: 1,
    revision,
    issuedAt,
    expiresAt,
    packages,
    ...(publisherKeyAdmission.publisherKeyCertificates === undefined
      ? {}
      : { publisherKeyCertificates: publisherKeyAdmission.publisherKeyCertificates }),
    ...(publisherKeyAdmission.publisherKeyRevocations === undefined
      ? {}
      : { publisherKeyRevocations: publisherKeyAdmission.publisherKeyRevocations }),
    signature,
  };
};

const PACKAGE_TRUST_RANK: Readonly<Record<PackageTrust, number>> = {
  'signed-store': 1,
  'signed-first-party': 2,
  'trusted-first-party': 3,
};

const mergeCatalogs = (
  fallbackCatalog: readonly PackageCatalogEntry[],
  remoteCatalog: readonly PackageCatalogEntry[]
): readonly PackageCatalogEntry[] => {
  const entries = new Map(fallbackCatalog.map((entry) => [entry.manifest.id, entry]));
  for (const entry of remoteCatalog) {
    const existing = entries.get(entry.manifest.id);
    // A signed revocation can supersede the bundled record only for the exact signed artifact.
    // This allows an emergency revocation without turning a same-version remote record into an
    // arbitrary package replacement.
    const exactRevocation =
      existing !== undefined &&
      entry.revocation !== undefined &&
      packageArtifactManifestsMatch(existing.manifest, entry.manifest);
    if (
      existing &&
      !exactRevocation &&
      (existing.manifest.publisherId !== entry.manifest.publisherId ||
        PACKAGE_TRUST_RANK[entry.trust] < PACKAGE_TRUST_RANK[existing.trust] ||
        semver.lte(entry.manifest.version, existing.manifest.version))
    ) {
      continue;
    }
    entries.set(entry.manifest.id, entry);
  }
  return [...entries.values()];
};

const readCatalogText = async (response: Response): Promise<string> => {
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_CATALOG_BYTES) {
    throw new Error('Remote Store catalog exceeds the size limit.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_CATALOG_BYTES) {
    throw new Error('Remote Store catalog exceeds the size limit.');
  }
  return text;
};

const remoteCachePaths = (cachePath: string): RemoteCachePaths => ({
  active: cachePath,
  recovery: `${cachePath}.recovery`,
  rollback: `${cachePath}.rollback`,
  marker: `${cachePath}.marker`,
  quarantine: `${cachePath}.quarantine`,
});

const validateMaxCacheAge = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 60_000 || value > MAX_CONFIGURED_CACHE_AGE_MS) {
    throw new Error('Remote catalog cache age must be between one minute and seven days.');
  }
  return value;
};

const parseCatalogUrl = (value: string): URL | undefined => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const createRemotePackageCatalogLoader = ({
  url,
  cachePath,
  fallbackCatalog,
  trustedKeys,
  signingPolicies = {},
  onVerifiedStorePublisherKeys,
  fetcher = fetch,
  egressAuthority = createSystemEgressAuthority(),
  isPackaged = false,
  now = () => new Date(),
  maxCacheAgeMs = DEFAULT_MAX_CACHE_AGE_MS,
}: RemoteCatalogLoaderOptions): (() => Promise<readonly PackageCatalogEntry[]>) => {
  const publishVerifiedStorePublisherKeys = (document: RemotePackageCatalogDocument): void => {
    onVerifiedStorePublisherKeys?.(verifiedStorePublisherKeys(document, trustedKeys, signingPolicies, now()));
  };
  const catalogUrl = parseCatalogUrl(url);
  if (!path.isAbsolute(cachePath)) throw new Error('Remote Store catalog cache path must be absolute.');
  const boundedCacheAge = validateMaxCacheAge(maxCacheAgeMs);
  const paths = remoteCachePaths(cachePath);
  const serialize = createSerializedCatalogExecutor();

  const readMarker = async (): Promise<CatalogRevisionMarker | undefined> => {
    if (!(await fileExists(paths.marker))) return undefined;
    try {
      return parseCatalogRevisionMarker(await readBoundedJson(paths.marker, 16 * 1_024));
    } catch (error) {
      await quarantineCatalogFile(paths.marker, paths.quarantine, now());
      throw new Error('Remote Store cache anti-rollback marker is corrupt.', { cause: error });
    }
  };

  const parseCachedCandidate = async (
    candidatePath: string
  ): Promise<{ cache: CachedRemoteCatalog; document: RemotePackageCatalogDocument; digest: string }> => {
    const value = await readBoundedJson(candidatePath, MAX_CATALOG_BYTES + 64 * 1_024);
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.cachedAt !== 'string') {
      throw new Error('Remote Store cache envelope is invalid.');
    }
    const cachedAt = parseIsoDate(value.cachedAt, 'Remote Store cache time');
    if (Date.parse(cachedAt) > now().getTime() + MAX_CLOCK_SKEW_MS) {
      throw new Error('Remote Store cache time is in the future.');
    }
    const document = parseRemotePackageCatalog(value.document, trustedKeys, signingPolicies, {
      now: now(),
      allowExpired: true,
    });
    return {
      cache: { schemaVersion: 1, cachedAt, document: value.document },
      document,
      digest: catalogDigest(value.document),
    };
  };

  const storeCache = async (rawDocument: unknown, document: RemotePackageCatalogDocument): Promise<void> => {
    await serialize(async () => {
      const marker = await readMarker();
      const digest = catalogDigest(rawDocument);
      if (marker && document.revision < marker.revision) {
        throw new Error(`Store catalog rollback rejected: revision ${document.revision} is below ${marker.revision}.`);
      }
      if (marker && document.revision === marker.revision && digest !== marker.digest) {
        throw new Error('Store catalog equivocation rejected: the committed revision has different contents.');
      }
      const cachedAt = now().toISOString();
      const cache: CachedRemoteCatalog = { schemaVersion: 1, cachedAt, document: rawDocument };

      if (marker && (await fileExists(paths.active))) {
        try {
          const current = await parseCachedCandidate(paths.active);
          if (current.document.revision === marker.revision && current.digest === marker.digest) {
            await writeJsonAtomically(paths.rollback, current.cache);
          }
        } catch {
          await quarantineCatalogFile(paths.active, paths.quarantine, now());
        }
      }
      await writeJsonAtomically(paths.active, cache);
      await writeJsonAtomically(paths.recovery, cache);
      await writeJsonAtomically(paths.marker, {
        schemaVersion: 1,
        revision: document.revision,
        digest,
        committedAt: cachedAt,
      } satisfies CatalogRevisionMarker);
    });
  };

  const loadCache = async (): Promise<RemotePackageCatalogDocument | undefined> =>
    serialize(async () => {
      const marker = await readMarker();
      if (!marker) {
        const orphaned = await Promise.all(
          [paths.active, paths.recovery, paths.rollback].map((candidate) => fileExists(candidate))
        );
        if (orphaned.some(Boolean)) {
          await Promise.all(
            [paths.active, paths.recovery, paths.rollback].map((candidate) =>
              quarantineCatalogFile(candidate, paths.quarantine, now())
            )
          );
          throw new Error('Remote Store cache exists without its anti-rollback marker.');
        }
        return undefined;
      }

      let foundExpired = false;
      for (const candidate of [paths.active, paths.recovery, paths.rollback]) {
        if (!(await fileExists(candidate))) continue;
        let parsed: Awaited<ReturnType<typeof parseCachedCandidate>>;
        try {
          parsed = await parseCachedCandidate(candidate);
        } catch {
          await quarantineCatalogFile(candidate, paths.quarantine, now());
          continue;
        }
        if (parsed.document.revision !== marker.revision || parsed.digest !== marker.digest) continue;
        const cacheAge = now().getTime() - Date.parse(parsed.cache.cachedAt);
        if (cacheAge > boundedCacheAge || Date.parse(parsed.document.expiresAt) <= now().getTime()) {
          foundExpired = true;
          continue;
        }
        if (candidate !== paths.active) await writeJsonAtomically(paths.active, parsed.cache);
        return parsed.document;
      }
      if (foundExpired) return undefined;
      throw new Error('Remote Store cache has no snapshot matching the highest committed revision.');
    });

  return async (): Promise<readonly PackageCatalogEntry[]> => {
    // A failed refresh must not leave keys from an older catalog usable for a
    // new install or recovery. A verified remote/cache document repopulates
    // this set below; bundled fallback has no third-party keys.
    onVerifiedStorePublisherKeys?.(Object.freeze({}));
    let remoteError: unknown;
    try {
      if (!catalogUrl) throw new Error('Remote Store catalog URL must use credential-free HTTPS without a fragment.');
      const egress = egressAuthority.authorize({
        egressClass: 'signed-store-catalog',
        destination: catalogUrl.toString(),
        storeCatalogUrl: catalogUrl.toString(),
        isPackaged,
      });
      if (egress.decision !== 'allow') {
        throw new Error(`Remote Store catalog egress denied: ${egress.code}.`);
      }
      const response = await fetcher(catalogUrl, {
        cache: 'no-store',
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Remote Store catalog returned HTTP ${response.status}.`);
      if (response.redirected || (response.url && response.url !== catalogUrl.toString())) {
        throw new Error('Remote Store catalog redirect was rejected.');
      }
      const rawDocument = JSON.parse(await readCatalogText(response)) as unknown;
      const document = parseRemotePackageCatalog(rawDocument, trustedKeys, signingPolicies, { now: now() });
      await storeCache(rawDocument, document);
      publishVerifiedStorePublisherKeys(document);
      return mergeCatalogs(fallbackCatalog, document.packages);
    } catch (error) {
      remoteError = error;
    }

    try {
      const cached = await loadCache();
      if (cached) {
        publishVerifiedStorePublisherKeys(cached);
        return mergeCatalogs(fallbackCatalog, cached.packages);
      }
    } catch {
      // Fail closed to the bundled catalog when durable cache integrity cannot be established.
    }
    if (fallbackCatalog.length > 0) return [...fallbackCatalog];
    throw remoteError;
  };
};
