/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CatalogActionAuthorization } from '../../../../common/packages';
import {
  catalogDigest,
  createSerializedCatalogExecutor,
  fileExists,
  parseCatalogRevisionMarker,
  quarantineCatalogFile,
  readBoundedJson,
  writeJsonAtomically,
  type CatalogRevisionMarker,
} from './persistence';
import {
  CatalogFederationError,
  type CatalogActionConsent,
  type CatalogActionConsentResolver,
  type CatalogActionLedger,
  type CatalogActionLedgerEntry,
  type CatalogActionLedgerStart,
  type CatalogFederationErrorCode,
  type LinkedAppPolicySnapshot,
} from './types';

const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const MAX_LEDGER_ENTRIES = 500;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type CatalogActionLedgerOptions = {
  rootDir: string;
  now?: () => Date;
  randomId?: () => string;
};

export type CatalogActionConsentAuthorityOptions = {
  now?: () => Date;
  randomId?: () => string;
  ttlMs?: number;
  maxPendingGrants?: number;
};

export type CatalogActionUserDecision = CatalogActionAuthorization & {
  ownerId: string;
  idempotencyKey: string;
  region?: string;
  approved: boolean;
};

export type CatalogActionConsentAuthority = CatalogActionConsentResolver & {
  recordUserDecision: (decision: CatalogActionUserDecision) => CatalogActionConsent | undefined;
  revokeOwner: (ownerId: string) => void;
};

type LedgerDocument = {
  schemaVersion: 1;
  revision: number;
  entries: CatalogActionLedgerEntry[];
  digest: string;
};

type LedgerPaths = {
  active: string;
  recovery: string;
  marker: string;
  quarantine: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

const parseText = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || hasControlCharacters(value)) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', `${field} is invalid.`);
  }
  return value;
};

const parseIsoDate = (value: unknown, field: string): string => {
  const parsed = parseText(value, field, 64);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', `${field} is invalid.`);
  }
  return parsed;
};

const parseAuthorization = (value: unknown) => {
  if (
    !isRecord(value) ||
    (value.action !== 'install' &&
      value.action !== 'uninstall' &&
      value.action !== 'launch' &&
      value.action !== 'open-store-page')
  ) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger authorization is invalid.');
  }
  if (value.source !== 'tomni-store' && value.source !== 'microsoft-store') {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger authorization source is invalid.');
  }
  return {
    action: value.action,
    source: value.source,
    sourceItemId: parseText(value.sourceItemId, 'Ledger source item ID', 512),
  } as const;
};

const parseConsent = (
  value: unknown,
  authorization: ReturnType<typeof parseAuthorization>
): CatalogActionConsent | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger consent record is invalid.');
  }
  const consent: CatalogActionConsent = {
    schemaVersion: 1,
    consentId: parseText(value.consentId, 'Ledger consent ID', 200),
    action: value.action as CatalogActionConsent['action'],
    source: value.source as CatalogActionConsent['source'],
    sourceItemId: parseText(value.sourceItemId, 'Ledger consent source item ID', 512),
    ...(value.region !== undefined ? { region: parseText(value.region, 'Ledger consent region', 2) } : {}),
    grantedAt: parseIsoDate(value.grantedAt, 'Ledger consent grant time'),
    expiresAt: parseIsoDate(value.expiresAt, 'Ledger consent expiry time'),
  };
  if (
    consent.action !== authorization.action ||
    consent.source !== authorization.source ||
    consent.sourceItemId !== authorization.sourceItemId ||
    Date.parse(consent.expiresAt) <= Date.parse(consent.grantedAt)
  ) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger consent does not match its action.');
  }
  return consent;
};

