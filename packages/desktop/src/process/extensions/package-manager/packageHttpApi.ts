/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PACKAGE_MUTATION_NATIVE_CHANNELS } from '../../../common/types/platform/electron';
import { PackageOperationError, toPackageOperationFailure } from '../../../common/packages';
import type {
  PackageListFilter,
  PackageListing,
  PackageManifest,
  PackageMutationConsentGrant,
  PackageMutationConsentRequest,
  PackageMutationAction,
  PackageMutationExecuteRequest,
  PackagePermissionChange,
  PackageUpdatePermissionConsentApproveRequest,
  PackageUpdatePermissionConsentChallenge,
  PackageUpdatePermissionConsentGrant,
  PackageUpdatePermissionConsentPreparation,
  PackageUpdatePermissionConsentPrepareRequest,
} from '../../../common/packages';
import type { PackageManagerService, PackageSandboxMutationLease } from './PackageManagerService';
import {
  CatalogFederationError,
  createCatalogActionConsentAuthority,
  createCatalogActionLedger,
  createCatalogFederationBroker,
  createTomniCatalogProvider,
  type CatalogActionRecoveryReport,
} from './catalog-federation';

type PackageHttpApiDeps = {
  service: PackageManagerService;
  authorize: (request: IncomingMessage) => Promise<boolean>;
  authorizeMutation?: (request: IncomingMessage) => Promise<boolean> | boolean;
  resolveMutationOwner?: (request: IncomingMessage) => Promise<string | undefined> | string | undefined;
  mutation?: PackageMutationRuntime;
  runtime?: PackageHttpRuntimeRegistry;
  artifactProvider?: (name: string) => Promise<Buffer | undefined>;
};

export type PackageMutationRuntime = {
  requestConsent: (
    request: PackageMutationConsentRequest & { ownerId: string }
  ) => PackageMutationConsentGrant | Promise<PackageMutationConsentGrant>;
  preparePermissionConsent: (
    request: PackageUpdatePermissionConsentPrepareRequest & { ownerId: string }
  ) => PackageUpdatePermissionConsentPreparation | Promise<PackageUpdatePermissionConsentPreparation>;
  approvePermissionConsent: (
    request: PackageUpdatePermissionConsentApproveRequest & { ownerId: string }
  ) => PackageUpdatePermissionConsentGrant | Promise<PackageUpdatePermissionConsentGrant>;
  execute: (request: PackageMutationExecuteRequest & { ownerId: string }) => Promise<PackageListing>;
  recoverPendingActions: () => Promise<CatalogActionRecoveryReport>;
  revokeOwner: (ownerId: string) => void;
};

export type PackageHttpRuntimeRegistry = {
  open(request: { packageId: string; runtimeId: string; ownerId: string }): void;
  close(request: { packageId: string; runtimeId: string; ownerId: string }): void;
  isActive(packageId: string): boolean;
  reserveMutation(packageId: string): PackageSandboxMutationLease | undefined;
};

/** Tracks browser-hosted sandbox runtimes with renewable leases so dead tabs cannot block mutations forever. */
export const createPackageHttpRuntimeRegistry = (
  options: { now?: () => number; leaseMs?: number } = {}
): PackageHttpRuntimeRegistry => {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? DEFAULT_HTTP_RUNTIME_LEASE_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('PACKAGE_RUNTIME_LEASE_INVALID');
  const leases = new Map<string, Map<string, number>>();
  const mutationReservations = new Map<string, symbol>();
  const leaseKey = (ownerId: string, runtimeId: string): string => JSON.stringify([ownerId, runtimeId]);
  const prune = (packageId: string): Map<string, number> | undefined => {
    const packageLeases = leases.get(packageId);
    if (!packageLeases) return undefined;
    const currentTime = now();
    for (const [key, expiresAt] of packageLeases) {
      if (expiresAt <= currentTime) packageLeases.delete(key);
    }
    if (packageLeases.size === 0) {
      leases.delete(packageId);
      return undefined;
    }
    return packageLeases;
  };

  return {
    open: ({ packageId, runtimeId, ownerId }) => {
      if (mutationReservations.has(packageId)) throw new Error('PACKAGE_RUNTIME_MUTATION_ACTIVE');
      const packageLeases = prune(packageId) ?? new Map<string, number>();
      packageLeases.set(leaseKey(ownerId, runtimeId), now() + leaseMs);
      leases.set(packageId, packageLeases);
    },
    close: ({ packageId, runtimeId, ownerId }) => {
      const packageLeases = prune(packageId);
      if (!packageLeases) return;
      packageLeases.delete(leaseKey(ownerId, runtimeId));
      if (packageLeases.size === 0) leases.delete(packageId);
    },
    isActive: (packageId) => (prune(packageId)?.size ?? 0) > 0,
    reserveMutation: (packageId) => {
      if ((prune(packageId)?.size ?? 0) > 0 || mutationReservations.has(packageId)) return undefined;
      const reservation = Symbol(packageId);
      mutationReservations.set(packageId, reservation);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          if (mutationReservations.get(packageId) === reservation) mutationReservations.delete(packageId);
        },
      };
    },
  };
};

