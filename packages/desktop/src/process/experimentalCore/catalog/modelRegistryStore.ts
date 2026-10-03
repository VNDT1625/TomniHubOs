/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmod, copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { modelPackManifestSha256, parseModelPackManifest } from './modelPackManifest';
import {
  MODEL_REGISTRY_SCHEMA_VERSION,
  modelPackKey,
  type CoreModelPurpose,
  type ModelCatalogTrustMetadata,
  type ModelPackLifecycleStatus,
  type ModelPackManifest,
  type ModelPackRegistryRecord,
  type ModelPromotionGateReceipt,
  type ModelPromotionTarget,
  type ModelRegistrySnapshot,
} from './modelPackTypes';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PROMOTION_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PROMOTION_RECEIPT_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MODEL_PURPOSES = new Set<CoreModelPurpose>(['security', 'user-understanding', 'semantic-analysis']);
const PROMOTION_TARGETS = new Set<ModelPromotionTarget>(['shadow', 'pilot', 'active']);
const MODEL_LIFECYCLE_STATUSES = new Set<ModelPackLifecycleStatus>([
  'discovered',
  'downloading',
  'staged',
  'verified',
  'candidate',
  'shadow',
  'pilot',
  'active',
  'superseded',
  'quarantined',
]);

export type ModelRegistryPersistence = {
  read(): Promise<ModelRegistrySnapshot>;
  compareAndSwap(expectedRevision: number, next: ModelRegistrySnapshot): Promise<void>;
};

export type VerifiedModelCatalogTrust =
  | { trusted: false; reason?: string }
  | { trusted: true; method: 'signature'; keyId: string }
  | { trusted: true; method: 'pinned-digest'; sha256: string };

export type ModelCatalogTrustVerifier = {
  verify(metadata: Readonly<ModelCatalogTrustMetadata>): Promise<VerifiedModelCatalogTrust>;
};

export type VerifiedModelPromotionGate = { approved: true } | { approved: false; reason?: string };

/**
 * Trust boundary for promotion evidence. Production composition intentionally omits this
 * verifier until a signed verification/benchmark/human-review service is available.
 */
export type ModelPromotionGateVerifier = {
  verify(
    input: Readonly<{ manifest: ModelPackManifest; receipt: ModelPromotionGateReceipt }>
  ): Promise<VerifiedModelPromotionGate>;
};

export type ModelRegistryErrorCode =
  | 'revision-conflict'
  | 'record-not-found'
  | 'record-in-use'
  | 'immutable-version-conflict'
  | 'version-downgrade'
  | 'invalid-transition'
  | 'catalog-rollback'
  | 'catalog-freeze'
  | 'catalog-trust-invalid'
  | 'promotion-gate-invalid'
  | 'promotion-gate-required'
  | 'promotion-gate-rejected'
  | 'rollback-unavailable'
  | 'corrupt-registry';

export class ModelRegistryError extends Error {
  public constructor(
    public readonly code: ModelRegistryErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ModelRegistryError';
  }
}

export const createEmptyModelRegistry = (): ModelRegistrySnapshot => ({
  schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION,
  revision: 0,
  records: {},
  activeByPurpose: {},
  previousActiveByPurpose: {},
  highestSeenCatalogRevision: 0,
});

const cloneSnapshot = (snapshot: ModelRegistrySnapshot): ModelRegistrySnapshot => structuredClone(snapshot);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean => {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && actual.every((key) => allowed.has(key));
};

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));

const PROMOTION_STAGES: readonly ModelPromotionTarget[] = ['shadow', 'pilot', 'active'];

const requiredPromotionStages = (status: ModelPackLifecycleStatus): readonly ModelPromotionTarget[] => {
  const finalStatus = status === 'superseded' ? 'active' : status;
  const index = PROMOTION_STAGES.indexOf(finalStatus as ModelPromotionTarget);
  return index < 0 ? [] : PROMOTION_STAGES.slice(0, index + 1);
};

