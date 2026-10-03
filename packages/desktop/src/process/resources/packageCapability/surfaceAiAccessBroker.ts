import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PackageIdentity, PackageManifest, PackageSurfaceAiOperation } from '@/common/packages';
import type { RunBudget, RunIntent } from '@/common/foundation/runTypes';
import type { OutcomeReceipt } from '@/common/foundation/receiptTypes';
import { type ActiveRunExecutionContext, RunKernel } from '@/process/foundation/runKernel';
import type { TrustBroker } from '@/process/foundation/trustBroker';
import type {
  SurfaceAiRuntimeTransportBinding,
  SurfaceAiRuntimeTransportInvocation,
  SurfaceAiRuntimeTransportProgress,
  SurfaceAiRuntimeTransportRegistry,
} from './surfaceAiRuntimeTransport';
import type {
  SurfaceAiObservationIdentity,
  SurfaceAiObservationStore,
} from '../packageProcessRuntime/surfaceAiObservationStore';

const SURFACE_AI_ACCESS_SCHEMA_VERSION = 1 as const;
/**
 * Bump this only when the Main-owned AI-access policy has materially changed.
 * A consent stores the exact value so an older approval can never be replayed
 * against a newer policy.
 */
const SURFACE_AI_ACCESS_POLICY_VERSION = 'surface-ai-access-v1';
const MAX_CONSENT_STORE_BYTES = 4 * 1024 * 1024;
const DATA_CLASSES = new Set<SurfaceAiDataClass>([
  'workspace',
  'conversation',
  'personal',
  'artifact',
  'secret-handle',
]);

type SurfaceAiDataClass = PackageSurfaceAiOperation['dataClasses'][number];

export type SurfaceAiAccessConsent = Readonly<{
  schemaVersion: typeof SURFACE_AI_ACCESS_SCHEMA_VERSION;
  consentId: string;
  accountId: string;
  surface: PackageIdentity;
  placement: 'local';
  operationId: string;
  capability: string;
  /**
   * Missing only on legacy durable envelopes. Legacy approvals remain readable
   * and revocable, but dispatch fails closed until the user confirms again.
   */
  policyVersion?: string;
  inputSchemaVersion: 1;
  dataClasses: readonly SurfaceAiDataClass[];
  destinationIds: readonly string[];
  secretUse: boolean;
  limits: RunBudget;
  grantedAt: number;
  expiresAt: number;
  revokedAt?: number;
}>;

/** A durable Main-owned authority; a renderer or a package can never manufacture a consent record. */
export type SurfaceAiAccessConsentStore = Readonly<{
  get: (consentId: string) => SurfaceAiAccessConsent | undefined;
  onRevoked?: (listener: (consentId: string) => void) => () => void;
}>;

export type SurfaceAiAccessConsentAuthority = SurfaceAiAccessConsentStore &
  Readonly<{
    initialize: () => Promise<void>;
    /** Returns secret-free records for the Main-owned account that owns them. */
    listForAccount: (accountId: string) => readonly SurfaceAiAccessConsent[];
    /** Records only a consent already confirmed by a Main-owned confirmation surface. */
    recordConfirmed: (consent: SurfaceAiAccessConsent) => Promise<void>;
    revoke: (consentId: string) => Promise<boolean>;
  }>;

/** Main-issued display data for a one-time AI-access confirmation. */
export type SurfaceAiAccessConsentChallenge = Readonly<{
  schemaVersion: typeof SURFACE_AI_ACCESS_SCHEMA_VERSION;
  challengeId: string;
  ownerId: string;
  accountId: string;
  surface: PackageIdentity;
  placement: 'local';
  operation: PackageSurfaceAiOperation;
  policyVersion: string;
  secretUse: boolean;
  limits: RunBudget;
  issuedAt: number;
  expiresAt: number;
}>;

/** The renderer may only return approval for a Main-derived challenge. */
export type SurfaceAiAccessConsentChallengeAuthority = Readonly<{
  issue: (request: {
    ownerId: string;
    accountId: string;
    packageId: string;
    operationId: string;
    secretUse: boolean;
    limits: RunBudget;
  }) => SurfaceAiAccessConsentChallenge;
  confirm: (request: {
    ownerId: string;
    challengeId: string;
    approved: boolean;
  }) => Promise<{ approved: boolean; consent?: SurfaceAiAccessConsent }>;
}>;

export type ActiveLocalSurface = Readonly<{
  identity: PackageIdentity;
  manifest: Pick<PackageManifest, 'aiAccess'>;
  approvedForAiAccess: boolean;
  revoked: boolean;
}>;

/** Exact Main-owned runtime identity for an active local Surface instance. */
export type SurfaceAiRuntimeIdentity = Readonly<{
  ownerId: string;
  runtimeId: string;
}>;

