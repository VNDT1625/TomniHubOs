import type { PackageIdentity } from '@/common/packages';

const TRANSPORT_SCHEMA_VERSION = 1 as const;

/** Maximum serialized size for either direction of this narrowly scoped transport. */
export const MAX_SURFACE_AI_TRANSPORT_ENVELOPE_BYTES = 16 * 1024;

const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REFERENCE_COUNT = 64;
const MAX_OPERATION_INSTRUCTION_BYTES = 12 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:@/-]+$/;
/** Matches the canonical signed Store artifact identity; never normalize it at this boundary. */
const SHA256_INTEGRITY = /^sha256-[a-f0-9]{64}$/;

export type SurfaceAiRuntimeTransportBinding = Readonly<{
  surface: PackageIdentity;
  ownerId: string;
  runtimeId: string;
  moduleId: string;
  artifactIntegrity: string;
}>;

/**
 * A deliberately small MessagePort-like endpoint. The production Electron bridge
 * must authenticate endpoint delivery before it can supply this abstraction.
 */
export type SurfaceAiRuntimeTransportEndpoint = Readonly<{
  postMessage: (message: unknown) => void;
  close: () => void;
  onMessage: (listener: (message: unknown) => void) => () => void;
  onClose: (listener: () => void) => () => void;
}>;

export type SurfaceAiRuntimeTransportInvocation = Readonly<{
  binding: SurfaceAiRuntimeTransportBinding;
  invocationId: string;
  runId: string;
  operationId: string;
  operationSchemaVersion: 1;
  /** Opaque Main-issued lease only; raw secrets and private context are forbidden. */
  operationLeaseId: string;
  /**
   * The only C4 v1 operation input. Main derives it after Trust inspection;
   * package runtimes receive neither a renderer payload nor unconstrained model
   * output. Later schema versions require a signed manifest update and consent.
   */
  input: Readonly<{ schemaVersion: 1; instruction: string }>;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: SurfaceAiRuntimeTransportProgress) => void;
}>;

export type SurfaceAiRuntimeTransportProgress = Readonly<{
  invocationId: string;
  runId: string;
  phase: string;
  completed: number;
  total: number;
}>;

export type SurfaceAiRuntimeTransportResult = Readonly<{
  invocationId: string;
  runId: string;
  artifactRefs: readonly string[];
  evidenceRefs: readonly string[];
}>;

export type SurfaceAiRuntimeTransportErrorCode =
  | 'SURFACE_AI_TRANSPORT_BINDING_INVALID'
  | 'SURFACE_AI_TRANSPORT_CONNECTION_EXISTS'
  | 'SURFACE_AI_TRANSPORT_NOT_READY'
  | 'SURFACE_AI_TRANSPORT_INVOCATION_INVALID'
  | 'SURFACE_AI_TRANSPORT_INVOCATION_IN_FLIGHT'
  | 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID'
  | 'SURFACE_AI_TRANSPORT_MESSAGE_OVERSIZE'
  | 'SURFACE_AI_TRANSPORT_SEQUENCE_INVALID'
  | 'SURFACE_AI_TRANSPORT_TIMEOUT'
  | 'SURFACE_AI_TRANSPORT_CANCELLED'
  | 'SURFACE_AI_TRANSPORT_INVALIDATED';

export class SurfaceAiRuntimeTransportError extends Error {
  public constructor(readonly code: SurfaceAiRuntimeTransportErrorCode) {
    super(code);
    this.name = 'SurfaceAiRuntimeTransportError';
  }
}

export type SurfaceAiRuntimeTransportRegistry = Readonly<{
  /** Main-only registration: a package may never create an invocation through this API. */
  register: (binding: SurfaceAiRuntimeTransportBinding, endpoint: SurfaceAiRuntimeTransportEndpoint) => void;
  invoke: (request: SurfaceAiRuntimeTransportInvocation) => Promise<SurfaceAiRuntimeTransportResult>;
  isActive: (binding: SurfaceAiRuntimeTransportBinding) => boolean;
  /** Runtime closure, owner loss, and Store revocation must all use this path. */
  invalidate: (runtime: Pick<SurfaceAiRuntimeTransportBinding, 'ownerId' | 'runtimeId'>) => void;
  dispose: () => void;
}>;

type ReadyEnvelope = Readonly<{
  type: 'ready';
  schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  sequence: 0;
  binding: SurfaceAiRuntimeTransportBinding;
}>;

