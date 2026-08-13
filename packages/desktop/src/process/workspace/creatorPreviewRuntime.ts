/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process creator preview orchestration. Untrusted code is delegated to an
 * injected, policy-enforcing sandbox driver and is never evaluated in this module.
 */

import { randomUUID } from 'node:crypto';
import {
  LifecycleOperationCancelledError,
  LifecycleOperationDeadlineError,
  LifecycleResourceBusyError,
  type LifecycleResourceState,
} from '@process/resource/lifecycleResource';
import {
  ResourceRequestCancelledError,
  ResourceRequestDeadlineError,
  type IResourceCoordinator,
} from '@process/resource/resourceCoordinator';
import {
  assertPolicyEnforceable,
  creatorPreviewRequestFingerprint,
  CreatorPreviewPolicyError,
  DEFAULT_CREATOR_PREVIEW_LIMITS,
  normalizeCreatorPreviewOpenRequest,
  type CreatorPreviewSafetyLimits,
} from './creatorPreviewPolicy';
import type {
  CreatorPreviewCrashRequest,
  CreatorPreviewErrorCode,
  CreatorPreviewEvent,
  CreatorPreviewEventType,
  CreatorPreviewOpenRequest,
  CreatorPreviewOperation,
  CreatorPreviewOperationRequest,
  CreatorPreviewReceipt,
  CreatorPreviewReceiptStatus,
  CreatorPreviewSessionSnapshot,
  CreatorPreviewState,
  CreatorSandboxCapabilities,
  CreatorSandboxDriver,
  CreatorSandboxDriverAttestation,
  CreatorSandboxDriverHealth,
  CreatorSandboxDriverLifecycleCallbacks,
  CreatorSandboxDriverRegistration,
  CreatorSandboxDriverStatus,
  CreatorSandboxRuntimeEvent,
  CreatorSandboxStartResult,
} from './creatorPreviewTypes';

export type {
  CreatorPreviewCrashRequest,
  CreatorPreviewEvent,
  CreatorPreviewOpenRequest,
  CreatorPreviewOperationRequest,
  CreatorPreviewReceipt,
  CreatorPreviewSessionSnapshot,
  CreatorSandboxCapabilities,
  CreatorSandboxDriver,
  CreatorSandboxDriverAttestation,
  CreatorSandboxDriverHealth,
  CreatorSandboxDriverLifecycleCallbacks,
  CreatorSandboxDriverRegistration,
  CreatorSandboxDriverStatus,
} from './creatorPreviewTypes';

export class CreatorPreviewError extends Error {
  constructor(
    readonly code: CreatorPreviewErrorCode,
    readonly previewId: string,
    message: string = code
  ) {
    super(message);
    this.name = 'CreatorPreviewError';
  }
}

type CreatorPreviewCoordinator = Pick<
  IResourceCoordinator,
  | 'registerLifecycleResource'
  | 'activateLifecycleResource'
  | 'deactivateLifecycleResource'
  | 'suspendLifecycleResource'
  | 'evictLifecycleResource'
  | 'unregisterLifecycleResource'
  | 'getLifecycleSnapshot'
>;

export type CreatorPreviewRuntimeOptions = {
  coordinator: CreatorPreviewCoordinator;
  /** A trusted main-process registry. Omit it to make every preview open fail closed. */
  driverRegistry?: ICreatorSandboxDriverRegistry;
  /** Explicit registered driver id; direct driver injection is intentionally unsupported. */
  driverId?: string;
  now?: () => number;
  generateId?: () => string;
  quotaLimits?: CreatorPreviewSafetyLimits;
  maxSessions?: number;
  maxEvents?: number;
  maxReceipts?: number;
  maxIdempotencyEntries?: number;
  crashQuarantineThreshold?: number;
};

export type ICreatorPreviewRuntime = {
  open(request: CreatorPreviewOpenRequest): Promise<CreatorPreviewReceipt>;
  suspend(request: CreatorPreviewOperationRequest): Promise<CreatorPreviewReceipt>;
  captureSnapshot(request: CreatorPreviewOperationRequest): Promise<CreatorPreviewReceipt>;
  reset(request: CreatorPreviewOperationRequest): Promise<CreatorPreviewReceipt>;
  reportCrash(request: CreatorPreviewCrashRequest): Promise<CreatorPreviewReceipt>;
  remove(request: CreatorPreviewOperationRequest): Promise<CreatorPreviewReceipt>;
  getSession(previewId: string): CreatorPreviewSessionSnapshot | undefined;
  listEvents(previewId?: string): CreatorPreviewEvent[];
  listReceipts(previewId?: string): CreatorPreviewReceipt[];
  onEvent(listener: (event: CreatorPreviewEvent) => void): () => void;
  dispose(): Promise<void>;
};

type PreviewSession = CreatorPreviewSessionSnapshot & {
  resourceId: string;
  driverId: string;
  /** Driver identity bound at session creation; used only for identity checks and cleanup. */
  boundDriver: CreatorSandboxDriver;
  configFingerprint: string;
  operationRequestId: string;
  operationCorrelationId: string;
  controllers: Set<AbortController>;
};

type IdempotencyEntry<T> = {
  fingerprint: string;
  promise: Promise<T>;
  settled: boolean;
};

type OperationOutcome = {
  status?: CreatorPreviewReceiptStatus;
  code?: string;
  snapshotId?: string;
};

type EventDetails = Pick<CreatorPreviewEvent, 'origin' | 'resource'>;
type EventContext = {
  requestId?: string;
  correlationId?: string;
  details?: EventDetails;
};