const parseReceipt = (
  value: unknown,
  authorization: ReturnType<typeof parseAuthorization>
): NonNullable<CatalogActionLedgerEntry['receipt']> => {
  if (
    !isRecord(value) ||
    value.action !== authorization.action ||
    value.source !== authorization.source ||
    value.sourceItemId !== authorization.sourceItemId ||
    (value.provider !== 'tomni-package-manager' &&
      value.provider !== 'winget-msstore' &&
      value.provider !== 'store-uri') ||
    (value.status !== 'completed' && value.status !== 'delegated-to-store') ||
    (value.verification !== 'verified' && value.verification !== 'not-applicable')
  ) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger receipt does not match its authorization.');
  }
  const startedAt = parseIsoDate(value.startedAt, 'Ledger receipt start time');
  const completedAt = parseIsoDate(value.completedAt, 'Ledger receipt completion time');
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger receipt completion time is invalid.');
  }
  return {
    operationId: parseText(value.operationId, 'Ledger receipt operation ID', 200),
    action: authorization.action,
    source: authorization.source,
    sourceItemId: authorization.sourceItemId,
    provider: value.provider,
    startedAt,
    completedAt,
    status: value.status,
    verification: value.verification,
    ...(value.installedVersion !== undefined
      ? { installedVersion: parseText(value.installedVersion, 'Ledger receipt installed version', 100) }
      : {}),
  };
};

const parsePolicy = (value: unknown): LinkedAppPolicySnapshot | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !['healthy', 'degraded', 'blocked'].includes(String(value.health))) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger policy snapshot is invalid.');
  }
  if (typeof value.killSwitch !== 'boolean') {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger policy kill-switch is invalid.');
  }
  return {
    linkedAppId: parseText(value.linkedAppId, 'Ledger linked app ID', 300),
    reviewRevision: parseText(value.reviewRevision, 'Ledger policy revision', 300),
    reviewedAt: parseIsoDate(value.reviewedAt, 'Ledger policy review time'),
    health: value.health as LinkedAppPolicySnapshot['health'],
    killSwitch: value.killSwitch,
  };
};

const errorCodes = new Set<CatalogFederationErrorCode>([
  'CATALOG_REQUEST_INVALID',
  'CATALOG_SOURCE_DUPLICATE',
  'CATALOG_SOURCE_UNAVAILABLE',
  'CATALOG_CACHE_CORRUPT',
  'CATALOG_CACHE_ROLLBACK',
  'CATALOG_CONSENT_INVALID',
  'CATALOG_POLICY_UNAVAILABLE',
  'CATALOG_LEDGER_UNAVAILABLE',
  'CATALOG_ACTION_DENIED',
  'CATALOG_ACTION_UNSUPPORTED',
  'CATALOG_ACTION_IN_PROGRESS',
  'CATALOG_ACTION_IDEMPOTENCY_CONFLICT',
  'CATALOG_ACTION_RECOVERY_UNRESOLVED',
  'CATALOG_ACTION_RECOVERY_STALE',
  'CATALOG_ACTION_QUARANTINED',
  'LINKED_APP_INVALID',
  'LINKED_APP_BLOCKED',
  'LINKED_APP_NOT_REVIEWED',
  'LINKED_APP_IDENTITY_MISMATCH',
  'LINKED_APP_VERSION_INCOMPATIBLE',
]);

const entryPayload = (entry: Omit<CatalogActionLedgerEntry, 'digest'>): Omit<CatalogActionLedgerEntry, 'digest'> =>
  entry;