export type SurfaceAiInvocation = Readonly<{
  invocationId: string;
  consentId: string;
  accountId: string;
  surface: PackageIdentity;
  runtime: SurfaceAiRuntimeIdentity;
  placement: 'local';
  operation: PackageSurfaceAiOperation;
  childRunId: string;
  childTaskId: string;
  capabilityGrant: readonly string[];
  budget: RunBudget;
  input: SurfaceAiRuntimeTransportInvocation['input'];
  signal: AbortSignal;
}>;

export type SurfaceAiAccessRequest = Readonly<{
  invocationId: string;
  consentId: string;
  accountId: string;
  surface: PackageIdentity;
  runtime: SurfaceAiRuntimeIdentity;
  placement: 'local';
  operationId: string;
  dataClasses: readonly SurfaceAiDataClass[];
  destinationIds: readonly string[];
  secretUse: boolean;
  parentIntent: RunIntent;
  childRunId: string;
  childTaskId: string;
  budget: RunBudget;
  /** Main-created, bounded v1 instruction after model output and context projection are governed. */
  input: SurfaceAiRuntimeTransportInvocation['input'];
  /**
   * Present only when a currently executing Main-owned parent Run invokes this
   * broker. It prevents an MCP tool from recreating that parent lifecycle.
   */
  activeRun?: ActiveRunExecutionContext;
  invokeSurface: (invocation: SurfaceAiInvocation) => Promise<{ evidenceRefs: readonly string[] }>;
  signal?: AbortSignal;
}>;

export type SurfaceAiAccessResult = Readonly<{
  childReceipt: OutcomeReceipt;
  /** Compatibility-only direct harness path; active parent Runs terminal later. */
  parentReceipt?: OutcomeReceipt;
}>;

/**
 * Main-only dispatch input. It intentionally has no renderer/IPC counterpart:
 * an agent orchestration service must construct the parent Run and bounded
 * instruction before it can call this seam.
 */
export type SurfaceAiOperationDispatchRequest = Omit<SurfaceAiAccessRequest, 'invokeSurface'> &
  Readonly<{
    /** Main-owned observer for a future durable progress store or UI projection. */
    onProgress?: (progress: SurfaceAiRuntimeTransportProgress) => void;
  }>;

export type SurfaceAiOperationDispatcher = Readonly<{
  dispatch: (request: SurfaceAiOperationDispatchRequest) => Promise<SurfaceAiAccessResult>;
}>;

export type SurfaceAiOperationDispatcherDeps = Readonly<{
  broker: SurfaceAiAccessBroker;
  transportRegistry: Pick<SurfaceAiRuntimeTransportRegistry, 'invoke' | 'isActive'>;
  /** Resolves a port binding solely from Main-owned live runtime state. */
  resolveRuntimeBinding: (
    surface: PackageIdentity,
    runtime: SurfaceAiRuntimeIdentity
  ) => Promise<SurfaceAiRuntimeTransportBinding | undefined>;
  /**
   * Optional Main-owned C4 progress/artifact sink. Composition must opt in;
   * this dispatcher never derives a filesystem location from package input.
   */
  observationStore?: Pick<SurfaceAiObservationStore, 'open' | 'recordProgress' | 'recordResult'>;
  createOperationLeaseId?: () => string;
  timeoutMs?: number;
}>;

export type SurfaceAiAccessBrokerErrorCode =
  | 'SURFACE_AI_ACCESS_REQUEST_INVALID'
  | 'SURFACE_AI_ACCESS_DISABLED'
  | 'SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE'
  | 'SURFACE_AI_ACCESS_RUNTIME_UNAVAILABLE'
  | 'SURFACE_AI_ACCESS_OPERATION_UNDECLARED'
  | 'SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE'
  | 'SURFACE_AI_ACCESS_CONSENT_MISMATCH'
  | 'SURFACE_AI_ACCESS_CONSENT_EXPIRED'
  | 'SURFACE_AI_ACCESS_CHALLENGE_INVALID'
  | 'SURFACE_AI_ACCESS_CHALLENGE_EXPIRED'
  | 'SURFACE_AI_ACCESS_DELEGATION_INVALID'
  | 'SURFACE_AI_ACCESS_TRUST_DENIED';

export class SurfaceAiAccessBrokerError extends Error {
  public constructor(
    readonly code: SurfaceAiAccessBrokerErrorCode,
    cause?: unknown
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'SurfaceAiAccessBrokerError';
  }
}

