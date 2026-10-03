import { randomUUID } from 'node:crypto';

import type { PackageIdentity } from '@/common/packages';
import type { RunBudget } from '@/common/foundation/runTypes';
import type { SecretResolveRequest } from '@/process/agentRuntime/contextTypes';
import type { SecretPayload } from '@/process/agentRuntime/secretVault';

const MAX_LEASE_MS = 5 * 60_000;
const MAX_FIELDS = 20;
const MAX_EVIDENCE_REFS = 32;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/;

export type SurfaceAiSecretLeaseErrorCode =
  | 'SURFACE_AI_SECRET_LEASE_INVALID'
  | 'SURFACE_AI_SECRET_LEASE_DENIED'
  | 'SURFACE_AI_SECRET_LEASE_UNAVAILABLE';

/** Stable opaque error intended for Main-only C4 composition. */
export class SurfaceAiSecretLeaseError extends Error {
  public constructor(readonly code: SurfaceAiSecretLeaseErrorCode) {
    super(code);
    this.name = 'SurfaceAiSecretLeaseError';
  }
}

export type SurfaceAiSecretLeaseBinding = Readonly<{
  accountId: string;
  consentId: string;
  parentRunId: string;
  childRunId: string;
  invocationId: string;
  surface: PackageIdentity;
  operationId: string;
  capability: string;
  destinationId: string;
  secretHandle: string;
  fields: readonly string[];
  budget: Readonly<RunBudget>;
  expiresAt: number;
}>;

/**
 * A sink is trusted Main-process code. Neither renderer, model nor Package
 * runtime can register one or receive the resolved payload/lease identifier.
 */
export type SurfaceAiSecretLeaseSink = Readonly<{
  destinationId: string;
  surface: PackageIdentity;
  operationId: string;
  consume: (
    input: Readonly<{
      accountId: string;
      parentRunId: string;
      childRunId: string;
      invocationId: string;
      destinationId: string;
      fields: readonly string[];
      secret: Readonly<SecretPayload>;
      signal: AbortSignal;
    }>
  ) => Promise<{ evidenceRefs: readonly string[] }>;
}>;

export type SurfaceAiSecretLeaseAuthority = Readonly<{
  issue: (binding: SurfaceAiSecretLeaseBinding, signal: AbortSignal) => { leaseId: string; expiresAt: number };
  consume: (leaseId: string, signal: AbortSignal) => Promise<{ evidenceRefs: readonly string[] }>;
  revoke: (leaseId: string) => boolean;
}>;

export type SurfaceAiSecretLeaseAuthorityDeps = Readonly<{
  resolveSecret: (request: SecretResolveRequest) => Promise<SecretPayload>;
  sinks: readonly SurfaceAiSecretLeaseSink[];
  /** Main-owned verifier for the exact durable C4 consent/review/runtime/run state. */
  isBindingActive: (binding: SurfaceAiSecretLeaseBinding) => boolean;
  now?: () => number;
  createLeaseId?: () => string;
}>;

type StoredLease = Readonly<{ binding: SurfaceAiSecretLeaseBinding; signal: AbortSignal; consumed: boolean }>;

const fail = (code: SurfaceAiSecretLeaseErrorCode): never => {
  throw new SurfaceAiSecretLeaseError(code);
};

const validIdentifier = (value: string): boolean => IDENTIFIER.test(value);