const parseEntry = (value: unknown): CatalogActionLedgerEntry => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !['authorized', 'invoking', 'completed', 'failed', 'quarantined'].includes(String(value.state))
  ) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger entry is invalid.');
  }
  const authorization = parseAuthorization(value.authorization);
  const idempotencyKey =
    value.idempotencyKey === undefined ? undefined : parseText(value.idempotencyKey, 'Ledger idempotency key', 200);
  const region = value.region === undefined ? undefined : parseText(value.region, 'Ledger region', 2);
  const consent = value.consent === undefined ? undefined : parseConsent(value.consent, authorization);
  if (consent?.region !== undefined && consent.region !== region) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger consent region does not match its action.');
  }
  const receipt = value.receipt === undefined ? undefined : parseReceipt(value.receipt, authorization);
  if (value.state === 'completed' && receipt === undefined) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Completed ledger entry has no receipt.');
  }
  if (
    (value.state === 'failed' || value.state === 'quarantined') &&
    (typeof value.errorCode !== 'string' || typeof value.errorMessage !== 'string')
  ) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Terminal ledger entry has no error record.');
  }
  const unsigned = {
    schemaVersion: 1 as const,
    id: parseText(value.id, 'Ledger entry ID', 200),
    state: value.state as CatalogActionLedgerEntry['state'],
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    authorization,
    ...(region !== undefined ? { region } : {}),
    ...(consent !== undefined ? { consent } : {}),
    ...(value.policy !== undefined ? { policy: parsePolicy(value.policy) } : {}),
    ...(receipt !== undefined ? { receipt } : {}),
    ...(typeof value.errorCode === 'string' && errorCodes.has(value.errorCode as CatalogFederationErrorCode)
      ? { errorCode: value.errorCode as CatalogFederationErrorCode }
      : {}),
    ...(typeof value.errorMessage === 'string'
      ? { errorMessage: parseText(value.errorMessage, 'Ledger error', 1_000) }
      : {}),
    startedAt: parseIsoDate(value.startedAt, 'Ledger start time'),
    updatedAt: parseIsoDate(value.updatedAt, 'Ledger update time'),
    ...(value.previousDigest !== undefined
      ? { previousDigest: parseText(value.previousDigest, 'Ledger previous digest', 80) }
      : {}),
  };
  if (typeof value.digest !== 'string' || value.digest !== catalogDigest(entryPayload(unsigned))) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger entry digest is invalid.');
  }
  return { ...unsigned, digest: value.digest };
};

const parseDocument = (value: unknown): LedgerDocument => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_LEDGER_ENTRIES
  ) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger document is invalid.');
  }
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger revision is invalid.');
  }
  const entries = value.entries.map(parseEntry);
  const idempotencyKeys = new Set<string>();
  let previousDigest: string | undefined;
  for (const entry of entries) {
    if (entry.previousDigest !== previousDigest) {
      throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger digest chain is invalid.');
    }
    if (entry.idempotencyKey) {
      if (idempotencyKeys.has(entry.idempotencyKey)) {
        throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger contains a duplicate idempotency key.');
      }
      idempotencyKeys.add(entry.idempotencyKey);
    }
    previousDigest = entry.digest;
  }
  const unsigned = { schemaVersion: 1 as const, revision: value.revision, entries };
  if (typeof value.digest !== 'string' || value.digest !== catalogDigest(unsigned)) {
    throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Ledger document digest is invalid.');
  }
  return { ...unsigned, digest: value.digest };
};

const pathsFor = (rootDir: string): LedgerPaths => ({
  active: path.join(rootDir, 'active.json'),
  recovery: path.join(rootDir, 'recovery.json'),
  marker: path.join(rootDir, 'marker.json'),
  quarantine: path.join(rootDir, 'quarantine'),
});

const normalizeChain = (
  entries: readonly Omit<CatalogActionLedgerEntry, 'digest' | 'previousDigest'>[]
): CatalogActionLedgerEntry[] => {
  const retainedEntries = entries.slice(-MAX_LEDGER_ENTRIES);
  let previousDigest: string | undefined;
  return retainedEntries.map((entry) => {
    const unsigned = { ...entry, ...(previousDigest ? { previousDigest } : {}) };
    const digest = catalogDigest(entryPayload(unsigned));
    previousDigest = digest;
    return { ...unsigned, digest };
  });
};