export type TrustedPackageMutationIpcHost<Sender> = {
  handle(channel: string, handler: (sender: Sender, payload: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
};

export type TrustedPackageMutationIpcOptions<Sender> = {
  host: TrustedPackageMutationIpcHost<Sender>;
  runtime: PackageMutationRuntime;
  verifySender(sender: Sender): boolean | Promise<boolean>;
  identifySender(sender: Sender): string | undefined;
  subscribeOwnerUnavailable?(listener: (ownerId: string) => void): () => void;
};

export type LocalPackageMutationRuntimeOptions = {
  service: PackageManagerService;
  ledgerRootDir: string;
  now?: () => Date;
  randomId?: () => string;
};

const DEFAULT_CONTRIBUTION_WAIT_MS = 25_000;
const MAX_CONTRIBUTION_WAIT_MS = 30_000;
const INTEGER_QUERY = /^\d+$/;
const PACKAGE_ID = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)+$/;
const REGION = /^[A-Za-z]{2}$/;
const MUTATION_OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_HTTP_RUNTIME_LEASE_MS = 10_000;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const MAX_ACTION_TEXT = 200;

/** Fail closed unless a browser mutation comes from the exact origin serving this HTTP endpoint. */
export const isSameOriginPackageMutationRequest = (request: IncomingMessage): boolean => {
  const fetchSite = request.headers['sec-fetch-site'];
  if (Array.isArray(fetchSite) || (fetchSite !== undefined && fetchSite !== 'same-origin')) return false;

  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== origin
    ) {
      return false;
    }
    return parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, unknown>;
};

class PackageMutationRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = 'PackageMutationRequestError';
  }
}

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const parseActionText = (value: unknown, field: string, pattern?: RegExp): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > MAX_ACTION_TEXT ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    }) ||
    (pattern && !pattern.test(value))
  ) {
    throw new PackageMutationRequestError(`PACKAGE_${field.toUpperCase()}_INVALID`, 400);
  }
  return value;
};

const DEFAULT_PERMISSION_CONSENT_TTL_MS = 5 * 60 * 1_000;
const MAX_PERMISSION_CONSENT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_PENDING_PERMISSION_CONSENTS = 512;
const MAX_MAX_PENDING_PERMISSION_CONSENTS = 4_096;

type PackagePermissionUpdateDescriptor = {
  packageId: string;
  from: { version: string; revision: string };
  to: { version: string; revision: string };
  permissions: PackagePermissionChange;
};

type StoredPackagePermissionConsentChallenge = {
  challenge: PackageUpdatePermissionConsentChallenge;
  ownerId: string;
  descriptor: PackagePermissionUpdateDescriptor;
};

type StoredPackagePermissionConsentGrant = {
  grant: PackageUpdatePermissionConsentGrant;
  ownerId: string;
  descriptor: PackagePermissionUpdateDescriptor;
};

export type PackageUpdatePermissionConsentAuthorityOptions = {
  lookupPackage: (id: string) => Promise<PackageListing>;
  now?: () => Date;
  randomId?: () => string;
  ttlMs?: number;
  maxPendingConsents?: number;
};

export type PackageUpdatePermissionConsentAuthority = {
  prepare: (
    request: PackageUpdatePermissionConsentPrepareRequest & { ownerId: string }
  ) => Promise<PackageUpdatePermissionConsentPreparation>;
  approve: (
    request: PackageUpdatePermissionConsentApproveRequest & { ownerId: string }
  ) => Promise<PackageUpdatePermissionConsentGrant>;
  authorize: (request: { id: string; ownerId: string; receiptId?: string }) => Promise<void>;
  revokeOwner: (ownerId: string) => void;
};

const canonicalizePackageValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizePackageValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizePackageValue(entry)}`)
    .join(',')}}`;
};

const manifestRevision = (manifest: PackageManifest): { version: string; revision: string } => ({
  version: manifest.version,
  revision: `sha256-${createHash('sha256').update(canonicalizePackageValue(manifest)).digest('hex')}`,
});

const normalizePermissions = (permissions: readonly string[]): string[] => [...new Set(permissions)].toSorted();

const permissionChange = (from: readonly string[], to: readonly string[]): PackagePermissionChange => {
  const previous = new Set(normalizePermissions(from));
  const next = new Set(normalizePermissions(to));
  return {
    added: [...next].filter((permission) => !previous.has(permission)),
    removed: [...previous].filter((permission) => !next.has(permission)),
    // Manifest permissions are atomic identifiers; there is no mutable sub-field to classify as changed.
    changed: [],
  };
};

const hasPermissionChange = (change: PackagePermissionChange): boolean =>
  change.added.length > 0 || change.removed.length > 0 || change.changed.length > 0;

const describePackagePermissionUpdate = (listing: PackageListing): PackagePermissionUpdateDescriptor | undefined => {
  if (!listing.installedVersion || listing.installedVersion === listing.manifest.version) return undefined;
  if (!listing.installedManifest) {
    throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_UNAVAILABLE', 409);
  }
  const permissions = permissionChange(listing.installedManifest.permissions, listing.manifest.permissions);
  if (!hasPermissionChange(permissions)) return undefined;
  return {
    packageId: listing.manifest.id,
    from: manifestRevision(listing.installedManifest),
    to: manifestRevision(listing.manifest),
    permissions,
  };
};