const TECHNICAL_CODE_PATTERN = /^[A-Z0-9_.:-]{1,80}$/;
const TECHNICAL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const normalizeTechnicalCode = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';
const safeTechnicalCode = (value: unknown, fallback: string): string => {
  const code = normalizeTechnicalCode(value);
  return TECHNICAL_CODE_PATTERN.test(code) ? code : fallback;
};
const safeTechnicalIdentifier = (value: unknown, fallback: string): string => {
  const identifier = typeof value === 'string' ? value.trim() : '';
  return TECHNICAL_IDENTIFIER_PATTERN.test(identifier) ? identifier : fallback;
};
const requireTechnicalIdentifier = (value: unknown, field: string): string => {
  const identifier = safeTechnicalIdentifier(value, '');
  if (!identifier) throw new Error(`Sandbox driver returned an invalid ${field}.`);
  return identifier;
};
const normalizePreviewUrl = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error('Sandbox driver returned an invalid preview URL.');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Sandbox driver returned an invalid preview URL.');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Sandbox driver returned an unsafe preview URL.');
  }
  return normalized;
};
const validateStartResult = (result: unknown): CreatorSandboxStartResult => {
  if (!result || typeof result !== 'object') throw new Error('Sandbox driver omitted the readiness handshake.');
  const candidate = result as Partial<CreatorSandboxStartResult>;
  if (
    candidate.ready !== true ||
    !Number.isFinite(candidate.firstMeaningfulPaintAt) ||
    (candidate.firstMeaningfulPaintAt ?? -1) < 0
  ) {
    throw new Error('Sandbox driver did not confirm readiness and first meaningful paint.');
  }
  const previewUrl = normalizePreviewUrl(candidate.previewUrl);
  const degradedCode = candidate.degradedCode === undefined ? undefined : safeTechnicalCode(candidate.degradedCode, '');
  if (candidate.degradedCode !== undefined && !degradedCode) {
    throw new Error('Sandbox driver returned an invalid degraded reason code.');
  }
  if (!previewUrl && !degradedCode) {
    throw new Error('Sandbox driver omitted a usable preview surface.');
  }
  return {
    ready: true,
    firstMeaningfulPaintAt: candidate.firstMeaningfulPaintAt,
    previewUrl,
    degradedCode,
  };
};

type RegisteredCreatorSandboxDriver = {
  driver: CreatorSandboxDriver;
  status: CreatorSandboxDriverStatus;
  lifecycle?: CreatorSandboxDriverLifecycleCallbacks;
};

export type CreatorSandboxDriverResolution =
  | { state: 'active'; driver: CreatorSandboxDriver; status: CreatorSandboxDriverStatus }
  | { state: 'missing'; status?: CreatorSandboxDriverStatus }
  | { state: 'untrusted'; status?: CreatorSandboxDriverStatus }
  | { state: 'unhealthy'; status?: CreatorSandboxDriverStatus };

export type ICreatorSandboxDriverRegistry = {
  register(registration: CreatorSandboxDriverRegistration): () => void;
  unregister(driverId: string): boolean;
  updateHealth(driverId: string, health: CreatorSandboxDriverHealth): boolean;
  updateAttestation(driverId: string, attestation: CreatorSandboxDriverAttestation): boolean;
  getStatus(driverId: string): CreatorSandboxDriverStatus | undefined;
  resolve(driverId: string): CreatorSandboxDriverResolution;
};

export type CreatorSandboxDriverRegistryOptions = {
  now?: () => number;
  /** Healthy observations older than this are rejected until refreshed. */
  maxHealthAgeMs?: number;
};

const cloneSandboxCapabilities = (capabilities: CreatorSandboxCapabilities): CreatorSandboxCapabilities => ({
  networkIsolation: capabilities.networkIsolation,
  quotaEnforcement: capabilities.quotaEnforcement,
  snapshots: capabilities.snapshots,
});

const cloneDriverStatus = (status: CreatorSandboxDriverStatus): CreatorSandboxDriverStatus => ({
  driverId: status.driverId,
  capabilities: cloneSandboxCapabilities(status.capabilities),
  health: { ...status.health },
  attestation: { ...status.attestation },
});

const normalizeSandboxCapabilities = (value: unknown): CreatorSandboxCapabilities => {
  if (!value || typeof value !== 'object') throw new Error('Sandbox driver capabilities are required.');
  const candidate = value as Partial<CreatorSandboxCapabilities>;
  const networkIsolation = candidate.networkIsolation;
  const quotaEnforcement = candidate.quotaEnforcement;
  const snapshots = candidate.snapshots;
  if (
    (networkIsolation !== 'none' && networkIsolation !== 'blocked-only' && networkIsolation !== 'allowlist') ||
    typeof quotaEnforcement !== 'boolean' ||
    typeof snapshots !== 'boolean'
  ) {
    throw new Error('Sandbox driver capabilities are invalid.');
  }
  return { networkIsolation, quotaEnforcement, snapshots };
};

const equalSandboxCapabilities = (left: CreatorSandboxCapabilities, right: CreatorSandboxCapabilities): boolean =>
  left.networkIsolation === right.networkIsolation &&
  left.quotaEnforcement === right.quotaEnforcement &&
  left.snapshots === right.snapshots;

const normalizeDriverHealth = (value: CreatorSandboxDriverHealth): CreatorSandboxDriverHealth => {
  if (!value || typeof value !== 'object') throw new Error('Sandbox driver health is required.');
  const candidate = value as Partial<CreatorSandboxDriverHealth>;
  const state = candidate.state;
  const observedAt = candidate.observedAt;
  const code = safeTechnicalCode(candidate.code, '');
  if (
    (state !== 'healthy' && state !== 'degraded' && state !== 'unhealthy') ||
    typeof observedAt !== 'number' ||
    !Number.isFinite(observedAt) ||
    observedAt < 0 ||
    !code
  ) {
    throw new Error('Sandbox driver health is invalid.');
  }
  return { state, observedAt, code };
};