export const createCatalogActionLedger = ({
  rootDir,
  now = () => new Date(),
  randomId = randomUUID,
}: CatalogActionLedgerOptions): CatalogActionLedger => {
  if (!path.isAbsolute(rootDir)) throw new Error('Catalog action ledger directory must be absolute.');
  const paths = pathsFor(rootDir);
  const serialize = createSerializedCatalogExecutor();

  const readMarker = async (): Promise<CatalogRevisionMarker | undefined> => {
    if (!(await fileExists(paths.marker))) return undefined;
    try {
      return parseCatalogRevisionMarker(await readBoundedJson(paths.marker, 16 * 1_024));
    } catch (error) {
      await quarantineCatalogFile(paths.marker, paths.quarantine, now());
      throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action ledger marker is corrupt.', {
        cause: error,
      });
    }
  };

  const load = async (): Promise<LedgerDocument | undefined> => {
    const marker = await readMarker();
    if (!marker) {
      if ((await Promise.all([fileExists(paths.active), fileExists(paths.recovery)])).some(Boolean)) {
        await Promise.all(
          [paths.active, paths.recovery].map((candidate) => quarantineCatalogFile(candidate, paths.quarantine, now()))
        );
        throw new CatalogFederationError(
          'CATALOG_LEDGER_UNAVAILABLE',
          'Action ledger is missing its anti-rollback marker.'
        );
      }
      return undefined;
    }
    for (const candidate of [paths.active, paths.recovery]) {
      if (!(await fileExists(candidate))) continue;
      let document: LedgerDocument;
      try {
        document = parseDocument(await readBoundedJson(candidate, MAX_LEDGER_BYTES));
      } catch {
        await quarantineCatalogFile(candidate, paths.quarantine, now());
        continue;
      }
      if (document.revision !== marker.revision || document.digest !== marker.digest) continue;
      if (candidate !== paths.active) await writeJsonAtomically(paths.active, document);
      return document;
    }
    throw new CatalogFederationError(
      'CATALOG_LEDGER_UNAVAILABLE',
      'Action ledger does not match its committed revision.'
    );
  };

  const persist = async (entries: CatalogActionLedgerEntry[], currentRevision: number): Promise<LedgerDocument> => {
    const revision = currentRevision + 1;
    if (!Number.isSafeInteger(revision))
      throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action ledger revision overflow.');
    const verifiedEntries = entries.map(parseEntry);
    const unsigned = { schemaVersion: 1 as const, revision, entries: verifiedEntries };
    const document: LedgerDocument = { ...unsigned, digest: catalogDigest(unsigned) };
    await writeJsonAtomically(paths.active, document);
    await writeJsonAtomically(paths.recovery, document);
    await writeJsonAtomically(paths.marker, {
      schemaVersion: 1,
      revision,
      digest: document.digest,
      committedAt: now().toISOString(),
    } satisfies CatalogRevisionMarker);
    return document;
  };

  const list = (): Promise<CatalogActionLedgerEntry[]> =>
    serialize(async () => structuredClone((await load())?.entries ?? []));

  const findByIdempotencyKey = (idempotencyKey: string): Promise<CatalogActionLedgerEntry | undefined> =>
    serialize(async () => {
      const key = parseText(idempotencyKey, 'Ledger idempotency key', 200);
      const entry = (await load())?.entries.find((candidate) => candidate.idempotencyKey === key);
      return entry ? structuredClone(entry) : undefined;
    });

  const begin = (input: CatalogActionLedgerStart): Promise<CatalogActionLedgerEntry> =>
    serialize(async () => {
      const authorization = parseAuthorization(input.authorization);
      const idempotencyKey = parseText(input.idempotencyKey, 'Ledger idempotency key', 200);
      const timestamp = now();
      const startedAt = parseIsoDate(input.startedAt, 'Ledger start time');
      if (Date.parse(startedAt) > timestamp.getTime() + MAX_CLOCK_SKEW_MS) {
        throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action ledger start time is in the future.');
      }
      const consent = parseConsent(input.consent, authorization);
      const policy = parsePolicy(input.policy);
      const current = await load();
      const baseEntries = current?.entries ?? [];
      if (baseEntries.some((entry) => entry.idempotencyKey === idempotencyKey)) {
        throw new CatalogFederationError(
          'CATALOG_ACTION_IDEMPOTENCY_CONFLICT',
          'Action ledger already contains this idempotency key.'
        );
      }
      const newEntry = {
        schemaVersion: 1 as const,
        id: parseText(randomId(), 'Ledger entry ID', 200),
        state: 'authorized' as const,
        idempotencyKey,
        authorization,
        ...(input.region ? { region: parseText(input.region, 'Ledger region', 2) } : {}),
        ...(consent ? { consent } : {}),
        ...(policy ? { policy } : {}),
        startedAt,
        updatedAt: timestamp.toISOString(),
      };
      const entries = normalizeChain([
        ...baseEntries.map(({ digest: _, previousDigest: __, ...entry }) => entry),
        newEntry,
      ]);
      const document = await persist(entries, current?.revision ?? 0);
      return structuredClone(document.entries.at(-1)!);
    });

  const update = (
    id: string,
    allowedStates: readonly CatalogActionLedgerEntry['state'][],
    next: (
      entry: Omit<CatalogActionLedgerEntry, 'digest' | 'previousDigest'>
    ) => Omit<CatalogActionLedgerEntry, 'digest' | 'previousDigest'>
  ): Promise<CatalogActionLedgerEntry> =>
    serialize(async () => {
      const current = await load();
      if (!current)
        throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action ledger entry does not exist.');
      const targetId = parseText(id, 'Ledger entry ID', 200);
      let updated = false;
      const entries = normalizeChain(
        current.entries.map(({ digest: _, previousDigest: __, ...entry }) => {
          if (entry.id !== targetId) return entry;
          if (!allowedStates.includes(entry.state)) {
            throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action ledger entry is already terminal.');
          }
          updated = true;
          return next(entry);
        })
      );
      if (!updated)
        throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action ledger entry does not exist.');
      const document = await persist(entries, current.revision);
      return structuredClone(document.entries.find((entry) => entry.id === targetId)!);
    });

  const markInvoking = (id: string): Promise<CatalogActionLedgerEntry> =>
    update(id, ['authorized'], (entry) => ({
      ...entry,
      state: 'invoking',
      updatedAt: now().toISOString(),
    }));

  const complete = (id: string, receipt: CatalogActionLedgerEntry['receipt']): Promise<CatalogActionLedgerEntry> => {
    if (!receipt) throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Action receipt is required.');
    return update(id, ['authorized', 'invoking'], (entry) => ({
      ...entry,
      state: 'completed',
      receipt: structuredClone(receipt),
      updatedAt: now().toISOString(),
    }));
  };

  const transitionToError = (
    id: string,
    state: 'failed' | 'quarantined',
    error: unknown
  ): Promise<CatalogActionLedgerEntry> =>
    update(id, ['authorized', 'invoking'], (entry) => {
      const code = error instanceof CatalogFederationError ? error.code : 'CATALOG_SOURCE_UNAVAILABLE';
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...entry,
        state,
        errorCode: code,
        errorMessage: message.slice(0, 1_000) || 'Catalog action failed.',
        updatedAt: now().toISOString(),
      };
    });

  const fail = (id: string, error: unknown): Promise<CatalogActionLedgerEntry> =>
    transitionToError(id, 'failed', error);

  const quarantine = (id: string, error: unknown): Promise<CatalogActionLedgerEntry> =>
    transitionToError(id, 'quarantined', error);

  return { begin, markInvoking, complete, fail, quarantine, findByIdempotencyKey, list };
};