const equalPermissionUpdateDescriptor = (
  left: PackagePermissionUpdateDescriptor,
  right: PackagePermissionUpdateDescriptor
): boolean =>
  left.packageId === right.packageId &&
  left.from.version === right.from.version &&
  left.from.revision === right.from.revision &&
  left.to.version === right.to.version &&
  left.to.revision === right.to.revision &&
  left.permissions.added.join('\u0000') === right.permissions.added.join('\u0000') &&
  left.permissions.removed.join('\u0000') === right.permissions.removed.join('\u0000') &&
  left.permissions.changed.every(
    (change, index) =>
      change.from === right.permissions.changed[index]?.from && change.to === right.permissions.changed[index]?.to
  ) &&
  left.permissions.changed.length === right.permissions.changed.length;

const clonePermissionDescriptor = (descriptor: PackagePermissionUpdateDescriptor): PackagePermissionUpdateDescriptor =>
  structuredClone(descriptor);

const readPermissionConsentOwner = (ownerId: string): string =>
  parseActionText(ownerId, 'MUTATION_OWNER_ID', MUTATION_OWNER_ID);

const readPermissionConsentId = (value: unknown): string => parseActionText(value, 'PERMISSION_CONSENT_ID');

/**
 * Issues short-lived, owner-bound approval receipts only after the main process
 * has calculated the exact installed-to-catalog permission delta.
 */
export const createPackageUpdatePermissionConsentAuthority = ({
  lookupPackage,
  now = () => new Date(),
  randomId = randomUUID,
  ttlMs = DEFAULT_PERMISSION_CONSENT_TTL_MS,
  maxPendingConsents = DEFAULT_MAX_PENDING_PERMISSION_CONSENTS,
}: PackageUpdatePermissionConsentAuthorityOptions): PackageUpdatePermissionConsentAuthority => {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_PERMISSION_CONSENT_TTL_MS) {
    throw new RangeError('Package permission consent TTL is invalid.');
  }
  if (
    !Number.isSafeInteger(maxPendingConsents) ||
    maxPendingConsents < 1 ||
    maxPendingConsents > MAX_MAX_PENDING_PERMISSION_CONSENTS
  ) {
    throw new RangeError('Package permission consent capacity is invalid.');
  }
  const challenges = new Map<string, StoredPackagePermissionConsentChallenge>();
  const grants = new Map<string, StoredPackagePermissionConsentGrant>();

  const removeExpired = (checkedAt: number): void => {
    for (const [challengeId, challenge] of challenges) {
      if (Date.parse(challenge.challenge.expiresAt) <= checkedAt) challenges.delete(challengeId);
    }
    for (const [receiptId, grant] of grants) {
      if (Date.parse(grant.grant.expiresAt) <= checkedAt) grants.delete(receiptId);
    }
  };
  const descriptorFor = async (id: string): Promise<PackagePermissionUpdateDescriptor | undefined> => {
    const listing = await lookupPackage(id);
    const descriptor = describePackagePermissionUpdate(listing);
    if (descriptor && descriptor.packageId !== id) {
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_INVALID', 403);
    }
    return descriptor;
  };
  const issueAt = (): { issuedAt: Date; expiresAt: string } => {
    const issuedAt = now();
    if (Number.isNaN(issuedAt.getTime())) throw new RangeError('Package permission consent clock is invalid.');
    removeExpired(issuedAt.getTime());
    return { issuedAt, expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString() };
  };

  const prepare: PackageUpdatePermissionConsentAuthority['prepare'] = async ({ id, ownerId }) => {
    const packageId = parseActionText(id, 'ID', PACKAGE_ID);
    const trustedOwnerId = readPermissionConsentOwner(ownerId);
    const descriptor = await descriptorFor(packageId);
    if (!descriptor) return { required: false };
    const { issuedAt, expiresAt } = issueAt();
    if (challenges.size >= maxPendingConsents) {
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_UNAVAILABLE', 503);
    }
    const challenge: PackageUpdatePermissionConsentChallenge = {
      challengeId: readPermissionConsentId(randomId()),
      packageId: descriptor.packageId,
      from: structuredClone(descriptor.from),
      to: structuredClone(descriptor.to),
      permissions: structuredClone(descriptor.permissions),
      issuedAt: issuedAt.toISOString(),
      expiresAt,
    };
    challenges.set(challenge.challengeId, {
      challenge: structuredClone(challenge),
      ownerId: trustedOwnerId,
      descriptor: clonePermissionDescriptor(descriptor),
    });
    return { required: true, challenge: structuredClone(challenge) };
  };

  const approve: PackageUpdatePermissionConsentAuthority['approve'] = async ({ challengeId, confirmed, ownerId }) => {
    if (confirmed !== true) throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_REQUIRED', 403);
    const trustedOwnerId = readPermissionConsentOwner(ownerId);
    const requestedChallengeId = readPermissionConsentId(challengeId);
    const checkedAt = now();
    if (Number.isNaN(checkedAt.getTime())) throw new RangeError('Package permission consent clock is invalid.');
    removeExpired(checkedAt.getTime());
    const stored = challenges.get(requestedChallengeId);
    if (!stored || stored.ownerId !== trustedOwnerId) {
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_INVALID', 403);
    }
    const current = await descriptorFor(stored.descriptor.packageId);
    if (!current || !equalPermissionUpdateDescriptor(stored.descriptor, current)) {
      challenges.delete(requestedChallengeId);
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_STALE', 409);
    }
    const { issuedAt, expiresAt } = issueAt();
    if (grants.size >= maxPendingConsents) {
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_UNAVAILABLE', 503);
    }
    const grant: PackageUpdatePermissionConsentGrant = {
      receiptId: readPermissionConsentId(randomId()),
      packageId: stored.descriptor.packageId,
      from: structuredClone(stored.descriptor.from),
      to: structuredClone(stored.descriptor.to),
      permissions: structuredClone(stored.descriptor.permissions),
      issuedAt: issuedAt.toISOString(),
      expiresAt,
    };
    grants.set(grant.receiptId, {
      grant: structuredClone(grant),
      ownerId: trustedOwnerId,
      descriptor: clonePermissionDescriptor(stored.descriptor),
    });
    challenges.delete(requestedChallengeId);
    return structuredClone(grant);
  };

  const authorize: PackageUpdatePermissionConsentAuthority['authorize'] = async ({ id, ownerId, receiptId }) => {
    const packageId = parseActionText(id, 'ID', PACKAGE_ID);
    const trustedOwnerId = readPermissionConsentOwner(ownerId);
    const checkedAt = now();
    if (Number.isNaN(checkedAt.getTime())) throw new RangeError('Package permission consent clock is invalid.');
    removeExpired(checkedAt.getTime());
    const current = await descriptorFor(packageId);
    if (!current) return;
    if (!receiptId) throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_REQUIRED', 403);
    const requestedReceiptId = readPermissionConsentId(receiptId);
    const grant = grants.get(requestedReceiptId);
    if (!grant || grant.ownerId !== trustedOwnerId || grant.grant.packageId !== packageId) {
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_INVALID', 403);
    }
    // Consume before authorization returns so one approval cannot authorize a later execute.
    grants.delete(requestedReceiptId);
    if (!equalPermissionUpdateDescriptor(grant.descriptor, current)) {
      throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_STALE', 409);
    }
  };

  const revokeOwner = (ownerId: string): void => {
    for (const [challengeId, challenge] of challenges) {
      if (challenge.ownerId === ownerId) challenges.delete(challengeId);
    }
    for (const [receiptId, grant] of grants) {
      if (grant.ownerId === ownerId) grants.delete(receiptId);
    }
  };

  return { prepare, approve, authorize, revokeOwner };
};