type ProgressEnvelope = Readonly<{
  type: 'progress';
  schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  sequence: number;
  invocationId: string;
  runId: string;
  operationId: string;
  operationSchemaVersion: 1;
  phase: string;
  completed: number;
  total: number;
}>;

type ResultEnvelope = Readonly<{
  type: 'result';
  schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  sequence: number;
  invocationId: string;
  runId: string;
  operationId: string;
  operationSchemaVersion: 1;
  artifactRefs: readonly string[];
  evidenceRefs: readonly string[];
}>;

type PendingInvocation = Readonly<{
  request: SurfaceAiRuntimeTransportInvocation;
  resolve: (result: SurfaceAiRuntimeTransportResult) => void;
  reject: (error: SurfaceAiRuntimeTransportError) => void;
  clearTimeout: () => void;
  removeAbortListener: () => void;
}>;

type Connection = {
  readonly binding: SurfaceAiRuntimeTransportBinding;
  readonly endpoint: SurfaceAiRuntimeTransportEndpoint;
  removeMessageListener: () => void;
  removeCloseListener: () => void;
  ready: boolean;
  closed: boolean;
  inboundSequence: number;
  outboundSequence: number;
  pending?: PendingInvocation;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isSafeIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && SAFE_IDENTIFIER.test(value);

const isValidReferenceList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= MAX_REFERENCE_COUNT && value.every(isSafeIdentifier);

const isValidOperationInput = (value: unknown): value is Readonly<{ schemaVersion: 1; instruction: string }> => {
  if (!isRecord(value) || Object.keys(value).length !== 2 || value.schemaVersion !== 1) return false;
  return (
    typeof value.instruction === 'string' &&
    value.instruction.trim().length > 0 &&
    Buffer.byteLength(value.instruction, 'utf8') <= MAX_OPERATION_INSTRUCTION_BYTES
  );
};

const serializedSize = (value: unknown): number | undefined => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return undefined;
  }
};

const bindingKey = (binding: SurfaceAiRuntimeTransportBinding): string =>
  [
    binding.surface.packageId,
    binding.surface.packageVersion,
    binding.surface.publisherId,
    binding.ownerId,
    binding.runtimeId,
    binding.moduleId,
    binding.artifactIntegrity,
  ].join('\u0000');

const runtimeKey = (runtime: Pick<SurfaceAiRuntimeTransportBinding, 'ownerId' | 'runtimeId'>): string =>
  `${runtime.ownerId}\u0000${runtime.runtimeId}`;

const isValidBinding = (binding: unknown): binding is SurfaceAiRuntimeTransportBinding => {
  if (!isRecord(binding) || !isRecord(binding.surface)) return false;

  return (
    isSafeIdentifier(binding.surface.packageId) &&
    isSafeIdentifier(binding.surface.packageVersion) &&
    isSafeIdentifier(binding.surface.publisherId) &&
    isSafeIdentifier(binding.ownerId) &&
    isSafeIdentifier(binding.runtimeId) &&
    isSafeIdentifier(binding.moduleId) &&
    typeof binding.artifactIntegrity === 'string' &&
    SHA256_INTEGRITY.test(binding.artifactIntegrity)
  );
};

const hasExactBinding = (expected: SurfaceAiRuntimeTransportBinding, received: unknown): boolean =>
  isValidBinding(received) && bindingKey(expected) === bindingKey(received);

const freezeBinding = (binding: SurfaceAiRuntimeTransportBinding): SurfaceAiRuntimeTransportBinding =>
  Object.freeze({ ...binding, surface: Object.freeze({ ...binding.surface }) });

const asTransportError = (code: SurfaceAiRuntimeTransportErrorCode): SurfaceAiRuntimeTransportError =>
  new SurfaceAiRuntimeTransportError(code);

/**
 * Main-only authenticated transport core for a single reviewed local Surface runtime.
 *
 * This is intentionally not production-wired: it has no IPC/preload registration,
 * Trust dispatch, user confirmation UI, secret resolver, or package host integration.
 * It exists to make the required identity-bound MessagePort contract testable before
 * those independently owned seams are connected.
 */