const normalizeDriverAttestation = (value: CreatorSandboxDriverAttestation): CreatorSandboxDriverAttestation => {
  if (!value || typeof value !== 'object') throw new Error('Sandbox driver attestation is required.');
  const candidate = value as Partial<CreatorSandboxDriverAttestation>;
  const state = candidate.state;
  const attestedAt = candidate.attestedAt;
  const expiresAt = candidate.expiresAt;
  const reference = safeTechnicalIdentifier(candidate.reference, '');
  if (
    (state !== 'accepted' && state !== 'unverified' && state !== 'revoked' && state !== 'expired') ||
    typeof attestedAt !== 'number' ||
    !Number.isFinite(attestedAt) ||
    attestedAt < 0 ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt < attestedAt)) ||
    !reference
  ) {
    throw new Error('Sandbox driver attestation is invalid.');
  }
  return { state, attestedAt, expiresAt, reference };
};

const normalizeDriverLifecycle = (
  lifecycle: CreatorSandboxDriverLifecycleCallbacks | undefined
): CreatorSandboxDriverLifecycleCallbacks | undefined => {
  if (lifecycle === undefined) return undefined;
  if (!lifecycle || typeof lifecycle !== 'object') throw new Error('Sandbox driver lifecycle callbacks are invalid.');
  const callbacks = [
    lifecycle.onRegistered,
    lifecycle.onHealthChanged,
    lifecycle.onAttestationChanged,
    lifecycle.onUnregistered,
  ];
  if (callbacks.some((callback) => callback !== undefined && typeof callback !== 'function')) {
    throw new Error('Sandbox driver lifecycle callback is invalid.');
  }
  return {
    onRegistered: lifecycle.onRegistered,
    onHealthChanged: lifecycle.onHealthChanged,
    onAttestationChanged: lifecycle.onAttestationChanged,
    onUnregistered: lifecycle.onUnregistered,
  };
};

const assertSandboxDriverContract = (driver: CreatorSandboxDriver): void => {
  if (!driver || typeof driver !== 'object') throw new Error('Sandbox driver is required.');
  if (
    typeof driver.create !== 'function' ||
    typeof driver.start !== 'function' ||
    typeof driver.suspend !== 'function' ||
    typeof driver.destroy !== 'function' ||
    typeof driver.reset !== 'function' ||
    (driver.snapshot !== undefined && typeof driver.snapshot !== 'function')
  ) {
    throw new Error('Sandbox driver lifecycle contract is incomplete.');
  }
};

const notifyDriverLifecycle = (
  lifecycle: CreatorSandboxDriverLifecycleCallbacks | undefined,
  callbackName: keyof CreatorSandboxDriverLifecycleCallbacks,
  status: CreatorSandboxDriverStatus
): void => {
  const callback = lifecycle?.[callbackName];
  if (!callback) return;
  try {
    callback(cloneDriverStatus(status));
  } catch {
    console.warn('[CreatorPreview] Sandbox driver lifecycle callback threw.');
  }
};

/**
 * Keeps explicit, main-process-owned driver registrations. It does not create a sandbox,
 * validate cryptographic evidence, or provide OS isolation; it only gates future driver calls.
 */
export const createCreatorSandboxDriverRegistry = (
  options: CreatorSandboxDriverRegistryOptions = {}
): ICreatorSandboxDriverRegistry => {
  const now = options.now ?? (() => Date.now());
  const maxHealthAgeMs = options.maxHealthAgeMs ?? 30_000;
  if (!Number.isFinite(maxHealthAgeMs) || maxHealthAgeMs <= 0) {
    throw new RangeError('Sandbox driver maxHealthAgeMs must be finite and positive.');
  }
  const entries = new Map<string, RegisteredCreatorSandboxDriver>();

  const unregister = (driverId: string): boolean => {
    const normalizedDriverId = safeTechnicalIdentifier(driverId, '');
    const entry = normalizedDriverId ? entries.get(normalizedDriverId) : undefined;
    if (!entry) return false;
    entries.delete(normalizedDriverId);
    notifyDriverLifecycle(entry.lifecycle, 'onUnregistered', entry.status);
    return true;
  };

  return {
    register: (registration) => {
      if (!registration || typeof registration !== 'object')
        throw new Error('Sandbox driver registration is required.');
      const driverId = requireTechnicalIdentifier(registration.driverId, 'driver id');
      if (entries.has(driverId)) throw new Error(`Sandbox driver ${driverId} is already registered.`);
      assertSandboxDriverContract(registration.driver);
      const capabilityDeclaration = normalizeSandboxCapabilities(registration.capabilityDeclaration);
      const driverCapabilities = normalizeSandboxCapabilities(registration.driver.capabilities);
      if (!equalSandboxCapabilities(capabilityDeclaration, driverCapabilities)) {
        throw new Error('Sandbox driver capability declaration does not match the driver contract.');
      }
      const entry: RegisteredCreatorSandboxDriver = {
        driver: registration.driver,
        status: {
          driverId,
          capabilities: capabilityDeclaration,
          health: normalizeDriverHealth(registration.health),
          attestation: normalizeDriverAttestation(registration.attestation),
        },
        lifecycle: normalizeDriverLifecycle(registration.lifecycle),
      };
      entries.set(driverId, entry);
      notifyDriverLifecycle(entry.lifecycle, 'onRegistered', entry.status);
      return () => {
        if (entries.get(driverId) === entry) unregister(driverId);
      };
    },
    unregister,
    updateHealth: (driverId, health) => {
      const normalizedDriverId = safeTechnicalIdentifier(driverId, '');
      const entry = normalizedDriverId ? entries.get(normalizedDriverId) : undefined;
      if (!entry) return false;
      entry.status = { ...entry.status, health: normalizeDriverHealth(health) };
      notifyDriverLifecycle(entry.lifecycle, 'onHealthChanged', entry.status);
      return true;
    },
    updateAttestation: (driverId, attestation) => {
      const normalizedDriverId = safeTechnicalIdentifier(driverId, '');
      const entry = normalizedDriverId ? entries.get(normalizedDriverId) : undefined;
      if (!entry) return false;
      entry.status = { ...entry.status, attestation: normalizeDriverAttestation(attestation) };
      notifyDriverLifecycle(entry.lifecycle, 'onAttestationChanged', entry.status);
      return true;
    },
    getStatus: (driverId) => {
      const normalizedDriverId = safeTechnicalIdentifier(driverId, '');
      const entry = normalizedDriverId ? entries.get(normalizedDriverId) : undefined;
      return entry ? cloneDriverStatus(entry.status) : undefined;
    },
    resolve: (driverId) => {
      const normalizedDriverId = safeTechnicalIdentifier(driverId, '');
      const entry = normalizedDriverId ? entries.get(normalizedDriverId) : undefined;
      if (!entry) return { state: 'missing' };
      const status = cloneDriverStatus(entry.status);
      const observedAt = now();
      const attestationFromFuture = status.attestation.attestedAt > observedAt;
      const expiredByClock = status.attestation.expiresAt !== undefined && status.attestation.expiresAt <= observedAt;
      if (status.attestation.state !== 'accepted' || attestationFromFuture || expiredByClock) {
        return { state: 'untrusted', status };
      }
      const healthFromFuture = status.health.observedAt > observedAt;
      const healthStale = observedAt - status.health.observedAt > maxHealthAgeMs;
      if (status.health.state !== 'healthy' || healthFromFuture || healthStale) {
        return { state: 'unhealthy', status };
      }
      return { state: 'active', driver: entry.driver, status };
    },
  };
};
const lifecycleState = (state: LifecycleResourceState): CreatorPreviewState =>
  state === 'prewarming' ? 'preloading' : state;