export const parsePackageMutationConsentRequest = (value: unknown): PackageMutationConsentRequest => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, ['action', 'confirmed', 'id', 'idempotencyKey', 'region'])
  ) {
    throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
  }
  const raw = value as Record<string, unknown>;
  if (
    !['install', 'uninstall', 'enable', 'disable', 'rollback'].includes(String(raw.action)) ||
    raw.confirmed !== true
  ) {
    throw new PackageMutationRequestError('PACKAGE_MUTATION_CONSENT_REQUIRED', 403);
  }
  return {
    id: parseActionText(raw.id, 'ID', PACKAGE_ID),
    action: raw.action as PackageMutationAction,
    idempotencyKey: parseActionText(raw.idempotencyKey, 'IDEMPOTENCY_KEY'),
    region: parseActionText(raw.region, 'REGION', REGION).toUpperCase(),
    confirmed: true,
  };
};

export const parsePackageMutationExecuteRequest = (value: unknown): PackageMutationExecuteRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
  }
  const raw = value as Record<string, unknown>;
  if (!hasExactKeys(raw, ['action', 'consentId', 'id', 'idempotencyKey', 'region'])) {
    const hasPermissionConsentId = Object.hasOwn(raw, 'permissionConsentId');
    if (
      !hasPermissionConsentId ||
      !hasExactKeys(raw, ['action', 'consentId', 'id', 'idempotencyKey', 'permissionConsentId', 'region'])
    ) {
      throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
    }
  }
  if (!['install', 'uninstall', 'enable', 'disable', 'rollback'].includes(String(raw.action))) {
    throw new PackageMutationRequestError('PACKAGE_MUTATION_ACTION_INVALID', 400);
  }
  return {
    id: parseActionText(raw.id, 'ID', PACKAGE_ID),
    action: raw.action as PackageMutationAction,
    idempotencyKey: parseActionText(raw.idempotencyKey, 'IDEMPOTENCY_KEY'),
    region: parseActionText(raw.region, 'REGION', REGION).toUpperCase(),
    consentId: parseActionText(raw.consentId, 'CONSENT_ID'),
    ...(Object.hasOwn(raw, 'permissionConsentId')
      ? { permissionConsentId: readPermissionConsentId(raw.permissionConsentId) }
      : {}),
  };
};

export const parsePackageUpdatePermissionConsentPrepareRequest = (
  value: unknown
): PackageUpdatePermissionConsentPrepareRequest => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, ['id'])
  ) {
    throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
  }
  return { id: parseActionText((value as Record<string, unknown>).id, 'ID', PACKAGE_ID) };
};

export const parsePackageUpdatePermissionConsentApproveRequest = (
  value: unknown
): PackageUpdatePermissionConsentApproveRequest => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, ['challengeId', 'confirmed'])
  ) {
    throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
  }
  const raw = value as Record<string, unknown>;
  if (raw.confirmed !== true) throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_REQUIRED', 403);
  return { challengeId: readPermissionConsentId(raw.challengeId), confirmed: true };
};

