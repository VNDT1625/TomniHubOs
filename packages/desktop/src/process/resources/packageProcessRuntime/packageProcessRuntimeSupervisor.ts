import { createHash, randomUUID } from 'node:crypto';
import type { PackageIdentity } from '@/common/packages';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const INTEGRITY_PATTERN = /^sha256-[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 64 * 1024;

export type PackageProcessRuntimeBinding = Readonly<{
  surface: PackageIdentity;
  runtimeId: string;
  entrypointId: string;
  artifactIntegrity: string;
}>;

export type PackageProcessRuntimeInvocation = Readonly<{
  invocationId: string;
  operationId: string;
  input: unknown;
  deadlineAt: number;
  signal: AbortSignal;
}>;

export type PackageProcessRuntimeEvidence = Readonly<{
  kind: 'package-process-runtime.v1';
  phase: 'admitted' | 'started' | 'completed' | 'rejected' | 'cancelled' | 'failed';
  invocationId: string;
  binding: PackageProcessRuntimeBinding;
  capability: string;
  deadlineAt: number;
  inputDigest?: string;
  outputDigest?: string;
  reason?: string;
}>;

/**
 * A Main-owned isolated process endpoint. Implementations must have already verified the
 * executable and containment before they are returned to this supervisor.
 */
export type PackageProcessRuntimeEndpoint = Readonly<{
  invoke: (invocation: PackageProcessRuntimeInvocation) => Promise<unknown>;
  terminate: () => Promise<void>;
}>;

export type PackageProcessRuntimeSupervisorDependencies = Readonly<{
  isBindingActive: (binding: PackageProcessRuntimeBinding) => Promise<boolean>;
  hasCapabilityGrant: (binding: PackageProcessRuntimeBinding, capability: string) => boolean;
  createEndpoint: (
    binding: PackageProcessRuntimeBinding,
    signal: AbortSignal
  ) => Promise<PackageProcessRuntimeEndpoint | undefined>;
  validateInput: (binding: PackageProcessRuntimeBinding, operationId: string, input: unknown) => unknown;
  validateOutput: (binding: PackageProcessRuntimeBinding, operationId: string, output: unknown) => unknown;
  /** Durable, redacted evidence sink. Failure fails closed before an unreceipted invocation can start. */
  recordEvidence: (evidence: PackageProcessRuntimeEvidence) => Promise<void>;
  createInvocationId?: () => string;
}>;

export type PackageProcessRuntimeSupervisor = Readonly<{
  invoke: (
    input: Readonly<{
      binding: PackageProcessRuntimeBinding;
      operationId: string;
      input: unknown;
      deadlineAt: number;
      signal?: AbortSignal;
    }>
  ) => Promise<unknown>;
  invalidate: (surface: PackageIdentity, runtimeId: string) => Promise<void>;
  dispose: () => Promise<void>;
}>;

type ActiveInvocation = {
  binding: PackageProcessRuntimeBinding;
  controller: AbortController;
  endpoint?: PackageProcessRuntimeEndpoint;
  endpointTerminated: boolean;
};

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const requireIdentifier = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`PACKAGE_PROCESS_RUNTIME_INVALID_${label}`);
  }
  return normalized;
};

const requireBinding = (binding: PackageProcessRuntimeBinding): PackageProcessRuntimeBinding => {
  requireIdentifier(binding.surface.packageId, 'PACKAGE_ID');
  requireIdentifier(binding.surface.packageVersion, 'PACKAGE_VERSION');
  requireIdentifier(binding.surface.publisherId, 'PUBLISHER_ID');
  requireIdentifier(binding.runtimeId, 'RUNTIME_ID');
  requireIdentifier(binding.entrypointId, 'ENTRYPOINT_ID');
  if (!INTEGRITY_PATTERN.test(binding.artifactIntegrity)) {
    throw new Error('PACKAGE_PROCESS_RUNTIME_INVALID_ARTIFACT');
  }
  return binding;
};

const serializeBoundedJson = (value: unknown): string => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('PACKAGE_PROCESS_RUNTIME_INVALID_PAYLOAD');
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BYTES) {
    throw new Error('PACKAGE_PROCESS_RUNTIME_PAYLOAD_TOO_LARGE');
  }
  return serialized;
};

const digestPayload = (serialized: string): string => `sha256-${createHash('sha256').update(serialized).digest('hex')}`;

const capabilityFor = (binding: PackageProcessRuntimeBinding, operationId: string): string =>
  `package.process:${binding.entrypointId}:${operationId}`;

const abortCode = (signal: AbortSignal): string =>
  typeof signal.reason === 'string' && signal.reason.startsWith('PACKAGE_PROCESS_RUNTIME_')
    ? signal.reason
    : 'PACKAGE_PROCESS_RUNTIME_CANCELLED';

const isCancellation = (code: string): boolean =>
  code === 'PACKAGE_PROCESS_RUNTIME_CANCELLED' ||
  code === 'PACKAGE_PROCESS_RUNTIME_DEADLINE_EXCEEDED' ||
  code === 'PACKAGE_PROCESS_RUNTIME_REVOKED' ||
  code === 'PACKAGE_PROCESS_RUNTIME_DISPOSED';

const errorCode = (error: unknown): string => {
  if (error instanceof Error && error.message.startsWith('PACKAGE_PROCESS_RUNTIME_')) return error.message;
  return 'PACKAGE_PROCESS_RUNTIME_FAILED';
};

const waitForAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject: (reason: Error) => void) => {
    if (signal.aborted) {
      reject(new Error(abortCode(signal)));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error(abortCode(signal))), { once: true });
  });

/**
 * Main-only lifecycle gate for verified package-native helpers. It is deliberately not an IPC
 * bridge: a package never selects an executable, runtime identity, or capability grant itself.
 */