const sameIdentity = (left: PackageIdentity, right: PackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;

const assertBinding = (binding: SurfaceAiSecretLeaseBinding, now: number): void => {
  const identifiers = [
    binding.accountId,
    binding.consentId,
    binding.parentRunId,
    binding.childRunId,
    binding.invocationId,
    binding.operationId,
    binding.capability,
    binding.destinationId,
    binding.secretHandle,
    binding.surface.packageId,
    binding.surface.packageVersion,
    binding.surface.publisherId,
  ];
  if (
    identifiers.some((value) => !validIdentifier(value)) ||
    binding.fields.length === 0 ||
    binding.fields.length > MAX_FIELDS ||
    new Set(binding.fields).size !== binding.fields.length ||
    binding.fields.some((field) => !validIdentifier(field)) ||
    !Number.isSafeInteger(binding.budget.maxEstimatedCostMB) ||
    binding.budget.maxEstimatedCostMB < 1 ||
    !Number.isSafeInteger(binding.budget.maxSteps) ||
    binding.budget.maxSteps < 1 ||
    !Number.isSafeInteger(binding.expiresAt) ||
    binding.expiresAt <= now ||
    binding.expiresAt - now > MAX_LEASE_MS
  ) {
    fail('SURFACE_AI_SECRET_LEASE_INVALID');
  }
};

/**
 * Main-only, one-time secret lease authority for a future C4 secret operation.
 * It is deliberately unregistered: no current Surface AI operation can request
 * secret use. Resolution occurs only inside a pre-registered Main sink after
 * the lease is revalidated, so a package/model/renderer never sees plaintext.
 */
export const createSurfaceAiSecretLeaseAuthority = (
  deps: SurfaceAiSecretLeaseAuthorityDeps
): SurfaceAiSecretLeaseAuthority => {
  const now = deps.now ?? Date.now;
  const createLeaseId = deps.createLeaseId ?? randomUUID;
  const sinks = new Map<string, SurfaceAiSecretLeaseSink>();
  const leases = new Map<string, StoredLease>();
  for (const sink of deps.sinks) {
    if (!validIdentifier(sink.destinationId) || sinks.has(sink.destinationId)) {
      throw new Error('SURFACE_AI_SECRET_LEASE_CONFIGURATION_INVALID');
    }
    sinks.set(sink.destinationId, sink);
  }

  const requireLive = (leaseId: string, lease: StoredLease, signal: AbortSignal): SurfaceAiSecretLeaseBinding => {
    if (
      lease.consumed ||
      signal.aborted ||
      lease.signal.aborted ||
      lease.binding.expiresAt <= now() ||
      !deps.isBindingActive(lease.binding)
    ) {
      leases.delete(leaseId);
      return fail('SURFACE_AI_SECRET_LEASE_DENIED');
    }
    return lease.binding;
  };

  return {
    issue(binding, signal) {
      assertBinding(binding, now());
      const sink = sinks.get(binding.destinationId);
      if (!sink || !sameIdentity(sink.surface, binding.surface) || sink.operationId !== binding.operationId) {
        fail('SURFACE_AI_SECRET_LEASE_UNAVAILABLE');
      }
      if (signal.aborted || !deps.isBindingActive(binding)) fail('SURFACE_AI_SECRET_LEASE_DENIED');
      const leaseId = createLeaseId();
      if (!validIdentifier(leaseId) || leases.has(leaseId)) fail('SURFACE_AI_SECRET_LEASE_INVALID');
      leases.set(leaseId, { binding, signal, consumed: false });
      return { leaseId, expiresAt: binding.expiresAt };
    },
    async consume(leaseId, signal) {
      if (!validIdentifier(leaseId)) fail('SURFACE_AI_SECRET_LEASE_INVALID');
      const lease = leases.get(leaseId);
      if (!lease) fail('SURFACE_AI_SECRET_LEASE_UNAVAILABLE');
      const binding = requireLive(leaseId, lease, signal);
      const sink = sinks.get(binding.destinationId);
      if (!sink || !sameIdentity(sink.surface, binding.surface) || sink.operationId !== binding.operationId) {
        leases.delete(leaseId);
        fail('SURFACE_AI_SECRET_LEASE_DENIED');
      }
      // Consume before resolving: retry never reproduces secret delivery.
      leases.set(leaseId, { ...lease, consumed: true });
      try {
        const secret = await deps.resolveSecret({
          handle: binding.secretHandle,
          surface: binding.surface.packageId,
          purpose: `surface-ai:${binding.operationId}`,
          target: binding.destinationId,
          fields: [...binding.fields],
        });
        requireLive(leaseId, { ...lease, consumed: false }, signal);
        const result = await sink.consume({
          accountId: binding.accountId,
          parentRunId: binding.parentRunId,
          childRunId: binding.childRunId,
          invocationId: binding.invocationId,
          destinationId: binding.destinationId,
          fields: binding.fields,
          secret,
          signal,
        });
        if (
          result.evidenceRefs.length > MAX_EVIDENCE_REFS ||
          result.evidenceRefs.some((reference) => !validIdentifier(reference))
        ) {
          fail('SURFACE_AI_SECRET_LEASE_INVALID');
        }
        return { evidenceRefs: [...result.evidenceRefs] };
      } catch (error) {
        if (error instanceof SurfaceAiSecretLeaseError) throw error;
        fail('SURFACE_AI_SECRET_LEASE_DENIED');
      } finally {
        leases.delete(leaseId);
      }
    },
    revoke(leaseId) {
      if (!validIdentifier(leaseId)) return false;
      return leases.delete(leaseId);
    },
  };
};