const allowedPromotionStages = (status: ModelPackLifecycleStatus): readonly ModelPromotionTarget[] =>
  status === 'quarantined' ? PROMOTION_STAGES : requiredPromotionStages(status);

const isPromotionReceipts = (
  value: unknown,
  manifest: ModelPackManifest
): value is Partial<Record<ModelPromotionTarget, ModelPromotionGateReceipt>> => {
  if (!isRecord(value)) return false;
  const present = new Set<ModelPromotionTarget>();
  for (const [target, receipt] of Object.entries(value)) {
    if (!PROMOTION_TARGETS.has(target as ModelPromotionTarget) || !isRecord(receipt)) return false;
    const candidate = receipt.candidate;
    const verification = receipt.verification;
    const benchmark = receipt.benchmark;
    const humanApproval = receipt.humanApproval;
    if (
      !hasExactKeys(receipt, ['schemaVersion', 'target', 'candidate', 'verification', 'benchmark', 'humanApproval']) ||
      receipt.schemaVersion !== 1 ||
      receipt.target !== target ||
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['id', 'version', 'purpose', 'manifestSha256']) ||
      candidate.id !== manifest.id ||
      candidate.version !== manifest.version ||
      candidate.purpose !== manifest.purpose ||
      candidate.manifestSha256 !== modelPackManifestSha256(manifest) ||
      !isRecord(verification) ||
      !hasExactKeys(verification, ['verified', 'reportSha256', 'provenanceSha256']) ||
      verification.verified !== true ||
      typeof verification.reportSha256 !== 'string' ||
      !SHA256_PATTERN.test(verification.reportSha256) ||
      verification.provenanceSha256 !== manifest.training.provenanceSha256 ||
      !isRecord(benchmark) ||
      !hasExactKeys(benchmark, [
        'postTrainingReportSha256',
        'reportSha256',
        'confidenceGatePassed',
        'candidateOnly',
        'promotionAllowed',
      ]) ||
      typeof benchmark.postTrainingReportSha256 !== 'string' ||
      !SHA256_PATTERN.test(benchmark.postTrainingReportSha256) ||
      benchmark.reportSha256 !== manifest.evaluation.reportSha256 ||
      benchmark.confidenceGatePassed !== true ||
      benchmark.candidateOnly !== true ||
      benchmark.promotionAllowed !== false ||
      !isRecord(humanApproval) ||
      !hasExactKeys(humanApproval, ['approvalId', 'approvalSha256', 'approvedAt', 'approvedFor']) ||
      typeof humanApproval.approvalId !== 'string' ||
      humanApproval.approvalId.trim().length === 0 ||
      typeof humanApproval.approvalSha256 !== 'string' ||
      !SHA256_PATTERN.test(humanApproval.approvalSha256) ||
      !isTimestamp(humanApproval.approvedAt) ||
      humanApproval.approvedFor !== target
    ) {
      return false;
    }
    present.add(target as ModelPromotionTarget);
  }
  return (!present.has('pilot') || present.has('shadow')) && (!present.has('active') || present.has('pilot'));
};

const hasPromotionReceiptsFor = (
  status: ModelPackLifecycleStatus,
  receipts: Partial<Record<ModelPromotionTarget, ModelPromotionGateReceipt>> | undefined
): boolean => {
  const required = requiredPromotionStages(status);
  const allowed = allowedPromotionStages(status);
  if (!receipts) return required.length === 0;
  const keys = Object.keys(receipts) as ModelPromotionTarget[];
  return required.every((target) => receipts[target] !== undefined) && keys.every((target) => allowed.includes(target));
};

/**
 * Promotion approvals are short lived. A forward clock jump expires old evidence;
 * a backward jump makes an approval appear to come from the future. Both fail closed.
 */