/** Converts internal mutation failures to a stable error that is safe to cross trusted IPC. */
const redactTrustedMutationIpcError = (
  error: unknown,
  phase: 'install' | 'activation' | 'uninstall'
): PackageMutationRequestError | PackageOperationError => {
  if (error instanceof PackageMutationRequestError || error instanceof PackageOperationError) return error;
  if (error instanceof CatalogFederationError) return new PackageMutationRequestError(error.code, 400);
  return new PackageOperationError(toPackageOperationFailure(error, phase));
};

const mutationPhase = (action: PackageMutationExecuteRequest['action']): 'install' | 'activation' | 'uninstall' =>
  action === 'install' ? 'install' : action === 'uninstall' ? 'uninstall' : 'activation';

/** Register the authority-bearing mutation IPC surface. Generic renderer IPC must never call mutations directly. */
export const registerTrustedPackageMutationIpcBridge = <Sender>({
  host,
  runtime,
  verifySender,
  identifySender,
  subscribeOwnerUnavailable,
}: TrustedPackageMutationIpcOptions<Sender>): (() => void) => {
  const invokeForTrustedSender = async <Request extends object, Result>(
    sender: Sender,
    payload: unknown,
    parse: (value: unknown) => Request,
    execute: (request: Request & { ownerId: string }) => Result | Promise<Result>
  ): Promise<Result> => {
    let verified = false;
    try {
      verified = await verifySender(sender);
    } catch {
      verified = false;
    }
    if (!verified) throw new PackageMutationRequestError('PACKAGE_MUTATION_SENDER_UNTRUSTED', 403);

    let rawOwnerId: string | undefined;
    try {
      rawOwnerId = identifySender(sender);
    } catch {
      throw new PackageMutationRequestError('PACKAGE_MUTATION_SENDER_UNTRUSTED', 403);
    }
    const ownerId = parseActionText(rawOwnerId, 'MUTATION_OWNER_ID', MUTATION_OWNER_ID);
    return execute({ ...parse(payload), ownerId });
  };

  const requestConsent = (sender: Sender, payload: unknown): Promise<PackageMutationConsentGrant> =>
    invokeForTrustedSender(sender, payload, parsePackageMutationConsentRequest, async (request) => {
      try {
        return await runtime.requestConsent(request);
      } catch (error) {
        throw redactTrustedMutationIpcError(error, mutationPhase(request.action));
      }
    });
  const preparePermissionConsent = (
    sender: Sender,
    payload: unknown
  ): Promise<PackageUpdatePermissionConsentPreparation> =>
    invokeForTrustedSender(sender, payload, parsePackageUpdatePermissionConsentPrepareRequest, async (request) => {
      try {
        return await runtime.preparePermissionConsent(request);
      } catch (error) {
        throw redactTrustedMutationIpcError(error, 'install');
      }
    });
  const approvePermissionConsent = (sender: Sender, payload: unknown): Promise<PackageUpdatePermissionConsentGrant> =>
    invokeForTrustedSender(sender, payload, parsePackageUpdatePermissionConsentApproveRequest, async (request) => {
      try {
        return await runtime.approvePermissionConsent(request);
      } catch (error) {
        throw redactTrustedMutationIpcError(error, 'install');
      }
    });
  const execute = (sender: Sender, payload: unknown): Promise<PackageListing> =>
    invokeForTrustedSender(sender, payload, parsePackageMutationExecuteRequest, async (request) => {
      try {
        return await runtime.execute(request);
      } catch (error) {
        throw redactTrustedMutationIpcError(error, mutationPhase(request.action));
      }
    });

  const registeredChannels: string[] = [];
  try {
    host.handle(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent, requestConsent);
    registeredChannels.push(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent);
    host.handle(PACKAGE_MUTATION_NATIVE_CHANNELS.preparePermissionConsent, preparePermissionConsent);
    registeredChannels.push(PACKAGE_MUTATION_NATIVE_CHANNELS.preparePermissionConsent);
    host.handle(PACKAGE_MUTATION_NATIVE_CHANNELS.approvePermissionConsent, approvePermissionConsent);
    registeredChannels.push(PACKAGE_MUTATION_NATIVE_CHANNELS.approvePermissionConsent);
    host.handle(PACKAGE_MUTATION_NATIVE_CHANNELS.execute, execute);
    registeredChannels.push(PACKAGE_MUTATION_NATIVE_CHANNELS.execute);
  } catch (error) {
    for (const channel of registeredChannels) host.removeHandler(channel);
    throw error;
  }

  const unsubscribeOwnerUnavailable = subscribeOwnerUnavailable?.((rawOwnerId) => {
    try {
      runtime.revokeOwner(parseActionText(rawOwnerId, 'MUTATION_OWNER_ID', MUTATION_OWNER_ID));
    } catch {
      // Ignore invalid host lifecycle notifications; they do not grant authority.
    }
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeOwnerUnavailable?.();
    for (const channel of registeredChannels) host.removeHandler(channel);
  };
};

/** Build the only consent-governed path allowed to change package state. */
export const createLocalPackageMutationRuntime = ({
  service,
  ledgerRootDir,
  now = () => new Date(),
  randomId = randomUUID,
}: LocalPackageMutationRuntimeOptions): PackageMutationRuntime => {
  const consent = createCatalogActionConsentAuthority({ now, randomId });
  const broker = createCatalogFederationBroker({
    providers: [createTomniCatalogProvider(service, now)],
    ledger: createCatalogActionLedger({ rootDir: ledgerRootDir, now, randomId }),
    authorize: (authorization) =>
      authorization.source === 'tomni-store' &&
      (authorization.action === 'install' ||
        authorization.action === 'uninstall' ||
        authorization.action === 'enable' ||
        authorization.action === 'disable' ||
        authorization.action === 'rollback'),
    consent,
    now,
    randomId,
  });

  const permissionConsent = createPackageUpdatePermissionConsentAuthority({
    lookupPackage: (id) => service.status(id),
    now,
    randomId,
  });
  const inFlightMutations = new Map<string, Promise<PackageListing>>();
  const mutationKey = (request: PackageMutationExecuteRequest, ownerId: string): string =>
    JSON.stringify([
      ownerId,
      request.id,
      request.action,
      request.idempotencyKey,
      request.region,
      request.consentId,
      request.permissionConsentId ?? null,
    ]);
  const execute = (rawRequest: PackageMutationExecuteRequest & { ownerId: string }): Promise<PackageListing> => {
    let request: PackageMutationExecuteRequest;
    try {
      request = parsePackageMutationExecuteRequest({
        id: rawRequest.id,
        action: rawRequest.action,
        idempotencyKey: rawRequest.idempotencyKey,
        region: rawRequest.region,
        consentId: rawRequest.consentId,
        ...(rawRequest.permissionConsentId !== undefined
          ? { permissionConsentId: rawRequest.permissionConsentId }
          : {}),
      });
    } catch (error) {
      return Promise.reject(error);
    }
    const key = mutationKey(request, rawRequest.ownerId);
    const active = inFlightMutations.get(key);
    if (active) return active;

    const operation = (async (): Promise<PackageListing> => {
      if (request.action === 'install') {
        await permissionConsent.authorize({
          id: request.id,
          ownerId: rawRequest.ownerId,
          receiptId: request.permissionConsentId,
        });
      } else if (request.permissionConsentId) {
        throw new PackageMutationRequestError('PACKAGE_PERMISSION_CONSENT_INVALID', 403);
      }
      const actionRequest = {
        source: 'tomni-store' as const,
        sourceItemId: request.id,
        region: request.region,
        idempotencyKey: request.idempotencyKey,
        consentId: request.consentId,
        ownerId: rawRequest.ownerId,
      };
      if (request.action === 'install') await broker.install(actionRequest);
      else if (request.action === 'uninstall') await broker.uninstall(actionRequest);
      else if (request.action === 'enable') await broker.enable(actionRequest);
      else if (request.action === 'disable') await broker.disable(actionRequest);
      else await broker.rollback(actionRequest);
      return service.status(request.id);
    })();
    inFlightMutations.set(key, operation);
    const clear = (): void => {
      if (inFlightMutations.get(key) === operation) inFlightMutations.delete(key);
    };
    operation.then(clear, clear);
    return operation;
  };

  return {
    requestConsent: (rawRequest) => {
      const request = parsePackageMutationConsentRequest({
        id: rawRequest.id,
        action: rawRequest.action,
        idempotencyKey: rawRequest.idempotencyKey,
        region: rawRequest.region,
        confirmed: rawRequest.confirmed,
      });
      const granted = consent.recordUserDecision({
        action: request.action,
        source: 'tomni-store',
        sourceItemId: request.id,
        region: request.region,
        ownerId: rawRequest.ownerId,
        idempotencyKey: request.idempotencyKey,
        approved: request.confirmed,
      });
      if (!granted) throw new CatalogFederationError('CATALOG_ACTION_DENIED', 'Package action consent was denied.');
      return { consentId: granted.consentId, expiresAt: granted.expiresAt };
    },
    preparePermissionConsent: (rawRequest) =>
      permissionConsent.prepare({
        ...parsePackageUpdatePermissionConsentPrepareRequest({ id: rawRequest.id }),
        ownerId: rawRequest.ownerId,
      }),
    approvePermissionConsent: (rawRequest) =>
      permissionConsent.approve({
        ...parsePackageUpdatePermissionConsentApproveRequest({
          challengeId: rawRequest.challengeId,
          confirmed: rawRequest.confirmed,
        }),
        ownerId: rawRequest.ownerId,
      }),
    execute,
    recoverPendingActions: () => broker.recoverPendingActions(),
    revokeOwner: (ownerId) => {
      consent.revokeOwner(ownerId);
      permissionConsent.revokeOwner(ownerId);
    },
  };
};

const defaultMutationOwner = (request: IncomingMessage): string => {
  const seed =
    request.headers.cookie?.trim() || `${request.socket.remoteAddress ?? 'unknown'}|${request.headers.origin ?? ''}`;
  return `http:${createHash('sha256').update(seed).digest('hex')}`;
};

const mutationError = (error: unknown): { status: number; code: string } => {
  if (error instanceof PackageMutationRequestError) return { status: error.status, code: error.code };
  if (error instanceof PackageOperationError) {
    return {
      status: error.failure.code.startsWith('PACKAGE_DEPENDENCY_') ? 409 : 400,
      code: error.failure.code,
    };
  }
  if (error instanceof CatalogFederationError) {
    if (error.code === 'CATALOG_ACTION_DENIED' || error.code === 'CATALOG_CONSENT_INVALID') {
      return { status: 403, code: error.code };
    }
    if (error.code === 'CATALOG_ACTION_IDEMPOTENCY_CONFLICT' || error.code === 'CATALOG_ACTION_IN_PROGRESS') {
      return { status: 409, code: error.code };
    }
    if (error.code === 'CATALOG_LEDGER_UNAVAILABLE') return { status: 503, code: error.code };
    return { status: 400, code: error.code };
  }
  return { status: 400, code: 'PACKAGE_OPERATION_FAILED' };
};

const parseBoundedInteger = (
  rawValue: string | null,
  { required, defaultValue, maximum }: { required: boolean; defaultValue: number; maximum: number }
): number => {
  if (rawValue === null) {
    if (required) throw new RangeError('Required integer query is missing.');
    return defaultValue;
  }
  if (!INTEGER_QUERY.test(rawValue)) throw new RangeError('Integer query is invalid.');
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) throw new RangeError('Integer query is outside the safe range.');
  return Math.min(value, maximum);
};

