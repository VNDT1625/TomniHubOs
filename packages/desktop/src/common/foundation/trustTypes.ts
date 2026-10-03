import type { PolicyDecision } from './decisionTypes';

export type TrustOperation = 'agent' | 'cli' | 'filesystem' | 'mcp' | 'network' | 'package' | 'provider';

/** A governed request is tied to one actor, run, policy, and replay-safe effect. */
export type TrustRequest = {
  runId: string;
  taskId: string;
  actorId: string;
  operation: TrustOperation;
  targetId: string;
  requestedCapabilities: readonly string[];
  workspaceScope: string;
  policyVersion: string;
  idempotencyKey: string;
  reason: string;
  filePath?: string;
  networkHost?: string;
  packageId?: string;
  packageSigned?: boolean;
};

export type TrustPolicy = {
  allowedCapabilities: readonly string[];
  allowedNetworkHosts: readonly string[];
  trustedPackageIds: readonly string[];
  allowedOrigins: readonly string[];
  requireApprovalForMutation: boolean;
  capabilityGrantTtlMs: number;
  policyVersion: string;
};

export type TrustOriginRequest = Pick<TrustRequest, 'runId' | 'taskId' | 'actorId' | 'targetId' | 'policyVersion'> & {
  origin: string;
};

export type CapabilityGrant = PolicyDecision & {
  actorId: string;
  origin: string;
  policyVersion: string;
  grantId?: string;
};

/** Egress must be checked after serialization and while the matching grant is live. */
export type FinalEgressRequest = TrustRequest & {
  origin: string;
  serializedPayload: string;
  grantId?: string;
};

/** Filesystem effects must re-present the live grant immediately before commit. */
export type FinalFilesystemEffectRequest = TrustRequest & {
  origin: string;
  grantId?: string;
};

/** A lease is an opaque reference only; it never exposes secret plaintext. */
export type SecretUseRequest = {
  runId: string;
  taskId: string;
  actorId: string;
  targetId: string;
  origin: string;
  secretHandle: string;
  purpose: string;
  policyVersion: string;
  idempotencyKey: string;
  grantId: string;
  destinationHost?: string;
};

export type OpaqueSecretLease = {
  leaseId: string;
  secretHandle: string;
  runId: string;
  taskId: string;
  targetId: string;
  expiresAt: number;
  policyVersion: string;
};

export type EgressDecision = CapabilityGrant;