const clonePolicy = (session: PreviewSession): CreatorPreviewSessionSnapshot['policy'] => ({
  quota: { ...session.policy.quota },
  network: { ...session.policy.network, allowedOrigins: [...session.policy.network.allowedOrigins] },
  requestedCapabilities: [...session.policy.requestedCapabilities],
  grantedCapabilities: [...session.policy.grantedCapabilities],
});

const cloneSession = (session: PreviewSession): CreatorPreviewSessionSnapshot => ({
  previewId: session.previewId,
  projectId: session.projectId,
  correlationId: session.correlationId,
  workspaceRoot: session.workspaceRoot,
  entrypoint: session.entrypoint,
  policy: clonePolicy(session),
  state: session.state,
  sandboxId: session.sandboxId,
  previewUrl: session.previewUrl,
  lastSnapshotId: session.lastSnapshotId,
  degradedCode: session.degradedCode,
  lastErrorCode: session.lastErrorCode,
  crashCount: session.crashCount,
  transitionSequence: session.transitionSequence,
});

const requestFingerprint = (operation: CreatorPreviewOperation, request: CreatorPreviewOperationRequest): string =>
  JSON.stringify({
    operation,
    previewId: request.previewId,
    correlationId: request.correlationId ?? request.requestId,
  });

const createSignalScope = (
  session: PreviewSession,
  external?: AbortSignal
): { signal: AbortSignal; release: () => void } => {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener('abort', forwardAbort, { once: true });
  session.controllers.add(controller);
  return {
    signal: controller.signal,
    release: () => {
      external?.removeEventListener('abort', forwardAbort);
      session.controllers.delete(controller);
    },
  };
};