const waitForContributionRevision = async (
  service: PackageManagerService,
  request: IncomingMessage,
  response: ServerResponse,
  afterRevision: number,
  timeoutMs: number
): Promise<{ state: Awaited<ReturnType<PackageManagerService['contributions']>>; timedOut: boolean } | undefined> => {
  const current = await service.contributions();
  if (current.snapshot.revision > afterRevision) return { state: current, timedOut: false };
  if (request.aborted || response.destroyed) return undefined;

  const outcome = await new Promise<'changed' | 'timeout' | 'disconnect'>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      request.off('aborted', onDisconnect);
      response.off('close', onDisconnect);
      unsubscribe?.();
    };
    const finish = (result: 'changed' | 'timeout' | 'disconnect'): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    function onDisconnect(): void {
      finish('disconnect');
    }

    request.once('aborted', onDisconnect);
    response.once('close', onDisconnect);
    unsubscribe = service.onContributionsChanged(({ revision }) => {
      if (revision > afterRevision) finish('changed');
    });
    if (settled) {
      unsubscribe();
      return;
    }
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    if (request.aborted || response.destroyed) finish('disconnect');

    void service
      .contributions()
      .then((state) => {
        if (state.snapshot.revision > afterRevision) finish('changed');
      })
      .catch(() => finish('changed'));
  });

  if (outcome === 'disconnect') return undefined;
  return { state: await service.contributions(), timedOut: outcome === 'timeout' };
};