export const createPackageProcessRuntimeSupervisor = (
  deps: PackageProcessRuntimeSupervisorDependencies
): PackageProcessRuntimeSupervisor => {
  const active = new Map<string, ActiveInvocation>();
  const createInvocationId = deps.createInvocationId ?? (() => `package-process-${randomUUID()}`);
  let disposed = false;

  const terminate = async (record: ActiveInvocation, reason: string): Promise<void> => {
    if (!record.controller.signal.aborted) record.controller.abort(reason);
    if (record.endpoint === undefined || record.endpointTerminated) return;
    record.endpointTerminated = true;
    try {
      await record.endpoint.terminate();
    } catch {
      // Cleanup is best-effort; authority is already revoked by the controller.
    }
  };

  return {
    invoke: async ({ binding: rawBinding, operationId: rawOperationId, input, deadlineAt, signal }) => {
      if (disposed) throw new Error('PACKAGE_PROCESS_RUNTIME_DISPOSED');
      const binding = requireBinding(rawBinding);
      const operationId = requireIdentifier(rawOperationId, 'OPERATION_ID');
      if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now()) {
        throw new Error('PACKAGE_PROCESS_RUNTIME_DEADLINE_EXPIRED');
      }
      if (signal?.aborted) throw new Error('PACKAGE_PROCESS_RUNTIME_CANCELLED');
      if (!(await deps.isBindingActive(binding))) {
        throw new Error('PACKAGE_PROCESS_RUNTIME_BINDING_INACTIVE');
      }
      if (!deps.hasCapabilityGrant(binding, capabilityFor(binding, operationId))) {
        throw new Error('PACKAGE_PROCESS_RUNTIME_GRANT_REQUIRED');
      }

      const validatedInput = deps.validateInput(binding, operationId, input);
      const inputDigest = digestPayload(serializeBoundedJson(validatedInput));
      if (active.has(binding.runtimeId)) {
        throw new Error('PACKAGE_PROCESS_RUNTIME_BUSY');
      }

      const invocationId = requireIdentifier(createInvocationId(), 'INVOCATION_ID');
      const capability = capabilityFor(binding, operationId);
      const controller = new AbortController();
      const onAbort = (): void => controller.abort('PACKAGE_PROCESS_RUNTIME_CANCELLED');
      signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(
        () => controller.abort('PACKAGE_PROCESS_RUNTIME_DEADLINE_EXCEEDED'),
        Math.max(1, deadlineAt - Date.now())
      );
      const record: ActiveInvocation = { binding, controller, endpointTerminated: false };
      const recordEvidence = async (
        phase: PackageProcessRuntimeEvidence['phase'],
        details: Readonly<{ outputDigest?: string; reason?: string }> = {}
      ): Promise<void> => {
        try {
          await deps.recordEvidence({
            kind: 'package-process-runtime.v1',
            phase,
            invocationId,
            binding,
            capability,
            deadlineAt,
            inputDigest,
            ...details,
          });
        } catch {
          throw new Error('PACKAGE_PROCESS_RUNTIME_EVIDENCE_UNAVAILABLE');
        }
      };
      let terminalEvidenceRecorded = false;
      try {
        await recordEvidence('admitted');
        active.set(binding.runtimeId, record);
        const endpoint = await deps.createEndpoint(binding, controller.signal);
        if (endpoint === undefined) {
          if (controller.signal.aborted) throw new Error(abortCode(controller.signal));
          throw new Error('PACKAGE_PROCESS_RUNTIME_UNAVAILABLE');
        }
        record.endpoint = endpoint;
        if (controller.signal.aborted) {
          await terminate(record, abortCode(controller.signal));
          throw new Error(abortCode(controller.signal));
        }
        await recordEvidence('started');
        try {
          const output = await Promise.race([
            endpoint.invoke({
              invocationId,
              operationId,
              input: validatedInput,
              deadlineAt,
              signal: controller.signal,
            }),
            waitForAbort(controller.signal),
          ]);
          if (controller.signal.aborted || !(await deps.isBindingActive(binding))) {
            throw new Error(
              controller.signal.aborted ? abortCode(controller.signal) : 'PACKAGE_PROCESS_RUNTIME_REVOKED'
            );
          }
          const validatedOutput = deps.validateOutput(binding, operationId, output);
          const outputDigest = digestPayload(serializeBoundedJson(validatedOutput));
          await recordEvidence('completed', { outputDigest });
          terminalEvidenceRecorded = true;
          return validatedOutput;
        } finally {
          active.delete(binding.runtimeId);
          await terminate(record, 'PACKAGE_PROCESS_RUNTIME_COMPLETED');
        }
      } catch (error) {
        const code = errorCode(error);
        if (!terminalEvidenceRecorded && code !== 'PACKAGE_PROCESS_RUNTIME_EVIDENCE_UNAVAILABLE') {
          await recordEvidence(
            isCancellation(code)
              ? 'cancelled'
              : code.includes('_INVALID_') || code.endsWith('_REQUIRED') || code.endsWith('_INACTIVE')
                ? 'rejected'
                : 'failed',
            {
              reason: code,
            }
          );
        }
        throw error instanceof Error && error.message === code ? error : new Error(code);
      } finally {
        active.delete(binding.runtimeId);
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    },
    invalidate: async (surface, runtimeId) => {
      const record = active.get(runtimeId);
      if (record !== undefined && sameIdentity(record.binding.surface, surface)) {
        active.delete(runtimeId);
        await terminate(record, 'PACKAGE_PROCESS_RUNTIME_REVOKED');
      }
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      const records = [...active.values()];
      active.clear();
      await Promise.all(records.map(async (record) => terminate(record, 'PACKAGE_PROCESS_RUNTIME_DISPOSED')));
    },
  };
};