const DEFAULT_CONSENT_TTL_MS = 2 * 60 * 1_000;
const MAX_CONSENT_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_PENDING_CONSENT_GRANTS = 512;
const MAX_MAX_PENDING_CONSENT_GRANTS = 4_096;

type StoredCatalogActionConsent = {
  consent: CatalogActionConsent;
  ownerId: string;
  idempotencyKey: string;
};

const parseConsentAuthorityText = (value: string, field: string, maxLength: number): string => {
  if (!value.trim() || value !== value.trim() || value.length > maxLength || hasControlCharacters(value)) {
    throw new CatalogFederationError('CATALOG_REQUEST_INVALID', `${field} is invalid.`);
  }
  return value;
};

/**
 * Keeps short-lived, owner-bound consent grants in trusted host memory.
 * A grant can only be created from an explicit decision and is also bound to
 * the action's idempotency key, so it cannot authorize a second mutation.
 */
export const createCatalogActionConsentAuthority = ({
  now = () => new Date(),
  randomId = randomUUID,
  ttlMs = DEFAULT_CONSENT_TTL_MS,
  maxPendingGrants = DEFAULT_MAX_PENDING_CONSENT_GRANTS,
}: CatalogActionConsentAuthorityOptions = {}): CatalogActionConsentAuthority => {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_CONSENT_TTL_MS) {
    throw new RangeError('Catalog action consent TTL is invalid.');
  }
  if (
    !Number.isSafeInteger(maxPendingGrants) ||
    maxPendingGrants < 1 ||
    maxPendingGrants > MAX_MAX_PENDING_CONSENT_GRANTS
  ) {
    throw new RangeError('Catalog action consent capacity is invalid.');
  }
  const grants = new Map<string, StoredCatalogActionConsent>();

  const removeExpired = (checkedAt: number): void => {
    for (const [consentId, grant] of grants) {
      if (Date.parse(grant.consent.expiresAt) <= checkedAt) grants.delete(consentId);
    }
  };

  const recordUserDecision = (decision: CatalogActionUserDecision): CatalogActionConsent | undefined => {
    const ownerId = parseConsentAuthorityText(decision.ownerId, 'Catalog consent owner', 200);
    const idempotencyKey = parseConsentAuthorityText(decision.idempotencyKey, 'Catalog idempotency key', 200);
    const sourceItemId = parseConsentAuthorityText(decision.sourceItemId, 'Catalog source item ID', 512);
    if (!decision.approved) return undefined;
    const grantedAt = now();
    removeExpired(grantedAt.getTime());
    if (grants.size >= maxPendingGrants) return undefined;
    const consentId = parseConsentAuthorityText(randomId(), 'Catalog consent ID', 200);
    const consent: CatalogActionConsent = {
      schemaVersion: 1,
      consentId,
      action: decision.action,
      source: decision.source,
      sourceItemId,
      ...(decision.region ? { region: decision.region } : {}),
      grantedAt: grantedAt.toISOString(),
      expiresAt: new Date(grantedAt.getTime() + ttlMs).toISOString(),
    };
    grants.set(consentId, { consent, ownerId, idempotencyKey });
    return structuredClone(consent);
  };

  const authorize: CatalogActionConsentResolver['authorize'] = (request) => {
    const checkedAt = now().getTime();
    removeExpired(checkedAt);
    if (!request.consentId || !request.ownerId || !request.idempotencyKey) return { allowed: false };
    const grant = grants.get(request.consentId);
    if (
      !grant ||
      grant.ownerId !== request.ownerId ||
      grant.idempotencyKey !== request.idempotencyKey ||
      grant.consent.action !== request.action ||
      grant.consent.source !== request.source ||
      grant.consent.sourceItemId !== request.sourceItemId ||
      grant.consent.region !== request.region
    ) {
      return { allowed: false };
    }
    return { allowed: true, consent: structuredClone(grant.consent) };
  };

  const revokeOwner = (ownerId: string): void => {
    for (const [consentId, grant] of grants) {
      if (grant.ownerId === ownerId) grants.delete(consentId);
    }
  };

  return { authorize, recordUserDecision, revokeOwner };
};