const isPromotionReceiptTimely = (receipt: ModelPromotionGateReceipt, now: Date): boolean => {
  const approvedAt = Date.parse(receipt.humanApproval.approvedAt);
  const nowMs = now.getTime();
  return (
    Number.isFinite(approvedAt) &&
    approvedAt <= nowMs + PROMOTION_RECEIPT_FUTURE_SKEW_MS &&
    nowMs - approvedAt <= PROMOTION_RECEIPT_MAX_AGE_MS
  );
};

const corruptRegistry = (message: string): never => {
  throw new ModelRegistryError('corrupt-registry', message);
};

const assertSnapshot = (value: unknown): ModelRegistrySnapshot => {
  if (!isRecord(value)) {
    throw new ModelRegistryError('corrupt-registry', 'Model registry is not an object.');
  }
  const snapshot = value;
  if (
    !hasExactKeys(
      snapshot,
      [
        'schemaVersion',
        'revision',
        'records',
        'activeByPurpose',
        'previousActiveByPurpose',
        'highestSeenCatalogRevision',
      ],
      ['trustedCatalogSha256']
    ) ||
    snapshot.schemaVersion !== MODEL_REGISTRY_SCHEMA_VERSION ||
    !Number.isSafeInteger(snapshot.revision) ||
    (snapshot.revision as number) < 0 ||
    !Number.isSafeInteger(snapshot.highestSeenCatalogRevision) ||
    (snapshot.highestSeenCatalogRevision as number) < 0
  ) {
    throw new ModelRegistryError('corrupt-registry', 'Model registry schema is invalid.');
  }
  if (
    !isRecord(snapshot.records) ||
    !isRecord(snapshot.activeByPurpose) ||
    !isRecord(snapshot.previousActiveByPurpose)
  ) {
    throw new ModelRegistryError('corrupt-registry', 'Model registry collections are invalid.');
  }
  const rawRecords = snapshot.records;
  const rawActivePointers = snapshot.activeByPurpose;
  const rawPreviousPointers = snapshot.previousActiveByPurpose;
  const highestSeenCatalogRevision = snapshot.highestSeenCatalogRevision as number;
  if (
    (highestSeenCatalogRevision === 0 && snapshot.trustedCatalogSha256 !== undefined) ||
    (highestSeenCatalogRevision > 0 &&
      (typeof snapshot.trustedCatalogSha256 !== 'string' || !SHA256_PATTERN.test(snapshot.trustedCatalogSha256)))
  ) {
    throw new ModelRegistryError('corrupt-registry', 'Model registry catalog trust state is invalid.');
  }

  const records: Record<string, ModelPackRegistryRecord> = {};
  for (const [dictionaryKey, candidateValue] of Object.entries(rawRecords)) {
    if (!isRecord(candidateValue)) {
      throw new ModelRegistryError('corrupt-registry', `Model registry record is invalid: ${dictionaryKey}`);
    }
    const candidate = candidateValue;
    if (
      !hasExactKeys(
        candidate,
        ['key', 'manifest', 'status', 'createdAt', 'updatedAt'],
        ['installedPath', 'quarantineReason', 'promotionReceipts']
      ) ||
      typeof candidate.key !== 'string' ||
      typeof candidate.status !== 'string' ||
      !MODEL_LIFECYCLE_STATUSES.has(candidate.status as ModelPackLifecycleStatus) ||
      !isTimestamp(candidate.createdAt) ||
      !isTimestamp(candidate.updatedAt) ||
      (candidate.installedPath !== undefined &&
        (typeof candidate.installedPath !== 'string' || candidate.installedPath.length === 0)) ||
      (candidate.quarantineReason !== undefined &&
        (typeof candidate.quarantineReason !== 'string' || candidate.quarantineReason.length === 0)) ||
      (candidate.status === 'quarantined' && typeof candidate.quarantineReason !== 'string')
    ) {
      corruptRegistry(`Model registry record is invalid: ${dictionaryKey}`);
    }
    let manifest: ModelPackManifest;
    try {
      manifest = parseModelPackManifest(candidate.manifest);
    } catch {
      throw new ModelRegistryError('corrupt-registry', `Model registry manifest is invalid: ${dictionaryKey}`);
    }
    if (dictionaryKey !== candidate.key || dictionaryKey !== modelPackKey(manifest)) {
      corruptRegistry(`Model registry record key is invalid: ${dictionaryKey}`);
    }
    const status = candidate.status as ModelPackLifecycleStatus;
    let promotionReceipts: Partial<Record<ModelPromotionTarget, ModelPromotionGateReceipt>> | undefined;
    if (candidate.promotionReceipts !== undefined) {
      if (!isPromotionReceipts(candidate.promotionReceipts, manifest)) {
        corruptRegistry(`Model registry promotion receipts are invalid: ${dictionaryKey}`);
      }
      promotionReceipts = structuredClone(candidate.promotionReceipts);
    }
    if (!hasPromotionReceiptsFor(status, promotionReceipts)) {
      corruptRegistry(`Model registry is missing promotion receipts: ${dictionaryKey}`);
    }
    records[dictionaryKey] = {
      key: dictionaryKey,
      manifest,
      status,
      ...(candidate.installedPath === undefined ? {} : { installedPath: candidate.installedPath as string }),
      ...(candidate.quarantineReason === undefined ? {} : { quarantineReason: candidate.quarantineReason as string }),
      ...(promotionReceipts === undefined ? {} : { promotionReceipts }),
      createdAt: candidate.createdAt as string,
      updatedAt: candidate.updatedAt as string,
    };
  }

  const parsePointers = (
    candidate: Record<string, unknown>,
    requiredStatus: 'active' | 'superseded',
    label: string
  ): Partial<Record<CoreModelPurpose, string>> => {
    const pointers: Partial<Record<CoreModelPurpose, string>> = {};
    for (const [purpose, key] of Object.entries(candidate)) {
      if (!MODEL_PURPOSES.has(purpose as CoreModelPurpose) || typeof key !== 'string') {
        throw new ModelRegistryError('corrupt-registry', `${label} contains an invalid pointer.`);
      }
      const record = records[key];
      if (!record || record.manifest.purpose !== purpose || record.status !== requiredStatus) {
        corruptRegistry(`${label} points to an incompatible record.`);
      }
      pointers[purpose as CoreModelPurpose] = key;
    }
    return pointers;
  };

  const activeByPurpose = parsePointers(rawActivePointers, 'active', 'activeByPurpose');
  const previousActiveByPurpose = parsePointers(rawPreviousPointers, 'superseded', 'previousActiveByPurpose');
  for (const record of Object.values(records)) {
    if (record.status === 'active' && activeByPurpose[record.manifest.purpose] !== record.key) {
      corruptRegistry('An active record is not bound by its purpose pointer.');
    }
  }
  for (const purpose of MODEL_PURPOSES) {
    if (activeByPurpose[purpose] !== undefined && activeByPurpose[purpose] === previousActiveByPurpose[purpose]) {
      corruptRegistry('Active and previous-active pointers cannot reference the same record.');
    }
  }

  return {
    schemaVersion: MODEL_REGISTRY_SCHEMA_VERSION,
    revision: snapshot.revision as number,
    records,
    activeByPurpose,
    previousActiveByPurpose,
    highestSeenCatalogRevision,
    ...(snapshot.trustedCatalogSha256 === undefined
      ? {}
      : { trustedCatalogSha256: snapshot.trustedCatalogSha256 as string }),
  };
};