export type SurfaceAiAccessBrokerDeps = Readonly<{
  /**
   * The shared Main-owned Foundation kernel. A Surface operation must never
   * create an isolated lifecycle that could bypass governed receipts, leases,
   * or recovery evidence.
   */
  kernel: RunKernel;
  now?: () => number;
  /** Main-owned material-policy revision; never renderer or package supplied. */
  policyVersion?: () => string;
  enabled?: () => boolean;
  consentStore: SurfaceAiAccessConsentStore;
  resolveActiveLocalSurface: (packageId: string) => ActiveLocalSurface | undefined;
  /**
   * Optional asynchronous Store recheck at dispatch time. A production C4
   * composer supplies this from the one initialized Package Manager so a
   * cached plan/consent cannot invoke a disabled, updated, or revoked Surface.
   */
  assertCurrentLocalSurface?: (surface: PackageIdentity, runtime: SurfaceAiRuntimeIdentity) => Promise<boolean>;
  /** Verifies the exact owner/runtime binding supplied by the Main runtime registry. */
  isExactRuntimeActive: (surface: PackageIdentity, runtime: SurfaceAiRuntimeIdentity) => boolean;
  /** Runtime closure, owner loss, and Store revocation must abort active Surface work. */
  onRuntimeInvalidated?: (
    listener: (event: Readonly<{ packageId: string; runtimeId: string; ownerId: string }>) => void
  ) => () => void;
  /**
   * The shared Trust gate. Surface operations always receive a live
   * origin-bound grant plus serialized pre/post egress inspection.
   */
  trustBroker: TrustBroker;
  trustOrigin: string;
}>;

export type SurfaceAiAccessBroker = Readonly<{
  invoke: (request: SurfaceAiAccessRequest) => Promise<SurfaceAiAccessResult>;
}>;

const surfaceCapability = (surface: PackageIdentity, operationId: string): string =>
  `surface.ai:${surface.packageId}:${operationId}`;

const requireText = (value: string, code: SurfaceAiAccessBrokerErrorCode): string => {
  const normalized = value.trim();
  if (!normalized) throw new SurfaceAiAccessBrokerError(code);
  return normalized;
};

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const sameStrings = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length || new Set(left).size !== left.length || new Set(right).size !== right.length) {
    return false;
  }
  return left.every((value) => right.includes(value));
};

const clone = <T>(value: T): T => structuredClone(value);

const requireValidConsent = (value: unknown): SurfaceAiAccessConsent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
  }
  const consent = value as Partial<SurfaceAiAccessConsent>;
  const allowedKeys = new Set([
    'schemaVersion',
    'consentId',
    'accountId',
    'surface',
    'placement',
    'operationId',
    'capability',
    'policyVersion',
    'inputSchemaVersion',
    'dataClasses',
    'destinationIds',
    'secretUse',
    'limits',
    'grantedAt',
    'expiresAt',
    'revokedAt',
  ]);
  if (Object.keys(consent).some((key) => !allowedKeys.has(key))) {
    throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
  }
  const hasIdentity = (identity: unknown): identity is PackageIdentity => {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false;
    const candidate = identity as Partial<PackageIdentity>;
    return [candidate.packageId, candidate.packageVersion, candidate.publisherId].every(
      (field) => typeof field === 'string' && field.trim().length > 0 && field.length <= 200
    );
  };
  const validStrings = (values: unknown, limit: number): values is readonly string[] =>
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= limit &&
    values.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 256) &&
    new Set(values).size === values.length;
  const validBudget = (budget: unknown): budget is RunBudget => {
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return false;
    const candidate = budget as Partial<RunBudget>;
    return (
      Number.isSafeInteger(candidate.maxEstimatedCostMB) &&
      candidate.maxEstimatedCostMB >= 1 &&
      Number.isSafeInteger(candidate.maxSteps) &&
      candidate.maxSteps >= 1
    );
  };
  const valid =
    consent.schemaVersion === SURFACE_AI_ACCESS_SCHEMA_VERSION &&
    typeof consent.consentId === 'string' &&
    consent.consentId.trim().length > 0 &&
    consent.consentId.length <= 200 &&
    typeof consent.accountId === 'string' &&
    consent.accountId.trim().length > 0 &&
    consent.accountId.length <= 200 &&
    hasIdentity(consent.surface) &&
    consent.placement === 'local' &&
    typeof consent.operationId === 'string' &&
    consent.operationId.trim().length > 0 &&
    consent.operationId.length <= 200 &&
    typeof consent.capability === 'string' &&
    consent.capability.trim().length > 0 &&
    consent.capability.length <= 200 &&
    (consent.policyVersion === undefined ||
      (typeof consent.policyVersion === 'string' &&
        consent.policyVersion.trim().length > 0 &&
        consent.policyVersion.length <= 200)) &&
    consent.inputSchemaVersion === 1 &&
    validStrings(consent.dataClasses, 10) &&
    consent.dataClasses.every((dataClass) => DATA_CLASSES.has(dataClass as SurfaceAiDataClass)) &&
    validStrings(consent.destinationIds, 50) &&
    typeof consent.secretUse === 'boolean' &&
    validBudget(consent.limits) &&
    Number.isSafeInteger(consent.grantedAt) &&
    consent.grantedAt >= 0 &&
    Number.isSafeInteger(consent.expiresAt) &&
    consent.expiresAt > consent.grantedAt &&
    (consent.revokedAt === undefined ||
      (Number.isSafeInteger(consent.revokedAt) && consent.revokedAt >= consent.grantedAt));
  if (!valid) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
  return clone(consent as SurfaceAiAccessConsent);
};