/** Create an isolated preview lifecycle service backed by the single ResourceCoordinator. */
export const createCreatorPreviewRuntime = (options: CreatorPreviewRuntimeOptions): ICreatorPreviewRuntime => {
  const now = options.now ?? (() => Date.now());
  const generateId = options.generateId ?? (() => randomUUID());
  const quotaLimits = options.quotaLimits ?? DEFAULT_CREATOR_PREVIEW_LIMITS;
  const maxSessions = Math.max(1, Math.floor(options.maxSessions ?? 8));
  const maxEvents = Math.max(1, Math.floor(options.maxEvents ?? 500));
  const maxReceipts = Math.max(1, Math.floor(options.maxReceipts ?? 500));
  const maxIdempotencyEntries = Math.max(1, Math.floor(options.maxIdempotencyEntries ?? 256));
  const crashQuarantineThreshold = Math.max(1, Math.floor(options.crashQuarantineThreshold ?? 3));
  const sessions = new Map<string, PreviewSession>();
  const idempotency = new Map<string, IdempotencyEntry<CreatorPreviewReceipt>>();
  const events: CreatorPreviewEvent[] = [];
  const receipts: CreatorPreviewReceipt[] = [];
  const listeners = new Set<(event: CreatorPreviewEvent) => void>();
  const inFlight = new Set<Promise<CreatorPreviewReceipt>>();
  const destroyInFlight = new Map<string, Promise<void>>();
  let eventSequence = 0;
  let disposed = false;
  let disposeWork: Promise<void> | undefined;

  const assertUsable = (): void => {
    if (disposed) throw new CreatorPreviewError('PREVIEW_BUSY', 'runtime', 'Creator preview runtime is disposed.');
  };

  const requireRegisteredDriver = (
    previewId: string,
    driverId: string | undefined = options.driverId
  ): Extract<CreatorSandboxDriverResolution, { state: 'active' }> => {
    const resolution = driverId ? options.driverRegistry?.resolve(driverId) : undefined;
    if (!resolution || resolution.state === 'missing') {
      throw new CreatorPreviewError('SANDBOX_DRIVER_UNAVAILABLE', previewId);
    }
    if (resolution.state === 'untrusted') {
      throw new CreatorPreviewError('SANDBOX_DRIVER_UNTRUSTED', previewId);
    }
    if (resolution.state === 'unhealthy') {
      throw new CreatorPreviewError('SANDBOX_DRIVER_UNHEALTHY', previewId);
    }
    return resolution;
  };

  const requireSessionDriver = (
    session: PreviewSession
  ): Extract<CreatorSandboxDriverResolution, { state: 'active' }> => {
    const resolution = requireRegisteredDriver(session.previewId, session.driverId);
    if (resolution.driver !== session.boundDriver) {
      throw new CreatorPreviewError(
        'SANDBOX_DRIVER_UNTRUSTED',
        session.previewId,
        'The sandbox driver registration changed during the preview session.'
      );
    }
    return resolution;
  };

  const destroySandbox = async (session: PreviewSession, sandboxId: string): Promise<void> => {
    const existing = destroyInFlight.get(sandboxId);
    if (existing) return existing;
    // Cleanup must remain possible after health degradation, attestation revocation, or unregister.
    const work = Promise.resolve().then(() => session.boundDriver.destroy({ sandboxId }));
    destroyInFlight.set(sandboxId, work);
    try {
      await work;
    } finally {
      if (destroyInFlight.get(sandboxId) === work) destroyInFlight.delete(sandboxId);
    }
  };

  const destroyAndClearSandbox = async (session: PreviewSession, sandboxId: string): Promise<void> => {
    await destroySandbox(session, sandboxId);
    if (session.sandboxId !== sandboxId) return;
    session.sandboxId = undefined;
    session.previewUrl = undefined;
    session.degradedCode = undefined;
  };

  const emit = (
    session: PreviewSession,
    type: CreatorPreviewEventType,
    code: string,
    context: EventContext = {}
  ): void => {
    const event: CreatorPreviewEvent = {
      eventId: generateId(),
      sequence: ++eventSequence,
      at: now(),
      type,
      requestId: safeTechnicalIdentifier(context.requestId ?? session.operationRequestId, 'runtime'),
      previewId: session.previewId,
      projectId: session.projectId,
      correlationId: safeTechnicalIdentifier(context.correlationId ?? session.operationCorrelationId, 'runtime'),
      state: session.state,
      code: safeTechnicalCode(code, 'EVENT_CODE_REDACTED'),
      ...context.details,
    };
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    for (const listener of listeners) {
      try {
        listener({ ...event });
      } catch {
        console.warn('[CreatorPreview] Event listener threw.');
      }
    }
  };

  const handleSandboxEvent = (session: PreviewSession, event: CreatorSandboxRuntimeEvent): void => {
    if (disposed || sessions.get(session.previewId) !== session) return;
    const code = safeTechnicalCode(event.code, '');
    if (!code) return;
    if (event.type === 'quota-warning') {
      emit(session, event.type, code, { details: { resource: event.resource } });
      return;
    }
    try {
      const parsed = new URL(event.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      emit(session, event.type, code, { details: { origin: parsed.origin } });
    } catch {
      // Drop malformed driver metadata instead of forwarding raw values.
    }
  };

  const setState = (session: PreviewSession, state: CreatorPreviewState, code: string): void => {
    if (session.state === state) return;
    session.state = state;
    session.transitionSequence += 1;
    emit(session, 'state-transition', code);
  };

  const recordReceipt = (
    session: PreviewSession,
    request: CreatorPreviewOperationRequest,
    operation: CreatorPreviewOperation,
    from: CreatorPreviewState,
    startedAt: number,
    outcome: OperationOutcome = {}
  ): CreatorPreviewReceipt => {
    const finishedAt = now();
    const snapshotId = outcome.snapshotId ? safeTechnicalIdentifier(outcome.snapshotId, '') : undefined;
    const receipt: CreatorPreviewReceipt = {
      receiptId: generateId(),
      requestId: request.requestId,
      correlationId: request.correlationId ?? request.requestId,
      previewId: session.previewId,
      projectId: session.projectId,
      operation,
      status: outcome.status ?? 'succeeded',
      from,
      to: session.state,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      code: safeTechnicalCode(outcome.code ?? 'OK', 'RECEIPT_CODE_REDACTED'),
      snapshotId: snapshotId || undefined,
    };
    receipts.push(receipt);
    if (receipts.length > maxReceipts) receipts.splice(0, receipts.length - maxReceipts);
    emit(session, 'receipt', receipt.code, {
      requestId: receipt.requestId,
      correlationId: receipt.correlationId,
    });
    return { ...receipt };
  };

  const requireOperationRequest = (request: CreatorPreviewOperationRequest): CreatorPreviewOperationRequest => {
    const previewId = safeTechnicalIdentifier(request.previewId, '');
    const requestId = safeTechnicalIdentifier(request.requestId, '');
    const correlationId = safeTechnicalIdentifier(request.correlationId ?? requestId, '');
    if (!previewId || !requestId || !correlationId) {
      throw new CreatorPreviewError(
        'INVALID_PREVIEW_REQUEST',
        previewId,
        'Operation ids must be bounded technical identifiers.'
      );
    }
    return { ...request, previewId, requestId, correlationId };
  };

  const requireSession = (previewId: string): PreviewSession => {
    const session = sessions.get(previewId);
    if (!session) throw new CreatorPreviewError('SESSION_NOT_FOUND', previewId);
    return session;
  };

  const toError = (error: unknown, previewId: string): CreatorPreviewError => {
    if (error instanceof CreatorPreviewError) return error;
    if (error instanceof CreatorPreviewPolicyError) {
      return new CreatorPreviewError(
        error.kind === 'unenforceable' ? 'POLICY_UNENFORCEABLE' : 'INVALID_PREVIEW_REQUEST',
        previewId,
        error.message
      );
    }
    if (error instanceof ResourceRequestCancelledError || error instanceof LifecycleOperationCancelledError) {
      return new CreatorPreviewError('PREVIEW_CANCELLED', previewId);
    }
    if (error instanceof ResourceRequestDeadlineError || error instanceof LifecycleOperationDeadlineError) {
      return new CreatorPreviewError('PREVIEW_DEADLINE', previewId);
    }
    if (error instanceof LifecycleResourceBusyError) return new CreatorPreviewError('PREVIEW_BUSY', previewId);
    return new CreatorPreviewError('SANDBOX_DRIVER_FAILURE', previewId);
  };

  const idempotent = <T extends CreatorPreviewReceipt>(
    requestId: string,
    fingerprint: string,
    previewId: string,
    work: () => Promise<T>
  ): Promise<T> => {
    const cached = idempotency.get(requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        return Promise.reject(new CreatorPreviewError('IDEMPOTENCY_CONFLICT', previewId));
      }
      return cached.promise as Promise<T>;
    }
    if (idempotency.size >= maxIdempotencyEntries) {
      const settled = [...idempotency].find(([, entry]) => entry.settled);
      if (!settled) return Promise.reject(new CreatorPreviewError('IDEMPOTENCY_CAPACITY', previewId));
      idempotency.delete(settled[0]);
    }
    const entry: IdempotencyEntry<T> = { fingerprint, promise: Promise.resolve().then(work), settled: false };
    idempotency.set(requestId, entry as IdempotencyEntry<CreatorPreviewReceipt>);
    inFlight.add(entry.promise);
    void entry.promise.then(
      () => {
        entry.settled = true;
        inFlight.delete(entry.promise);
      },
      () => {
        entry.settled = true;
        inFlight.delete(entry.promise);
      }
    );
    return entry.promise;
  };

  const syncLifecycleState = (session: PreviewSession): void => {
    const entry = options.coordinator
      .getLifecycleSnapshot()
      .entries.find((candidate) => candidate.id === session.resourceId);
    if (entry) setState(session, lifecycleState(entry.state), `LIFECYCLE_${entry.state.toUpperCase()}`);
  };

  const ensureNotAborted = (signal: AbortSignal, previewId: string): void => {
    if (signal.aborted) throw new CreatorPreviewError('PREVIEW_CANCELLED', previewId);
  };

  const ensureSession = (
    request: CreatorPreviewOpenRequest,
    registration: Extract<CreatorSandboxDriverResolution, { state: 'active' }>
  ): PreviewSession => {
    const driverId = registration.status.driverId;
    const configFingerprint = JSON.stringify({
      driverId,
      projectId: request.projectId,
      workspaceRoot: request.workspaceRoot,
      entrypoint: request.entrypoint,
      policy: request.policy,
    });
    const existing = sessions.get(request.previewId);
    if (existing) {
      if (existing.configFingerprint !== configFingerprint) {
        throw new CreatorPreviewError(
          'INVALID_PREVIEW_REQUEST',
          request.previewId,
          'Preview configuration is immutable.'
        );
      }
      if (existing.boundDriver !== registration.driver) {
        throw new CreatorPreviewError(
          'SANDBOX_DRIVER_UNTRUSTED',
          request.previewId,
          'The sandbox driver registration changed during the preview session.'
        );
      }
      return existing;
    }
    if (sessions.size >= maxSessions) throw new CreatorPreviewError('PREVIEW_BUSY', request.previewId);
    const resourceId = `creator-preview:${request.previewId}`;
    const session: PreviewSession = {
      previewId: request.previewId,
      projectId: request.projectId,
      correlationId: request.correlationId ?? request.requestId,
      operationRequestId: request.requestId,
      operationCorrelationId: request.correlationId ?? request.requestId,
      workspaceRoot: request.workspaceRoot,
      entrypoint: request.entrypoint,
      policy: request.policy,
      state: 'cold',
      crashCount: 0,
      transitionSequence: 0,
      resourceId,
      driverId,
      boundDriver: registration.driver,
      configFingerprint,
      controllers: new Set(),
    };
    sessions.set(session.previewId, session);
    try {
      options.coordinator.registerLifecycleResource({
        id: resourceId,
        kind: 'package',
        taskKind: 'patchBuild',
        estCostMB: request.policy.quota.ramMiB,
        prewarm: async (signal) => {
          setState(session, 'preloading', 'SANDBOX_PRELOADING');
          if (!session.sandboxId) {
            const driver = requireSessionDriver(session).driver;
            const handle = await driver.create({
              previewId: session.previewId,
              projectId: session.projectId,
              workspaceRoot: session.workspaceRoot,
              entrypoint: session.entrypoint,
              policy: clonePolicy(session),
              signal,
              onEvent: (event) => handleSandboxEvent(session, event),
            });
            const sandboxId = requireTechnicalIdentifier(handle.sandboxId, 'sandbox id');
            if (signal.aborted) {
              await destroySandbox(session, sandboxId).catch((): undefined => undefined);
              throw new CreatorPreviewError('PREVIEW_CANCELLED', session.previewId);
            }
            session.sandboxId = sandboxId;
          }
          setState(session, 'warm', 'SANDBOX_WARM');
        },
        activate: async (signal) => {
          ensureNotAborted(signal, session.previewId);
          if (!session.sandboxId) throw new Error('Sandbox is missing after preloading.');
          const driver = requireSessionDriver(session).driver;
          const result = validateStartResult(await driver.start({ sandboxId: session.sandboxId, signal }));
          ensureNotAborted(signal, session.previewId);
          session.previewUrl = result.previewUrl;
          session.degradedCode = result.degradedCode;
        },
        suspend: async () => {
          if (session.sandboxId) await requireSessionDriver(session).driver.suspend({ sandboxId: session.sandboxId });
          setState(session, 'suspended', 'SANDBOX_SUSPENDED');
        },
        evict: async () => {
          const sandboxId = session.sandboxId;
          if (sandboxId) await destroyAndClearSandbox(session, sandboxId);
          setState(session, 'evicted', 'SANDBOX_EVICTED');
        },
      });
      emit(session, 'policy-applied', 'POLICY_ENFORCED');
      return session;
    } catch (error) {
      sessions.delete(session.previewId);
      throw error;
    }
  };

  const open: ICreatorPreviewRuntime['open'] = (input) =>
    Promise.resolve().then(() => {
      assertUsable();
      const prepared = (() => {
        try {
          const request = normalizeCreatorPreviewOpenRequest(input, quotaLimits);
          const driver = requireRegisteredDriver(request.previewId);
          assertPolicyEnforceable(request.policy, driver.status.capabilities);
          return { request, driver };
        } catch (error) {
          throw toError(error, input.previewId);
        }
      })();
      return idempotent(
        prepared.request.requestId,
        creatorPreviewRequestFingerprint(prepared.request),
        prepared.request.previewId,
        async () => {
          assertUsable();
          const request = prepared.request;
          const session = ensureSession(request, prepared.driver);
          if (session.state === 'quarantined') throw new CreatorPreviewError('PREVIEW_QUARANTINED', session.previewId);
          const signalScope = createSignalScope(session, request.signal);
          session.operationRequestId = request.requestId;
          session.operationCorrelationId = request.correlationId ?? request.requestId;
          const startedAt = now();
          const from = session.state;
          try {
            await options.coordinator.activateLifecycleResource(session.resourceId, {
              signal: signalScope.signal,
              deadlineAt: request.deadlineAt,
            });
            setState(session, 'active', 'PREVIEW_READY');
            session.lastErrorCode = undefined;
            if (session.degradedCode) emit(session, 'degraded', session.degradedCode);
            return recordReceipt(session, request, 'open', from, startedAt, {
              status: session.degradedCode ? 'degraded' : 'succeeded',
              code: session.degradedCode ?? 'PREVIEW_READY',
            });
          } catch (error) {
            const mapped = toError(error, session.previewId);
            if (mapped.code === 'PREVIEW_CANCELLED' || mapped.code === 'PREVIEW_DEADLINE') syncLifecycleState(session);
            else {
              session.lastErrorCode = mapped.code;
              const cleanupUnconfirmed = session.sandboxId !== undefined;
              setState(session, cleanupUnconfirmed ? 'quarantined' : 'failed', mapped.code);
              if (cleanupUnconfirmed) emit(session, 'quarantined', 'CONTAINMENT_UNCONFIRMED');
            }
            recordReceipt(session, request, 'open', from, startedAt, {
              status: mapped.code === 'PREVIEW_CANCELLED' ? 'cancelled' : 'failed',
              code: mapped.code,
            });
            throw mapped;
          } finally {
            signalScope.release();
          }
        }
      );
    });

  const runOperation = (
    operation: CreatorPreviewOperation,
    input: CreatorPreviewOperationRequest,
    work: (
      session: PreviewSession,
      request: CreatorPreviewOperationRequest & { signal: AbortSignal }
    ) => Promise<OperationOutcome>,
    fingerprintExtra?: string,
    requiresActiveDriver = true
  ): Promise<CreatorPreviewReceipt> =>
    Promise.resolve().then(() => {
      assertUsable();
      const request = requireOperationRequest(input);
      const fingerprint = `${requestFingerprint(operation, request)}:${fingerprintExtra ?? ''}`;
      return idempotent(request.requestId, fingerprint, request.previewId, async () => {
        assertUsable();
        const session = requireSession(request.previewId);
        if (requiresActiveDriver) requireSessionDriver(session);
        const signalScope = createSignalScope(session, request.signal);
        const scopedRequest = { ...request, signal: signalScope.signal };
        session.operationRequestId = request.requestId;
        session.operationCorrelationId = request.correlationId ?? request.requestId;
        const startedAt = now();
        const from = session.state;
        try {
          ensureNotAborted(signalScope.signal, session.previewId);
          const outcome = await work(session, scopedRequest);
          return recordReceipt(session, scopedRequest, operation, from, startedAt, outcome);
        } catch (error) {
          const mapped = toError(error, session.previewId);
          recordReceipt(session, scopedRequest, operation, from, startedAt, {
            status: mapped.code === 'PREVIEW_CANCELLED' ? 'cancelled' : 'failed',
            code: mapped.code,
          });
          throw mapped;
        } finally {
          signalScope.release();
        }
      });
    });

  const suspend: ICreatorPreviewRuntime['suspend'] = (request) =>
    runOperation('suspend', request, async (session) => {
      if (session.state === 'active') await options.coordinator.deactivateLifecycleResource(session.resourceId);
      await options.coordinator.suspendLifecycleResource(session.resourceId);
      syncLifecycleState(session);
      return { code: 'PREVIEW_SUSPENDED' };
    });

  const captureSnapshot: ICreatorPreviewRuntime['captureSnapshot'] = (request) =>
    runOperation('snapshot', request, async (session, scopedRequest) => {
      if (!session.sandboxId) throw new CreatorPreviewError('SESSION_NOT_FOUND', session.previewId);
      const driver = requireSessionDriver(session);
      if (!driver.status.capabilities.snapshots || !driver.driver.snapshot) {
        session.degradedCode = 'SNAPSHOT_UNSUPPORTED';
        emit(session, 'degraded', session.degradedCode);
        return { status: 'degraded', code: session.degradedCode };
      }
      const signal = scopedRequest.signal;
      const result = await driver.driver.snapshot({ sandboxId: session.sandboxId, signal });
      ensureNotAborted(signal, session.previewId);
      const snapshotId = requireTechnicalIdentifier(result.snapshotId, 'snapshot id');
      session.lastSnapshotId = snapshotId;
      return { code: 'SNAPSHOT_CAPTURED', snapshotId };
    });

  const reset: ICreatorPreviewRuntime['reset'] = (request) =>
    runOperation('reset', request, async (session, scopedRequest) => {
      if (!session.sandboxId) throw new CreatorPreviewError('SESSION_NOT_FOUND', session.previewId);
      const driver = requireSessionDriver(session).driver;
      const wasActive = session.state === 'active';
      if (wasActive) await options.coordinator.deactivateLifecycleResource(session.resourceId);
      await options.coordinator.suspendLifecycleResource(session.resourceId);
      const signal = scopedRequest.signal;
      await driver.reset({ sandboxId: session.sandboxId, snapshotId: session.lastSnapshotId, signal });
      ensureNotAborted(signal, session.previewId);
      if (wasActive) {
        await options.coordinator.activateLifecycleResource(session.resourceId, { signal });
        setState(session, 'active', 'PREVIEW_RESET_READY');
      } else syncLifecycleState(session);
      return { code: session.lastSnapshotId ? 'SNAPSHOT_RESTORED' : 'PREVIEW_RESET' };
    });

  const reportCrash: ICreatorPreviewRuntime['reportCrash'] = (input) => {
    const code = normalizeTechnicalCode(input.code);
    if (!TECHNICAL_CODE_PATTERN.test(code)) {
      return Promise.reject(
        new CreatorPreviewError(
          'INVALID_PREVIEW_REQUEST',
          input.previewId,
          'Crash code must be a stable technical code.'
        )
      );
    }
    return runOperation(
      'crash',
      input,
      async (session, request) => {
        const sandboxId = session.sandboxId;
        if (session.state === 'active') {
          await options.coordinator.deactivateLifecycleResource(session.resourceId).catch((): undefined => undefined);
        }
        await options.coordinator.evictLifecycleResource(session.resourceId).catch(async () => {
          if (sandboxId) await destroyAndClearSandbox(session, sandboxId).catch((): undefined => undefined);
          await options.coordinator.suspendLifecycleResource(session.resourceId).catch((): undefined => undefined);
        });
        const lifecycleEntry = options.coordinator
          .getLifecycleSnapshot()
          .entries.find((entry) => entry.id === session.resourceId);
        const lifecycleNotEvicted = lifecycleEntry !== undefined && lifecycleEntry.state !== 'evicted';
        const containmentUnconfirmed = session.sandboxId !== undefined || lifecycleNotEvicted;
        session.crashCount += 1;
        session.lastErrorCode = code;
        const quarantined = containmentUnconfirmed || session.crashCount >= crashQuarantineThreshold;
        setState(session, quarantined ? 'quarantined' : 'failed', code);
        emit(session, 'crash-contained', code, {
          requestId: request.requestId,
          correlationId: request.correlationId,
        });
        if (quarantined) {
          emit(session, 'quarantined', containmentUnconfirmed ? 'CONTAINMENT_UNCONFIRMED' : 'CRASH_THRESHOLD_REACHED', {
            requestId: request.requestId,
            correlationId: request.correlationId,
          });
        }
        return { status: 'failed', code };
      },
      code,
      false
    );
  };

  const remove: ICreatorPreviewRuntime['remove'] = (request) =>
    runOperation(
      'remove',
      request,
      async (session) => {
        let cleanupFailure: unknown;
        const lifecycleEntry = options.coordinator
          .getLifecycleSnapshot()
          .entries.find((entry) => entry.id === session.resourceId);
        if (lifecycleEntry?.state === 'active') {
          await options.coordinator.deactivateLifecycleResource(session.resourceId).catch((error) => {
            cleanupFailure = error;
          });
        }
        await options.coordinator.evictLifecycleResource(session.resourceId).catch((error) => {
          cleanupFailure ??= error;
        });
        if (session.sandboxId) {
          await destroyAndClearSandbox(session, session.sandboxId).catch((error) => {
            cleanupFailure ??= error;
          });
        }
        if (!session.sandboxId) {
          await options.coordinator.unregisterLifecycleResource(session.resourceId).catch((error) => {
            cleanupFailure ??= error;
          });
        }
        const resourceStillRegistered = options.coordinator
          .getLifecycleSnapshot()
          .entries.some((entry) => entry.id === session.resourceId);
        if (session.sandboxId || resourceStillRegistered) {
          session.lastErrorCode = 'SANDBOX_DRIVER_FAILURE';
          setState(session, 'quarantined', 'SANDBOX_DRIVER_FAILURE');
          emit(session, 'quarantined', 'CONTAINMENT_UNCONFIRMED');
          throw cleanupFailure ?? new Error('Creator preview cleanup could not be confirmed.');
        }
        setState(session, 'evicted', 'PREVIEW_REMOVED');
        sessions.delete(session.previewId);
        return { code: 'PREVIEW_REMOVED' };
      },
      undefined,
      false
    );

  const dispose = (): Promise<void> => {
    if (disposeWork) return disposeWork;
    disposed = true;
    listeners.clear();
    for (const session of sessions.values()) {
      for (const controller of session.controllers) controller.abort();
    }
    disposeWork = (async () => {
      await Promise.allSettled(inFlight);
      await Promise.all(
        [...sessions.values()].map(async (session) => {
          const lifecycleEntry = options.coordinator
            .getLifecycleSnapshot()
            .entries.find((entry) => entry.id === session.resourceId);
          if (lifecycleEntry?.state === 'active') {
            await options.coordinator.deactivateLifecycleResource(session.resourceId).catch(() => {
              console.warn('[CreatorPreview] Sandbox deactivation failed during disposal.');
            });
          }
          if (lifecycleEntry) {
            await options.coordinator.evictLifecycleResource(session.resourceId).catch(() => {
              console.warn('[CreatorPreview] Sandbox eviction failed during disposal.');
            });
          }
          if (session.sandboxId) {
            await destroyAndClearSandbox(session, session.sandboxId).catch(() => {
              console.warn('[CreatorPreview] Direct sandbox cleanup failed during disposal.');
            });
          }
          const resourceStillRegistered = options.coordinator
            .getLifecycleSnapshot()
            .entries.some((entry) => entry.id === session.resourceId);
          if (resourceStillRegistered) {
            await options.coordinator.unregisterLifecycleResource(session.resourceId).catch(() => {
              console.warn('[CreatorPreview] Sandbox unregister failed during disposal.');
            });
          }
        })
      );
      sessions.clear();
      idempotency.clear();
      inFlight.clear();
    })();
    return disposeWork;
  };

  return {
    open,
    suspend,
    captureSnapshot,
    reset,
    reportCrash,
    remove,
    getSession: (previewId) => {
      const session = sessions.get(previewId);
      return session ? cloneSession(session) : undefined;
    },
    listEvents: (previewId) =>
      events.filter((event) => !previewId || event.previewId === previewId).map((event) => Object.assign({}, event)),
    listReceipts: (previewId) =>
      receipts
        .filter((receipt) => !previewId || receipt.previewId === previewId)
        .map((receipt) => Object.assign({}, receipt)),
    onEvent: (listener) => {
      assertUsable();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose,
  };
};