export class InMemoryModelRegistryPersistence implements ModelRegistryPersistence {
  private snapshot: ModelRegistrySnapshot;

  public constructor(initial: ModelRegistrySnapshot = createEmptyModelRegistry()) {
    this.snapshot = cloneSnapshot(assertSnapshot(initial));
  }

  public async read(): Promise<ModelRegistrySnapshot> {
    return cloneSnapshot(this.snapshot);
  }

  public async compareAndSwap(expectedRevision: number, next: ModelRegistrySnapshot): Promise<void> {
    if (this.snapshot.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    if (next.revision !== expectedRevision + 1) {
      throw new ModelRegistryError('revision-conflict', 'Next registry revision must advance exactly once.');
    }
    this.snapshot = cloneSnapshot(assertSnapshot(next));
  }
}

/** Disk-backed CAS store. A lock serializes writers; active/previous files provide crash recovery. */
export class FileModelRegistryPersistence implements ModelRegistryPersistence {
  private readonly previousPath: string;
  private readonly lockPath: string;

  public constructor(private readonly registryPath: string) {
    this.previousPath = `${registryPath}.previous`;
    this.lockPath = `${registryPath}.lock`;
  }

  public async read(): Promise<ModelRegistrySnapshot> {
    const candidates = await Promise.all(
      [this.registryPath, this.previousPath].map(async (candidate) => {
        try {
          return await readFile(candidate, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
      })
    );
    for (const text of candidates) {
      if (!text) continue;
      try {
        return assertSnapshot(JSON.parse(text) as unknown);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof ModelRegistryError) continue;
        throw error;
      }
    }
    return createEmptyModelRegistry();
  }

  public async compareAndSwap(expectedRevision: number, next: ModelRegistrySnapshot): Promise<void> {
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    let lock: Awaited<ReturnType<typeof open>>;
    try {
      lock = await open(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ModelRegistryError('revision-conflict', 'Another registry writer owns the CAS lock.');
      }
      throw error;
    }
    const temporaryPath = `${this.registryPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      const current = await this.read();
      if (current.revision !== expectedRevision || next.revision !== expectedRevision + 1) {
        throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
      }
      assertSnapshot(next);
      try {
        await copyFile(this.registryPath, this.previousPath);
        await chmod(this.previousPath, 0o600).catch((): void => undefined);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const temporary = await open(temporaryPath, 'wx', 0o600);
      try {
        await temporary.writeFile(JSON.stringify(next), 'utf8');
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await rename(temporaryPath, this.registryPath);
      await chmod(this.registryPath, 0o600).catch((): void => undefined);
    } finally {
      await unlink(temporaryPath).catch((): void => undefined);
      await lock.close();
      await unlink(this.lockPath).catch((): void => undefined);
    }
  }
}

const parseVersion = (version: string): { core: number[]; prerelease?: string } => {
  const [withoutBuild] = version.split('+');
  const [core, prerelease] = withoutBuild.split('-', 2);
  return { core: core.split('.').map(Number), prerelease };
};

const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
};

const TRANSITIONS: Readonly<Record<ModelPackLifecycleStatus, readonly ModelPackLifecycleStatus[]>> = {
  discovered: ['downloading', 'quarantined'],
  downloading: ['staged', 'quarantined'],
  staged: ['verified', 'quarantined'],
  verified: ['candidate', 'quarantined'],
  candidate: ['shadow', 'quarantined'],
  shadow: ['pilot', 'quarantined'],
  pilot: ['active', 'quarantined'],
  active: ['superseded', 'quarantined'],
  superseded: ['active', 'quarantined'],
  quarantined: [],
};

const requireRecord = (snapshot: ModelRegistrySnapshot, key: string): ModelPackRegistryRecord => {
  const record = snapshot.records[key];
  if (!record) throw new ModelRegistryError('record-not-found', `Model Pack is not registered: ${key}`);
  return record;
};

export class ModelRegistryStore {
  public constructor(
    private readonly persistence: ModelRegistryPersistence,
    private readonly now: () => Date = () => new Date(),
    private readonly catalogTrustVerifier?: ModelCatalogTrustVerifier,
    private readonly promotionGateVerifier?: ModelPromotionGateVerifier
  ) {}

  public async read(): Promise<ModelRegistrySnapshot> {
    return this.persistence.read();
  }

  public async getActive(purpose: CoreModelPurpose): Promise<ModelPackRegistryRecord | undefined> {
    const snapshot = assertSnapshot(await this.persistence.read());
    const key = snapshot.activeByPurpose[purpose];
    if (!key) return undefined;
    const record = snapshot.records[key];
    return record && (await this.isServingRecord(record)) ? structuredClone(record) : undefined;
  }

  /** Revalidates all staged approvals before exposing an adapter for runtime selection. */
  private async isServingRecord(record: ModelPackRegistryRecord): Promise<boolean> {
    if (record.status !== 'active' || !record.promotionReceipts || !this.promotionGateVerifier) return false;
    const now = this.now();
    for (const target of PROMOTION_STAGES) {
      const receipt = record.promotionReceipts[target];
      if (!receipt || !isPromotionReceiptTimely(receipt, now)) return false;
      let decision: VerifiedModelPromotionGate | undefined;
      try {
        decision = await this.promotionGateVerifier.verify({
          manifest: structuredClone(record.manifest),
          receipt: structuredClone(receipt),
        });
      } catch {
        decision = undefined;
      }
      if (!decision?.approved) return false;
    }
    return true;
  }

  public async acceptCatalog(
    metadata: ModelCatalogTrustMetadata,
    expectedRevision: number
  ): Promise<ModelRegistrySnapshot> {
    if (
      metadata.schemaVersion !== 1 ||
      !Number.isSafeInteger(metadata.revision) ||
      metadata.revision <= 0 ||
      !metadata.version ||
      !SHA256_PATTERN.test(metadata.sha256) ||
      !Number.isFinite(Date.parse(metadata.expiresAt)) ||
      Boolean(metadata.signature) !== Boolean(metadata.keyId)
    ) {
      throw new ModelRegistryError('catalog-trust-invalid', 'Catalog trust metadata is invalid.');
    }
    let trust: VerifiedModelCatalogTrust | undefined;
    try {
      trust = await this.catalogTrustVerifier?.verify(Object.freeze({ ...metadata }));
    } catch {
      trust = undefined;
    }
    const trustIsBound =
      trust?.trusted === true &&
      ((trust.method === 'signature' &&
        Boolean(metadata.signature && metadata.keyId) &&
        trust.keyId === metadata.keyId) ||
        (trust.method === 'pinned-digest' && SHA256_PATTERN.test(trust.sha256) && trust.sha256 === metadata.sha256));
    if (!trustIsBound) {
      throw new ModelRegistryError(
        'catalog-trust-invalid',
        'Catalog signature or pinned digest was not verified by a trusted verifier.'
      );
    }
    if (Date.parse(metadata.expiresAt) <= this.now().getTime()) {
      throw new ModelRegistryError('catalog-freeze', 'Catalog metadata is expired.');
    }
    const current = await this.persistence.read();
    if (current.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    if (metadata.revision < current.highestSeenCatalogRevision) {
      throw new ModelRegistryError('catalog-rollback', 'Catalog revision is lower than the highest trusted revision.');
    }
    if (metadata.revision === current.highestSeenCatalogRevision) {
      if (current.trustedCatalogSha256 !== metadata.sha256) {
        throw new ModelRegistryError('catalog-rollback', 'Catalog revision was reused with a different digest.');
      }
      return current;
    }
    const next = cloneSnapshot(current);
    next.revision += 1;
    next.highestSeenCatalogRevision = metadata.revision;
    next.trustedCatalogSha256 = metadata.sha256;
    await this.persistence.compareAndSwap(expectedRevision, next);
    return next;
  }

  public async registerCandidate(
    manifest: ModelPackManifest,
    installedPath: string,
    expectedRevision: number
  ): Promise<ModelRegistrySnapshot> {
    const parsedManifest = parseModelPackManifest(manifest);
    const current = await this.persistence.read();
    if (current.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    const key = modelPackKey(parsedManifest);
    const existingByKey = current.records[key];
    if (existingByKey) {
      if (existingByKey.installedPath !== installedPath || !isDeepStrictEqual(existingByKey.manifest, parsedManifest)) {
        throw new ModelRegistryError('immutable-version-conflict', 'Published Model Pack identity cannot be rebound.');
      }
      return current;
    }
    for (const existing of Object.values(current.records)) {
      if (existing.manifest.id !== parsedManifest.id) continue;
      if (existing.manifest.version === parsedManifest.version) {
        throw new ModelRegistryError(
          'immutable-version-conflict',
          'Published Model Pack version cannot be overwritten.'
        );
      }
      if (compareVersions(parsedManifest.version, existing.manifest.version) < 0) {
        throw new ModelRegistryError('version-downgrade', 'Older Model Pack versions cannot be registered.');
      }
    }
    const timestamp = this.now().toISOString();
    const next = cloneSnapshot(current);
    next.revision += 1;
    next.records[key] = {
      key,
      manifest: structuredClone(parsedManifest),
      status: 'candidate',
      installedPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.persistence.compareAndSwap(expectedRevision, next);
    return next;
  }

  public async promote(
    key: string,
    target: ModelPromotionTarget,
    expectedRevision: number,
    receipt: ModelPromotionGateReceipt
  ): Promise<ModelRegistrySnapshot> {
    const current = await this.persistence.read();
    if (current.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    const record = requireRecord(current, key);
    if (!TRANSITIONS[record.status].includes(target)) {
      throw new ModelRegistryError('invalid-transition', `Cannot promote ${record.status} to ${target}.`);
    }
    const proposedReceipts = { ...record.promotionReceipts, [target]: receipt };
    if (!isPromotionReceipts(proposedReceipts, record.manifest)) {
      throw new ModelRegistryError('promotion-gate-invalid', 'Promotion receipt is not bound to this Model Pack.');
    }
    if (!hasPromotionReceiptsFor(target, proposedReceipts)) {
      throw new ModelRegistryError('promotion-gate-required', 'Earlier promotion evidence is missing.');
    }
    const approvalAlreadyUsed = Object.values(current.records).some((candidateRecord) =>
      Object.values(candidateRecord.promotionReceipts ?? {}).some(
        (existingReceipt) => existingReceipt?.humanApproval.approvalId === receipt.humanApproval.approvalId
      )
    );
    if (approvalAlreadyUsed) {
      throw new ModelRegistryError('promotion-gate-invalid', 'Promotion approval has already been used.');
    }
    const now = this.now();
    if (
      Object.values(proposedReceipts).some(
        (candidateReceipt) => candidateReceipt === undefined || !isPromotionReceiptTimely(candidateReceipt, now)
      )
    ) {
      throw new ModelRegistryError(
        'promotion-gate-invalid',
        'Promotion receipt is expired or is dated too far in the future.'
      );
    }
    let gateDecision: VerifiedModelPromotionGate | undefined;
    try {
      gateDecision = await this.promotionGateVerifier?.verify({
        manifest: structuredClone(record.manifest),
        receipt: structuredClone(receipt),
      });
    } catch {
      gateDecision = undefined;
    }
    if (!gateDecision?.approved) {
      throw new ModelRegistryError(
        this.promotionGateVerifier ? 'promotion-gate-rejected' : 'promotion-gate-required',
        this.promotionGateVerifier
          ? 'Trusted promotion verification did not approve this receipt.'
          : 'A trusted promotion verifier is required before serving a Model Pack.'
      );
    }
    const next = cloneSnapshot(current);
    const promoted = next.records[key];
    promoted.promotionReceipts = structuredClone(proposedReceipts);
    if (target === 'active') {
      const purpose = promoted.manifest.purpose;
      const currentActiveKey = next.activeByPurpose[purpose];
      if (currentActiveKey && currentActiveKey !== key) {
        const currentActive = requireRecord(next, currentActiveKey);
        currentActive.status = 'superseded';
        currentActive.updatedAt = this.now().toISOString();
        next.previousActiveByPurpose[purpose] = currentActiveKey;
      }
      next.activeByPurpose[purpose] = key;
    }
    promoted.status = target;
    promoted.updatedAt = this.now().toISOString();
    next.revision += 1;
    await this.persistence.compareAndSwap(expectedRevision, next);
    return next;
  }

  public async quarantine(key: string, reason: string, expectedRevision: number): Promise<ModelRegistrySnapshot> {
    const current = await this.persistence.read();
    if (current.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    const record = requireRecord(current, key);
    if (record.status === 'quarantined') return current;
    const next = cloneSnapshot(current);
    const quarantined = next.records[key];
    const purpose = quarantined.manifest.purpose;
    quarantined.status = 'quarantined';
    quarantined.quarantineReason = reason || 'unspecified';
    quarantined.updatedAt = this.now().toISOString();
    if (next.activeByPurpose[purpose] === key) {
      const previousKey = next.previousActiveByPurpose[purpose];
      const previous = previousKey ? next.records[previousKey] : undefined;
      if (previous && previous.status === 'superseded') {
        previous.status = 'active';
        previous.updatedAt = this.now().toISOString();
        next.activeByPurpose[purpose] = previous.key;
      } else {
        delete next.activeByPurpose[purpose];
      }
      delete next.previousActiveByPurpose[purpose];
    } else if (next.previousActiveByPurpose[purpose] === key) {
      delete next.previousActiveByPurpose[purpose];
    }
    next.revision += 1;
    await this.persistence.compareAndSwap(expectedRevision, next);
    return next;
  }

  public async unregister(key: string, expectedRevision: number): Promise<ModelRegistrySnapshot> {
    const current = await this.persistence.read();
    if (current.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    const record = requireRecord(current, key);
    const isActive = record.status === 'active' || Object.values(current.activeByPurpose).includes(key);
    const isRollbackRetained = Object.values(current.previousActiveByPurpose).includes(key);
    const retainsPromotionApproval = Object.values(record.promotionReceipts ?? {}).some(
      (receipt) => receipt !== undefined
    );
    if (isActive || isRollbackRetained || retainsPromotionApproval) {
      throw new ModelRegistryError(
        'record-in-use',
        isActive
          ? 'Active Model Pack cannot be unregistered.'
          : isRollbackRetained
            ? 'Rollback-retained Model Pack cannot be unregistered.'
            : 'Model Pack with retained promotion approval cannot be unregistered.'
      );
    }
    const next = cloneSnapshot(current);
    delete next.records[key];
    next.revision += 1;
    await this.persistence.compareAndSwap(expectedRevision, next);
    return next;
  }

  public async rollback(purpose: CoreModelPurpose, expectedRevision: number): Promise<ModelRegistrySnapshot> {
    const current = await this.persistence.read();
    if (current.revision !== expectedRevision) {
      throw new ModelRegistryError('revision-conflict', 'Model registry revision changed concurrently.');
    }
    const activeKey = current.activeByPurpose[purpose];
    const previousKey = current.previousActiveByPurpose[purpose];
    if (!activeKey || !previousKey) {
      throw new ModelRegistryError('rollback-unavailable', `No rollback target is available for ${purpose}.`);
    }
    const next = cloneSnapshot(current);
    const active = requireRecord(next, activeKey);
    const previous = requireRecord(next, previousKey);
    if (active.status !== 'active' || previous.status !== 'superseded') {
      throw new ModelRegistryError('rollback-unavailable', 'Rollback records are not in a safe state.');
    }
    active.status = 'superseded';
    active.updatedAt = this.now().toISOString();
    previous.status = 'active';
    previous.updatedAt = this.now().toISOString();
    next.activeByPurpose[purpose] = previousKey;
    next.previousActiveByPurpose[purpose] = activeKey;
    next.revision += 1;
    await this.persistence.compareAndSwap(expectedRevision, next);
    return next;
  }
}