export const createSurfaceAiRuntimeTransportRegistry = (): SurfaceAiRuntimeTransportRegistry => {
  const connections = new Map<string, Connection>();

  const closeConnection = (connection: Connection, code: SurfaceAiRuntimeTransportErrorCode): void => {
    if (connection.closed) return;
    connection.closed = true;
    connections.delete(bindingKey(connection.binding));
    connection.removeMessageListener();
    connection.removeCloseListener();

    const pending = connection.pending;
    connection.pending = undefined;
    pending?.clearTimeout();
    pending?.removeAbortListener();
    if (pending) {
      try {
        connection.endpoint.postMessage({
          type: 'cancel',
          schemaVersion: TRANSPORT_SCHEMA_VERSION,
          sequence: ++connection.outboundSequence,
          invocationId: pending.request.invocationId,
          runId: pending.request.runId,
          operationId: pending.request.operationId,
          operationSchemaVersion: pending.request.operationSchemaVersion,
        });
      } catch {
        // Endpoint cleanup is best effort; Main still terminates the invocation.
      }
      pending.reject(asTransportError(code));
    }

    try {
      connection.endpoint.close();
    } catch {
      // Endpoint cleanup is best effort; Main still has closed the authority record.
    }
  };

  const rejectMalformedMessage = (connection: Connection, code: SurfaceAiRuntimeTransportErrorCode): void =>
    closeConnection(connection, code);

  const handleMessage = (connection: Connection, message: unknown): void => {
    const size = serializedSize(message);
    if (size === undefined) return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
    if (size > MAX_SURFACE_AI_TRANSPORT_ENVELOPE_BYTES) {
      return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_OVERSIZE');
    }
    if (!isRecord(message) || message.schemaVersion !== TRANSPORT_SCHEMA_VERSION || !isSafeIdentifier(message.type)) {
      return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
    }

    if (!connection.ready) {
      const ready = message as Partial<ReadyEnvelope>;
      if (ready.type !== 'ready' || ready.sequence !== 0 || !hasExactBinding(connection.binding, ready.binding)) {
        return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
      }
      connection.ready = true;
      connection.inboundSequence = 0;
      return;
    }

    if (
      typeof message.sequence !== 'number' ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence !== connection.inboundSequence + 1
    ) {
      return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_SEQUENCE_INVALID');
    }
    connection.inboundSequence = message.sequence;

    const pending = connection.pending;
    if (
      !pending ||
      message.invocationId !== pending.request.invocationId ||
      message.runId !== pending.request.runId ||
      message.operationId !== pending.request.operationId ||
      message.operationSchemaVersion !== pending.request.operationSchemaVersion
    ) {
      return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
    }

    if (message.type === 'progress') {
      const progress = message as Partial<ProgressEnvelope>;
      if (
        !isSafeIdentifier(progress.phase) ||
        typeof progress.completed !== 'number' ||
        !Number.isSafeInteger(progress.completed) ||
        progress.completed < 0 ||
        typeof progress.total !== 'number' ||
        !Number.isSafeInteger(progress.total) ||
        progress.total < progress.completed
      ) {
        return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
      }
      pending.request.onProgress?.({
        invocationId: pending.request.invocationId,
        runId: pending.request.runId,
        phase: progress.phase,
        completed: progress.completed,
        total: progress.total,
      });
      return;
    }

    if (message.type !== 'result') return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
    const result = message as Partial<ResultEnvelope>;
    if (!isValidReferenceList(result.artifactRefs) || !isValidReferenceList(result.evidenceRefs)) {
      return rejectMalformedMessage(connection, 'SURFACE_AI_TRANSPORT_MESSAGE_INVALID');
    }

    connection.pending = undefined;
    pending.clearTimeout();
    pending.removeAbortListener();
    pending.resolve({
      invocationId: pending.request.invocationId,
      runId: pending.request.runId,
      artifactRefs: Object.freeze([...result.artifactRefs]),
      evidenceRefs: Object.freeze([...result.evidenceRefs]),
    });
  };

  const invoke = (request: SurfaceAiRuntimeTransportInvocation): Promise<SurfaceAiRuntimeTransportResult> => {
    if (!isValidBinding(request.binding))
      return Promise.reject(asTransportError('SURFACE_AI_TRANSPORT_BINDING_INVALID'));
    if (
      !isSafeIdentifier(request.invocationId) ||
      !isSafeIdentifier(request.runId) ||
      !isSafeIdentifier(request.operationId) ||
      !isSafeIdentifier(request.operationLeaseId) ||
      !isValidOperationInput(request.input) ||
      request.operationSchemaVersion !== 1 ||
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > MAX_TIMEOUT_MS
    ) {
      return Promise.reject(asTransportError('SURFACE_AI_TRANSPORT_INVOCATION_INVALID'));
    }

    const connection = connections.get(bindingKey(request.binding));
    if (!connection || connection.closed || !connection.ready) {
      return Promise.reject(asTransportError('SURFACE_AI_TRANSPORT_NOT_READY'));
    }
    if (connection.pending) return Promise.reject(asTransportError('SURFACE_AI_TRANSPORT_INVOCATION_IN_FLIGHT'));

    return new Promise<SurfaceAiRuntimeTransportResult>((resolve, reject) => {
      const cancel = (code: SurfaceAiRuntimeTransportErrorCode): void => {
        if (connection.pending?.request !== request) return;
        connection.pending = undefined;
        clearTimeout(timeoutId);
        request.signal?.removeEventListener('abort', abort);
        try {
          connection.endpoint.postMessage({
            type: 'cancel',
            schemaVersion: TRANSPORT_SCHEMA_VERSION,
            sequence: ++connection.outboundSequence,
            invocationId: request.invocationId,
            runId: request.runId,
            operationId: request.operationId,
            operationSchemaVersion: request.operationSchemaVersion,
          });
        } catch {
          // The terminal Main error is still authoritative.
        }
        reject(asTransportError(code));
      };
      const abort = (): void => cancel('SURFACE_AI_TRANSPORT_CANCELLED');
      const timeoutId = setTimeout(() => cancel('SURFACE_AI_TRANSPORT_TIMEOUT'), request.timeoutMs);
      const pending: PendingInvocation = {
        request,
        resolve,
        reject,
        clearTimeout: () => clearTimeout(timeoutId),
        removeAbortListener: () => request.signal?.removeEventListener('abort', abort),
      };
      connection.pending = pending;
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted) return abort();

      const envelope = {
        type: 'invoke',
        schemaVersion: TRANSPORT_SCHEMA_VERSION,
        sequence: ++connection.outboundSequence,
        invocationId: request.invocationId,
        runId: request.runId,
        operationId: request.operationId,
        operationSchemaVersion: request.operationSchemaVersion,
        operationLeaseId: request.operationLeaseId,
        input: { schemaVersion: request.input.schemaVersion, instruction: request.input.instruction },
        timeoutMs: request.timeoutMs,
      };
      if ((serializedSize(envelope) ?? Number.POSITIVE_INFINITY) > MAX_SURFACE_AI_TRANSPORT_ENVELOPE_BYTES) {
        cancel('SURFACE_AI_TRANSPORT_INVOCATION_INVALID');
        return;
      }
      try {
        connection.endpoint.postMessage(envelope);
      } catch {
        cancel('SURFACE_AI_TRANSPORT_INVALIDATED');
      }
    });
  };

  return Object.freeze({
    register: (binding: SurfaceAiRuntimeTransportBinding, endpoint: SurfaceAiRuntimeTransportEndpoint): void => {
      if (!isValidBinding(binding)) throw asTransportError('SURFACE_AI_TRANSPORT_BINDING_INVALID');
      const frozenBinding = freezeBinding(binding);
      const key = bindingKey(frozenBinding);
      if (connections.has(key)) throw asTransportError('SURFACE_AI_TRANSPORT_CONNECTION_EXISTS');

      const connection = {
        binding: frozenBinding,
        endpoint,
        ready: false,
        closed: false,
        inboundSequence: 0,
        outboundSequence: 0,
        removeMessageListener: () => undefined,
        removeCloseListener: () => undefined,
      } as Connection;
      connections.set(key, connection);
      connection.removeMessageListener = endpoint.onMessage((message) => handleMessage(connection, message));
      connection.removeCloseListener = endpoint.onClose(() =>
        closeConnection(connection, 'SURFACE_AI_TRANSPORT_INVALIDATED')
      );
    },
    invoke,
    isActive: (binding: SurfaceAiRuntimeTransportBinding): boolean => {
      if (!isValidBinding(binding)) return false;
      const connection = connections.get(bindingKey(binding));
      return connection !== undefined && connection.ready && !connection.closed;
    },
    invalidate: (runtime: Pick<SurfaceAiRuntimeTransportBinding, 'ownerId' | 'runtimeId'>): void => {
      if (!isSafeIdentifier(runtime.ownerId) || !isSafeIdentifier(runtime.runtimeId)) return;
      for (const connection of [...connections.values()]) {
        if (runtimeKey(connection.binding) === runtimeKey(runtime)) {
          closeConnection(connection, 'SURFACE_AI_TRANSPORT_INVALIDATED');
        }
      }
    },
    dispose: (): void => {
      for (const connection of [...connections.values()]) {
        closeConnection(connection, 'SURFACE_AI_TRANSPORT_INVALIDATED');
      }
    },
  });
};