const packageIdFromPath = (pathname: string): string | undefined => {
  const match =
    /^\/api\/packages\/([^/]+)(?:\/(?:consent|install|uninstall|enable|disable|rollback|permission-consent(?:\/approve)?|runtime\/(?:open|close)))?$/.exec(
      pathname
    );
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
};

/** Reads a single canonical artifact filename without giving providers a path-like value. */
const artifactNameFromPath = (pathname: string): string | undefined => {
  const encodedName = /^\/api\/packages\/artifacts\/([^/]+)$/.exec(pathname)?.[1];
  if (!encodedName) return undefined;
  try {
    const name = decodeURIComponent(encodedName);
    return ARTIFACT_NAME.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
};

export const createPackageHttpApi = ({
  service,
  authorize,
  authorizeMutation,
  resolveMutationOwner,
  mutation,
  runtime,
  artifactProvider,
}: PackageHttpApiDeps) => {
  let initializationError: unknown;
  const ready = service
    .initialize()
    .then(async () => {
      if (mutation) await mutation.recoverPendingActions();
    })
    .catch((error: unknown): void => {
      initializationError = error;
    });

  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/packages')) return false;

    if (!(await authorize(request))) {
      sendJson(response, 401, { error: 'UNAUTHORIZED' });
      return true;
    }
    const artifactName = artifactNameFromPath(url.pathname);
    if (request.method === 'GET' && url.pathname.startsWith('/api/packages/artifacts/') && artifactProvider) {
      if (!artifactName) {
        sendJson(response, 404, { error: 'PACKAGE_ARTIFACT_NOT_FOUND' });
        return true;
      }
      const artifact = await artifactProvider(artifactName);
      if (!artifact) {
        sendJson(response, 404, { error: 'PACKAGE_ARTIFACT_NOT_FOUND' });
      } else {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-length': String(artifact.byteLength),
          'content-type': 'application/vnd.tomni.package+json',
        });
        response.end(artifact);
      }
      return true;
    }
    const isMutation = request.method === 'POST' && !url.pathname.startsWith('/api/packages/artifacts/');
    if (isMutation && (!authorizeMutation || !(await authorizeMutation(request)))) {
      sendJson(response, 403, { error: 'PACKAGE_MUTATION_FORBIDDEN' });
      return true;
    }

    try {
      await ready;
      if (initializationError) throw initializationError;

      if (request.method === 'POST' && url.pathname === '/api/packages/refresh') {
        await readJson(request);
        sendJson(response, 200, { data: await service.refreshCatalog() });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/api/packages/contributions/wait') {
        let afterRevision: number;
        let timeoutMs: number;
        try {
          afterRevision = parseBoundedInteger(url.searchParams.get('afterRevision'), {
            required: true,
            defaultValue: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          });
          timeoutMs = parseBoundedInteger(url.searchParams.get('timeoutMs'), {
            required: false,
            defaultValue: DEFAULT_CONTRIBUTION_WAIT_MS,
            maximum: MAX_CONTRIBUTION_WAIT_MS,
          });
        } catch {
          sendJson(response, 400, { error: 'PACKAGE_WAIT_QUERY_INVALID' });
          return true;
        }
        const result = await waitForContributionRevision(service, request, response, afterRevision, timeoutMs);
        if (result && !response.destroyed) sendJson(response, 200, { data: result.state, timedOut: result.timedOut });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/api/packages/contributions') {
        sendJson(response, 200, { data: await service.contributions() });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/api/packages') {
        const type = url.searchParams.get('type');
        const installedOnly = url.searchParams.get('installedOnly') === 'true';
        const query = url.searchParams.get('query') ?? '';
        const filter: PackageListFilter = {
          ...(type === 'app' || type === 'ui' || type === 'agent-capsule' ? { type } : {}),
          ...(installedOnly ? { installedOnly: true } : {}),
        };
        const data = query ? await service.search({ ...filter, query }) : await service.list(filter);
        sendJson(response, 200, { data });
        return true;
      }

      const assetMatch = /^\/api\/packages\/([^/]+)\/assets\/(.+)$/.exec(url.pathname);
      if (request.method === 'GET' && assetMatch?.[1] && assetMatch[2]) {
        sendJson(response, 200, {
          data: await service.readAsset(decodeURIComponent(assetMatch[1]), decodeURIComponent(assetMatch[2])),
        });
        return true;
      }

      const id = packageIdFromPath(url.pathname);
      if (request.method === 'GET' && id && url.pathname === `/api/packages/${encodeURIComponent(id)}`) {
        sendJson(response, 200, { data: await service.status(id) });
        return true;
      }

      if (request.method === 'POST' && id) {
        const body = await readJson(request);
        if (!mutation) throw new PackageMutationRequestError('PACKAGE_MUTATION_UNAVAILABLE', 503);
        const ownerId = resolveMutationOwner ? await resolveMutationOwner(request) : defaultMutationOwner(request);
        if (!ownerId) throw new PackageMutationRequestError('PACKAGE_MUTATION_OWNER_UNVERIFIED', 403);

        if (url.pathname.endsWith('/runtime/open') || url.pathname.endsWith('/runtime/close')) {
          if (!runtime) throw new PackageMutationRequestError('PACKAGE_MUTATION_UNAVAILABLE', 503);
          if (!hasExactKeys(body, ['runtimeId'])) {
            throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
          }
          const runtimeId = parseActionText(body.runtimeId, 'RUNTIME_ID', RUNTIME_ID);
          const runtimeRequest = { packageId: id, runtimeId, ownerId };
          const opening = url.pathname.endsWith('/runtime/open');
          if (opening) runtime.open(runtimeRequest);
          else runtime.close(runtimeRequest);
          sendJson(response, 200, { data: { active: opening } });
          return true;
        }

        if (url.pathname.endsWith('/permission-consent/approve')) {
          if (!hasExactKeys(body, ['challengeId', 'confirmed'])) {
            throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
          }
          const approval = parsePackageUpdatePermissionConsentApproveRequest(body);
          sendJson(response, 200, {
            data: await mutation.approvePermissionConsent({ ...approval, ownerId }),
          });
          return true;
        }
        if (url.pathname.endsWith('/permission-consent')) {
          if (!hasExactKeys(body, [])) throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
          const preparation = parsePackageUpdatePermissionConsentPrepareRequest({ id });
          sendJson(response, 200, {
            data: await mutation.preparePermissionConsent({ ...preparation, ownerId }),
          });
          return true;
        }
        if (url.pathname.endsWith('/consent')) {
          if (!hasExactKeys(body, ['action', 'confirmed', 'idempotencyKey', 'region'])) {
            throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
          }
          const consentRequest = parsePackageMutationConsentRequest({ id, ...body });
          sendJson(response, 200, {
            data: await mutation.requestConsent({ ...consentRequest, ownerId }),
          });
          return true;
        }
        const action = url.pathname.endsWith('/install')
          ? 'install'
          : url.pathname.endsWith('/uninstall')
            ? 'uninstall'
            : url.pathname.endsWith('/enable')
              ? 'enable'
              : url.pathname.endsWith('/disable')
                ? 'disable'
                : url.pathname.endsWith('/rollback')
                  ? 'rollback'
                  : undefined;
        if (action) {
          const baseExecuteKeys = ['consentId', 'idempotencyKey', 'region'];
          const permissionExecuteKeys = [...baseExecuteKeys, 'permissionConsentId'];
          if (!hasExactKeys(body, baseExecuteKeys) && !hasExactKeys(body, permissionExecuteKeys)) {
            throw new PackageMutationRequestError('PACKAGE_MUTATION_REQUEST_INVALID', 400);
          }
          const mutationRequest = parsePackageMutationExecuteRequest({ id, action, ...body });
          sendJson(response, 200, {
            data: await mutation.execute({ ...mutationRequest, ownerId }),
          });
          return true;
        }
      }

      sendJson(response, 404, { error: 'PACKAGE_ROUTE_NOT_FOUND' });
    } catch (error) {
      const failure = mutationError(error);
      console.error('[PackagePlatform] HTTP operation failed:', failure.code);
      sendJson(response, failure.status, { error: failure.code });
    }
    return true;
  };
};