/**
 * Durable local consent authority. It stores only a consent envelope, never a
 * secret value or raw user context, and rejects a malformed or duplicate store
 * instead of silently broadening access.
 */
export const createJsonSurfaceAiAccessConsentAuthority = (options: {
  filePath: string;
  now?: () => number;
  /** Defaults to the current local policy for normal Main confirmation. */
  policyVersion?: () => string;
}): SurfaceAiAccessConsentAuthority => {
  const records = new Map<string, SurfaceAiAccessConsent>();
  const listeners = new Set<(consentId: string) => void>();
  const now = options.now ?? Date.now;
  const currentPolicyVersion = (): string =>
    requireText(options.policyVersion?.() ?? SURFACE_AI_ACCESS_POLICY_VERSION, 'SURFACE_AI_ACCESS_CONSENT_MISMATCH');
  let initialized = false;
  let writeQueue = Promise.resolve();

  const flush = (): Promise<void> => {
    const payload = JSON.stringify(
      { schemaVersion: SURFACE_AI_ACCESS_SCHEMA_VERSION, consents: [...records.values()] },
      null,
      2
    );
    const write = writeQueue.then(async () => {
      await mkdir(path.dirname(options.filePath), { recursive: true });
      const temporary = `${options.filePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, options.filePath);
    });
    writeQueue = write.catch((): undefined => undefined);
    return write;
  };

  return {
    initialize: async () => {
      if (initialized) return;
      try {
        if ((await stat(options.filePath)).size > MAX_CONSENT_STORE_BYTES) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
        }
        const raw: unknown = JSON.parse(await readFile(options.filePath, 'utf8'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
        }
        const state = raw as { schemaVersion?: unknown; consents?: unknown };
        if (state.schemaVersion !== SURFACE_AI_ACCESS_SCHEMA_VERSION || !Array.isArray(state.consents)) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
        }
        const next = new Map<string, SurfaceAiAccessConsent>();
        for (const candidate of state.consents) {
          const consent = requireValidConsent(candidate);
          if (next.has(consent.consentId)) {
            throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
          }
          next.set(consent.consentId, consent);
        }
        records.clear();
        for (const [consentId, consent] of next) records.set(consentId, consent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      initialized = true;
    },
    get: (consentId) => (initialized ? clone(records.get(consentId)) : undefined),
    listForAccount: (accountId) =>
      initialized
        ? [...records.values()].filter((consent) => consent.accountId === accountId).map((consent) => clone(consent))
        : [],
    onRevoked: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recordConfirmed: async (rawConsent) => {
      if (!initialized) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE');
      const consent = requireValidConsent(rawConsent);
      if (consent.policyVersion !== currentPolicyVersion()) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
      }
      if (consent.revokedAt !== undefined || consent.grantedAt > now()) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
      }
      const existing = records.get(consent.consentId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(consent)) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
      }
      if (!existing) {
        records.set(consent.consentId, consent);
        await flush();
      }
    },
    revoke: async (consentId) => {
      if (!initialized) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE');
      const current = records.get(consentId);
      if (!current || current.revokedAt !== undefined) return false;
      const revoked = { ...current, revokedAt: now() };
      records.set(consentId, revoked);
      await flush();
      for (const listener of listeners) listener(consentId);
      return true;
    },
  };
};

const withinBudget = (requested: RunBudget, allowed: RunBudget): boolean =>
  Number.isSafeInteger(requested.maxEstimatedCostMB) &&
  Number.isSafeInteger(requested.maxSteps) &&
  requested.maxEstimatedCostMB >= 1 &&
  requested.maxSteps >= 1 &&
  requested.maxEstimatedCostMB <= allowed.maxEstimatedCostMB &&
  requested.maxSteps <= allowed.maxSteps;

const abortWhenEitherAborts = (
  source?: AbortSignal
): { signal: AbortSignal; abort: () => void; cleanup: () => void } => {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (source?.aborted) abort();
  else source?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    abort,
    cleanup: () => source?.removeEventListener('abort', abort),
  };
};

const assertChallengeDuration = (value: number, label: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

/**
 * Main-only challenge authority. It derives every consent field from the
 * installed active Surface and its declaration; the UI can only approve or
 * reject an exact, owner-bound challenge.
 */
export const createSurfaceAiAccessConsentChallengeAuthority = (options: {
  consentAuthority: SurfaceAiAccessConsentAuthority;
  resolveActiveLocalSurface: (packageId: string) => ActiveLocalSurface | undefined;
  now?: () => number;
  /** Main-owned revision of the policy displayed in this consent challenge. */
  policyVersion?: () => string;
  createChallengeId?: () => string;
  createConsentId?: () => string;
  challengeTtlMs?: number;
  consentTtlMs?: number;
}): SurfaceAiAccessConsentChallengeAuthority => {
  const now = options.now ?? Date.now;
  const currentPolicyVersion = (): string =>
    requireText(options.policyVersion?.() ?? SURFACE_AI_ACCESS_POLICY_VERSION, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
  const createChallengeId = options.createChallengeId ?? randomUUID;
  const createConsentId = options.createConsentId ?? randomUUID;
  const challengeTtlMs = assertChallengeDuration(
    options.challengeTtlMs ?? 5 * 60_000,
    'Challenge duration',
    15 * 60_000
  );
  const consentTtlMs = assertChallengeDuration(
    options.consentTtlMs ?? 60 * 60_000,
    'Consent duration',
    31 * 24 * 60 * 60_000
  );
  const challenges = new Map<string, SurfaceAiAccessConsentChallenge>();

  const resolve = (
    packageId: string,
    operationId: string
  ): { surface: ActiveLocalSurface; operation: PackageSurfaceAiOperation } => {
    const surface = options.resolveActiveLocalSurface(packageId);
    if (!surface || !surface.approvedForAiAccess || surface.revoked) {
      throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
    }
    const operation = surface.manifest.aiAccess?.operations.find((candidate) => candidate.id === operationId);
    if (!operation) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_OPERATION_UNDECLARED');
    return { surface, operation };
  };

  return {
    issue: (request) => {
      const ownerId = requireText(request.ownerId, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      const accountId = requireText(request.accountId, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      const packageId = requireText(request.packageId, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      const operationId = requireText(request.operationId, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      if (
        typeof request.secretUse !== 'boolean' ||
        !Number.isSafeInteger(request.limits.maxEstimatedCostMB) ||
        !Number.isSafeInteger(request.limits.maxSteps) ||
        request.limits.maxEstimatedCostMB < 1 ||
        request.limits.maxSteps < 1
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      }
      const { surface, operation } = resolve(packageId, operationId);
      const issuedAt = now();
      const challenge: SurfaceAiAccessConsentChallenge = {
        schemaVersion: SURFACE_AI_ACCESS_SCHEMA_VERSION,
        challengeId: requireText(createChallengeId(), 'SURFACE_AI_ACCESS_CHALLENGE_INVALID'),
        ownerId,
        accountId,
        surface: clone(surface.identity),
        placement: 'local',
        operation: clone(operation),
        policyVersion: currentPolicyVersion(),
        secretUse: request.secretUse,
        limits: clone(request.limits),
        issuedAt,
        expiresAt: issuedAt + challengeTtlMs,
      };
      if (challenges.has(challenge.challengeId))
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      challenges.set(challenge.challengeId, challenge);
      return clone(challenge);
    },
    confirm: async (request) => {
      const ownerId = requireText(request.ownerId, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      const challengeId = requireText(request.challengeId, 'SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      if (typeof request.approved !== 'boolean')
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.ownerId !== ownerId)
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      if (challenge.expiresAt <= now()) {
        challenges.delete(challengeId);
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_EXPIRED');
      }
      challenges.delete(challengeId);
      if (!request.approved) return { approved: false };
      if (challenge.policyVersion !== currentPolicyVersion()) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
      }

      const { surface, operation } = resolve(challenge.surface.packageId, challenge.operation.id);
      if (
        !sameIdentity(surface.identity, challenge.surface) ||
        JSON.stringify(operation) !== JSON.stringify(challenge.operation)
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CHALLENGE_INVALID');
      }
      const grantedAt = now();
      const consent = requireValidConsent({
        schemaVersion: SURFACE_AI_ACCESS_SCHEMA_VERSION,
        consentId: requireText(createConsentId(), 'SURFACE_AI_ACCESS_CHALLENGE_INVALID'),
        accountId: challenge.accountId,
        surface: challenge.surface,
        placement: 'local',
        operationId: operation.id,
        capability: operation.capability,
        policyVersion: challenge.policyVersion,
        inputSchemaVersion: operation.inputSchemaVersion,
        dataClasses: operation.dataClasses,
        destinationIds: operation.destinationIds,
        secretUse: challenge.secretUse,
        limits: challenge.limits,
        grantedAt,
        expiresAt: grantedAt + consentTtlMs,
      });
      await options.consentAuthority.recordConfirmed(consent);
      return { approved: true, consent: clone(consent) };
    },
  };
};

/**
 * Main-process-only local Surface gate. It deliberately accepts a caller-owned
 * invocation transport: registration with the package runtime bridge happens
 * only after that bridge can authenticate the exact package Surface.
 */
export const createSurfaceAiAccessBroker = (deps: SurfaceAiAccessBrokerDeps): SurfaceAiAccessBroker => {
  const { kernel } = deps;
  const now = deps.now ?? Date.now;
  const currentPolicyVersion = (): string =>
    requireText(deps.policyVersion?.() ?? SURFACE_AI_ACCESS_POLICY_VERSION, 'SURFACE_AI_ACCESS_CONSENT_MISMATCH');

  return {
    invoke: async (request) => {
      // C4 stays fail-closed until bootstrap supplies an explicit release gate.
      if (deps.enabled?.() !== true) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DISABLED');
      requireText(request.invocationId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.consentId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.accountId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.operationId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.childRunId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.childTaskId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.runtime.ownerId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      requireText(request.runtime.runtimeId, 'SURFACE_AI_ACCESS_REQUEST_INVALID');
      if (request.placement !== 'local') throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_REQUEST_INVALID');
      if (
        request.input.schemaVersion !== 1 ||
        typeof request.input.instruction !== 'string' ||
        request.input.instruction.trim().length === 0 ||
        Buffer.byteLength(request.input.instruction, 'utf8') > 12 * 1024
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_REQUEST_INVALID');
      }
      if (request.childRunId === request.parentIntent.runId) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID');
      }

      const surface = deps.resolveActiveLocalSurface(request.surface.packageId);
      if (
        !surface ||
        !sameIdentity(surface.identity, request.surface) ||
        !surface.approvedForAiAccess ||
        surface.revoked
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
      }
      if (
        deps.assertCurrentLocalSurface !== undefined &&
        !(await deps.assertCurrentLocalSurface(surface.identity, request.runtime))
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
      }
      if (!deps.isExactRuntimeActive(surface.identity, request.runtime)) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_RUNTIME_UNAVAILABLE');
      }
      const operation = surface.manifest.aiAccess?.operations.find((candidate) => candidate.id === request.operationId);
      if (!operation) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_OPERATION_UNDECLARED');

      const consent = deps.consentStore.get(request.consentId);
      if (!consent) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_UNAVAILABLE');
      const policyVersion = currentPolicyVersion();
      if (consent.revokedAt !== undefined || consent.grantedAt > now() || consent.expiresAt <= now()) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_EXPIRED');
      }
      if (
        consent.schemaVersion !== SURFACE_AI_ACCESS_SCHEMA_VERSION ||
        consent.accountId !== request.accountId ||
        !sameIdentity(consent.surface, surface.identity) ||
        consent.placement !== 'local' ||
        consent.operationId !== operation.id ||
        consent.capability !== operation.capability ||
        consent.policyVersion !== policyVersion ||
        consent.inputSchemaVersion !== operation.inputSchemaVersion ||
        consent.secretUse !== request.secretUse ||
        !sameStrings(consent.dataClasses, operation.dataClasses) ||
        !sameStrings(consent.destinationIds, operation.destinationIds) ||
        !sameStrings(request.dataClasses, operation.dataClasses) ||
        !sameStrings(request.destinationIds, operation.destinationIds) ||
        !withinBudget(request.budget, consent.limits)
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
      }

      const capability = surfaceCapability(surface.identity, operation.id);
      if (!request.parentIntent.capabilityGrant?.includes(capability)) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID');
      }
      if (
        request.activeRun !== undefined &&
        (!request.activeRun.isActive() ||
          request.activeRun.parentIntent.runId !== request.parentIntent.runId ||
          request.activeRun.parentIntent.rootTaskId !== request.parentIntent.rootTaskId ||
          request.activeRun.parentIntent.correlationId !== request.parentIntent.correlationId)
      ) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID');
      }
      const trustRequest = {
        runId: request.childRunId,
        taskId: request.childTaskId,
        actorId: request.accountId,
        operation: 'package' as const,
        targetId: `surface:${surface.identity.packageId}:${operation.id}`,
        requestedCapabilities: [capability],
        workspaceScope: request.parentIntent.workspaceScope,
        policyVersion: request.parentIntent.policyVersion,
        idempotencyKey: `${request.parentIntent.runId}:${request.childRunId}:${request.invocationId}`,
        reason: `Execute declared Surface operation ${operation.id}`,
        packageId: surface.identity.packageId,
        packageSigned: true,
      };
      const trustOrigin = deps.trustOrigin;
      const trustGrant = await deps.trustBroker.requestCapability(trustRequest, trustOrigin);
      if (trustGrant.decision !== 'allow' || trustGrant.grantId === undefined) {
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_TRUST_DENIED');
      }
      const preflight = await deps.trustBroker.inspectFinalEgress({
        ...trustRequest,
        origin: trustOrigin,
        grantId: trustGrant.grantId,
        serializedPayload: request.input.instruction,
      });
      if (preflight.decision !== 'allow') throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_TRUST_DENIED');
      // Trust preflight and durable receipt recovery are asynchronous. Re-read
      // each decision input before a new package effect can start, so a consent
      // withdrawal or material Surface change during either wait cannot dispatch.
      const assertCurrentConsent = (): void => {
        const currentConsent = deps.consentStore.get(consent.consentId);
        if (
          !currentConsent ||
          currentConsent.revokedAt !== undefined ||
          currentConsent.grantedAt > now() ||
          currentConsent.expiresAt <= now()
        ) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_EXPIRED');
        }
        if (currentConsent.policyVersion !== policyVersion || currentPolicyVersion() !== policyVersion) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
        }
      };
      const assertCurrentAuthorization = async (): Promise<void> => {
        assertCurrentConsent();
        const currentSurface = deps.resolveActiveLocalSurface(request.surface.packageId);
        if (
          !currentSurface ||
          !sameIdentity(currentSurface.identity, surface.identity) ||
          !currentSurface.approvedForAiAccess ||
          currentSurface.revoked
        ) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
        }
        if (
          deps.assertCurrentLocalSurface !== undefined &&
          !(await deps.assertCurrentLocalSurface(currentSurface.identity, request.runtime))
        ) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_SURFACE_UNAVAILABLE');
        }
        assertCurrentConsent();
        if (!deps.isExactRuntimeActive(currentSurface.identity, request.runtime)) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_RUNTIME_UNAVAILABLE');
        }
        const currentOperation = currentSurface.manifest.aiAccess?.operations.find(
          (candidate) => candidate.id === request.operationId
        );
        if (!currentOperation) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_OPERATION_UNDECLARED');
        if (
          currentOperation.capability !== operation.capability ||
          currentOperation.inputSchemaVersion !== operation.inputSchemaVersion ||
          !sameStrings(currentOperation.dataClasses, operation.dataClasses) ||
          !sameStrings(currentOperation.destinationIds, operation.destinationIds)
        ) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_CONSENT_MISMATCH');
        }
      };
      await assertCurrentAuthorization();
      // A terminal parent/child pair may be replayed after process restart. Return
      // its durable receipts instead of attempting to append a second lifecycle
      // or invoking the package effect again.
      const recoveredParentReceipt = await kernel.getReceiptForAccount(request.accountId, request.parentIntent.runId);
      const recoveredChildReceipt = await kernel.getReceiptForAccount(request.accountId, request.childRunId);
      if (recoveredParentReceipt !== undefined || recoveredChildReceipt !== undefined) {
        if (
          recoveredParentReceipt === undefined ||
          recoveredChildReceipt === undefined ||
          recoveredChildReceipt.parentRunId !== recoveredParentReceipt.runId
        ) {
          throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID');
        }
        return { parentReceipt: recoveredParentReceipt, childReceipt: recoveredChildReceipt };
      }
      await assertCurrentAuthorization();
      const childIntent: RunIntent = {
        ...request.parentIntent,
        runId: request.childRunId,
        rootTaskId: request.childTaskId,
        parentRunId: request.parentIntent.runId,
        surface: `package:${surface.identity.packageId}`,
        goal: `AI operation ${operation.id} on ${surface.identity.packageId}`,
        capabilityGrant: [capability],
        budget: request.budget,
      };
      const operationAbort = abortWhenEitherAborts(request.signal ?? request.activeRun?.signal);
      const unsubscribeRevocation = deps.consentStore.onRevoked?.((consentId) => {
        if (consentId === consent.consentId) operationAbort.abort();
      });
      const unsubscribeRuntimeInvalidation = deps.onRuntimeInvalidated?.((event) => {
        if (
          event.packageId === surface.identity.packageId &&
          event.runtimeId === request.runtime.runtimeId &&
          event.ownerId === request.runtime.ownerId
        ) {
          operationAbort.abort();
        }
      });

      try {
        const childCandidates = [
          {
            id: `surface:${surface.identity.packageId}:${operation.id}`,
            factors: { localSurface: 1 },
            estimatedCostMB: request.budget.maxEstimatedCostMB,
            priority: 1,
          },
        ];
        const childExecutor = async (_leaseId?: string, signal?: AbortSignal) => {
          // A child may wait for a resource lease after the preflight checks.
          // Re-read durable authorization at the final Main-owned dispatch seam
          // so revocation, runtime invalidation, or parent cancellation cannot
          // start the package callback from a queued child.
          await assertCurrentAuthorization();
          if (signal?.aborted || operationAbort.signal.aborted) {
            throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID');
          }
          const invocationResult = await request.invokeSurface({
            invocationId: request.invocationId,
            consentId: consent.consentId,
            accountId: consent.accountId,
            surface: surface.identity,
            runtime: request.runtime,
            placement: 'local',
            operation,
            childRunId: childIntent.runId,
            childTaskId: childIntent.rootTaskId,
            capabilityGrant: [capability],
            budget: request.budget,
            input: request.input,
            signal: signal ?? operationAbort.signal,
          });
          const egress = await deps.trustBroker.inspectFinalEgress({
            ...trustRequest,
            origin: trustOrigin,
            grantId: trustGrant.grantId,
            serializedPayload: JSON.stringify({ evidenceRefs: invocationResult.evidenceRefs }),
          });
          if (egress.decision !== 'allow') throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_TRUST_DENIED');
          return invocationResult;
        };
        const parentEvidence = [
          `surface-ai:${request.invocationId}`,
          `surface:${surface.identity.packageId}@${surface.identity.packageVersion}`,
          `surface-ai-consent:${consent.consentId}`,
        ];
        if (request.activeRun !== undefined) {
          const childReceipt = await request.activeRun.executeDelegatedChild({
            childIntent,
            candidates: childCandidates,
            executor: childExecutor,
            parentEvidence,
            signal: operationAbort.signal,
          });
          return { childReceipt };
        }
        return await kernel.executeRunWithChild(
          request.parentIntent,
          [{ id: 'hub:surface-ai', factors: { localSurface: 1 }, estimatedCostMB: 1, priority: 1 }],
          childIntent,
          childCandidates,
          childExecutor,
          parentEvidence,
          operationAbort.signal
        );
      } catch (error) {
        if (error instanceof SurfaceAiAccessBrokerError) throw error;
        throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID', error);
      } finally {
        unsubscribeRevocation?.();
        unsubscribeRuntimeInvalidation?.();
        operationAbort.cleanup();
      }
    },
  };
};

const transportBindingMatchesInvocation = (
  binding: SurfaceAiRuntimeTransportBinding,
  invocation: SurfaceAiInvocation
): boolean =>
  sameIdentity(binding.surface, invocation.surface) &&
  binding.ownerId === invocation.runtime.ownerId &&
  binding.runtimeId === invocation.runtime.runtimeId;

/**
 * Connects the consent/Trust/Run broker to an already authenticated sandbox
 * MessagePort. This is intentionally Main-only: it has no IPC registration and
 * cannot turn a renderer or package request into an AI operation.
 */
export const createSurfaceAiOperationDispatcher = (
  deps: SurfaceAiOperationDispatcherDeps
): SurfaceAiOperationDispatcher => {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10 * 60_000) {
    throw new Error('SURFACE_AI_OPERATION_DISPATCHER_CONFIGURATION_INVALID');
  }
  const createOperationLeaseId = deps.createOperationLeaseId ?? randomUUID;

  return {
    dispatch: async (request) => {
      const { onProgress, ...brokerRequest } = request;
      return deps.broker.invoke({
        ...brokerRequest,
        invokeSurface: async (invocation) => {
          const binding = await deps.resolveRuntimeBinding(invocation.surface, invocation.runtime);
          if (
            !binding ||
            !transportBindingMatchesInvocation(binding, invocation) ||
            !deps.transportRegistry.isActive(binding)
          ) {
            throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_RUNTIME_UNAVAILABLE');
          }
          const observationStore = deps.observationStore;
          const observationIdentity: SurfaceAiObservationIdentity | undefined =
            observationStore === undefined
              ? undefined
              : {
                  accountId: invocation.accountId,
                  runId: invocation.childRunId,
                  invocationId: invocation.invocationId,
                  operationId: invocation.operation.id,
                  surface: invocation.surface,
                  artifactIntegrity: binding.artifactIntegrity,
                };
          const observationAbort = new AbortController();
          const abortObservation = (): void => observationAbort.abort(invocation.signal.reason);
          invocation.signal.addEventListener('abort', abortObservation, { once: true });
          if (invocation.signal.aborted) abortObservation();
          let observationSequence = 0;
          let observationWrites: Promise<void> = Promise.resolve();
          try {
            await observationStore?.open(observationIdentity!);
            const result = await deps.transportRegistry.invoke({
              binding,
              invocationId: invocation.invocationId,
              runId: invocation.childRunId,
              operationId: invocation.operation.id,
              operationSchemaVersion: invocation.operation.inputSchemaVersion,
              operationLeaseId: requireText(createOperationLeaseId(), 'SURFACE_AI_ACCESS_DELEGATION_INVALID'),
              input: invocation.input,
              timeoutMs,
              signal: observationStore === undefined ? invocation.signal : observationAbort.signal,
              onProgress: (progress) => {
                onProgress?.(progress);
                if (observationStore === undefined || observationIdentity === undefined) return;
                const sequence = ++observationSequence;
                observationWrites = observationWrites.then(async () => {
                  await observationStore.recordProgress(observationIdentity, {
                    sequence,
                    phase: progress.phase,
                    completed: progress.completed,
                    total: progress.total,
                  });
                });
                void observationWrites.catch(() => observationAbort.abort());
              },
            });
            await observationWrites;
            if (observationStore !== undefined && observationIdentity !== undefined) {
              const terminalObservation = await observationStore.recordResult(observationIdentity, {
                sequence: observationSequence + 1,
                artifactRefs: result.artifactRefs,
                evidenceRefs: result.evidenceRefs,
              });
              return {
                evidenceRefs: [
                  ...new Set([
                    ...result.evidenceRefs,
                    ...result.artifactRefs,
                    `surface-ai-observation:${terminalObservation.observationKey}`,
                  ]),
                ],
              };
            }
            return { evidenceRefs: [...new Set([...result.evidenceRefs, ...result.artifactRefs])] };
          } catch (caught) {
            if (observationStore !== undefined) {
              throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DELEGATION_INVALID', caught);
            }
            throw caught;
          } finally {
            invocation.signal.removeEventListener('abort', abortObservation);
          }
        },
      });
    },
  };
};
