import path from 'node:path';

import type { PolicyDecision } from '../../common/foundation/decisionTypes';
import type {
  CapabilityGrant,
  EgressDecision,
  FinalEgressRequest,
  FinalFilesystemEffectRequest,
  OpaqueSecretLease,
  SecretUseRequest,
  TrustOperation,
  TrustOriginRequest,
  TrustPolicy,
  TrustRequest,
} from '../../common/foundation/trustTypes';

export type {
  CapabilityGrant,
  EgressDecision,
  FinalEgressRequest,
  FinalFilesystemEffectRequest,
  OpaqueSecretLease,
  SecretUseRequest,
  TrustOperation,
  TrustOriginRequest,
  TrustPolicy,
  TrustRequest,
} from '../../common/foundation/trustTypes';

/** Narrow dynamic exception: it cannot admit arbitrary network or package calls. */
export type ProviderDestinationEvidenceRequest = Readonly<{
  actorId: string;
  targetId: string;
  hostname: string;
}>;

export type TrustBrokerOptions = {
  now?: () => number;
  /** Main composition supplies account/provider/version-bound evidence only. */
  isProviderDestinationAllowed?: (request: ProviderDestinationEvidenceRequest) => boolean;
};

type ActiveGrant = {
  grant: CapabilityGrant;
  request: Readonly<TrustRequest>;
  requestedCapabilities: readonly string[];
  expiresAt: number;
  idempotencyKey: string;
};

const DEFAULT_POLICY: TrustPolicy = {
  allowedCapabilities: ['execution.safe', 'target.execute', 'workspace.read'],
  allowedNetworkHosts: [],
  trustedPackageIds: [],
  allowedOrigins: [],
  requireApprovalForMutation: true,
  capabilityGrantTtlMs: 5 * 60 * 1000,
  policyVersion: 'trust-v1',
};

const isWithinWorkspace = (workspaceScope: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(workspaceScope), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const isMutating = (capability: string): boolean => capability.endsWith('.write') || capability.endsWith('.delete');
const hasText = (value: string): boolean => value.trim().length > 0;

/**
 * The Main-process authority for capability grants. A grant is bound to one
 * origin, actor, run, task, target, policy version, and expiry; it is never a
 * transferable permission token and it never carries secret plaintext.
 */
export class TrustBroker {
  private readonly policy: TrustPolicy;
  private readonly activeGrants = new Map<string, ActiveGrant>();
  private readonly revokedGrantIds = new Set<string>();
  private grantSequence = 0;

  public constructor(
    policy: Partial<TrustPolicy> = {},
    private readonly options: TrustBrokerOptions = {}
  ) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    if (!Number.isSafeInteger(this.policy.capabilityGrantTtlMs) || this.policy.capabilityGrantTtlMs < 1) {
      throw new Error('Trust policy capability grant TTL must be a positive integer.');
    }
  }

  /** Main-only policy identity used to reject a renderer-selected policy version. */
  public get policyVersion(): string {
    return this.policy.policyVersion;
  }

  /** Dynamically admits Main-discovered network hosts for governed targets. */
  public allowNetworkHosts(hosts: readonly string[]): void {
    const current = new Set(this.policy.allowedNetworkHosts.map((h) => h.toLowerCase()));
    const toAdd: string[] = [];
    for (const host of hosts) {
      const trimmed = host.trim();
      if (trimmed && !current.has(trimmed.toLowerCase())) {
        current.add(trimmed.toLowerCase());
        toAdd.push(trimmed);
      }
    }
    if (toAdd.length > 0) {
      (this.policy as { allowedNetworkHosts: readonly string[] }).allowedNetworkHosts = Object.freeze([
        ...this.policy.allowedNetworkHosts,
        ...toAdd,
      ]);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private isNetworkHostAllowed(request: TrustRequest, origin: string): boolean {
    if (request.networkHost === undefined) return false;
    const normalizedHost = request.networkHost.trim().toLowerCase();
    if (this.policy.allowedNetworkHosts.some((h) => h.toLowerCase() === normalizedHost)) return true;
    if (
      request.operation !== 'provider' ||
      origin !== 'tomny://provider-execution' ||
      !request.targetId.startsWith('provider:')
    ) {
      return false;
    }
    const providerId = request.targetId.slice('provider:'.length);
    return (
      providerId.length > 0 &&
      this.options.isProviderDestinationAllowed?.({
        actorId: request.actorId,
        targetId: request.targetId,
        hostname: request.networkHost,
      }) === true
    );
  }

  private decision(
    request: Pick<
      TrustRequest,
      'runId' | 'taskId' | 'actorId' | 'targetId' | 'requestedCapabilities' | 'policyVersion'
    >,
    decision: PolicyDecision['decision'],
    reasonCode: string,
    origin: string,
    grantId?: string,
    expiresAt?: number
  ): CapabilityGrant {
    return {
      decision,
      runId: request.runId,
      taskId: request.taskId,
      targetId: request.targetId,
      capabilities: request.requestedCapabilities,
      expiresAt,
      reasonCode,
      receiptId: `trust_${request.runId}_${request.taskId}_${this.now()}`,
      actorId: request.actorId,
      origin,
      policyVersion: this.policy.policyVersion,
      grantId,
    };
  }

  private validRequest(request: TrustRequest): boolean {
    return (
      hasText(request.runId) &&
      hasText(request.taskId) &&
      hasText(request.actorId) &&
      hasText(request.targetId) &&
      hasText(request.workspaceScope) &&
      hasText(request.policyVersion) &&
      hasText(request.idempotencyKey) &&
      hasText(request.reason) &&
      request.requestedCapabilities.length > 0 &&
      request.requestedCapabilities.every(hasText)
    );
  }

  /** Preflight policy check. It cannot mint a transferable capability grant. */
  public authorize(request: TrustRequest, origin: string = 'main://preflight'): CapabilityGrant {
    if (!this.validRequest(request)) return this.decision(request, 'deny', 'INVALID_TRUST_REQUEST', origin);

    if (request.requestedCapabilities.some((capability) => !this.policy.allowedCapabilities.includes(capability))) {
      return this.decision(request, 'deny', 'CAPABILITY_NOT_ALLOWED', origin);
    }
    if (
      request.operation === 'filesystem' &&
      request.filePath !== undefined &&
      !isWithinWorkspace(request.workspaceScope, request.filePath)
    ) {
      return this.decision(request, 'deny', 'WORKSPACE_SCOPE_VIOLATION', origin);
    }
    if (
      request.operation === 'network' &&
      (request.networkHost === undefined || !this.isNetworkHostAllowed(request, origin))
    ) {
      return this.decision(request, 'deny', 'NETWORK_HOST_NOT_ALLOWED', origin);
    }
    if (
      request.operation === 'package' &&
      (request.packageSigned !== true ||
        request.packageId === undefined ||
        !this.policy.trustedPackageIds.includes(request.packageId))
    ) {
      return this.decision(request, 'deny', 'PACKAGE_NOT_TRUSTED', origin);
    }
    if (this.policy.requireApprovalForMutation && request.requestedCapabilities.some(isMutating)) {
      return this.decision(request, 'approval_required', 'MUTATION_REQUIRES_APPROVAL', origin);
    }
    return this.decision(request, 'allow', 'TRUST_ALLOWED', origin);
  }

  /** Unknown renderers, subframes, and package origins are denied before capability evaluation. */
  public async authorizeOrigin(request: TrustOriginRequest): Promise<CapabilityGrant> {
    const valid =
      hasText(request.runId) &&
      hasText(request.taskId) &&
      hasText(request.actorId) &&
      hasText(request.targetId) &&
      hasText(request.policyVersion) &&
      hasText(request.origin);
    const allowed = valid && this.policy.allowedOrigins.includes(request.origin);
    return this.decision(
      { ...request, requestedCapabilities: [] },
      allowed ? 'allow' : 'deny',
      allowed ? 'ORIGIN_ALLOWED' : 'ORIGIN_NOT_ALLOWED',
      request.origin
    );
  }

  /** Issues a short-lived, origin-bound grant only for a fully allowed request. */
  public async requestCapability(request: TrustRequest, origin: string): Promise<CapabilityGrant> {
    const originDecision = await this.authorizeOrigin({
      runId: request.runId,
      taskId: request.taskId,
      actorId: request.actorId,
      targetId: request.targetId,
      policyVersion: request.policyVersion,
      origin,
    });
    if (originDecision.decision !== 'allow') return { ...originDecision, capabilities: request.requestedCapabilities };

    const decision = this.authorize(request, origin);
    if (decision.decision !== 'allow') return { ...decision, origin };

    const grantId = `grant_${request.runId}_${++this.grantSequence}_${this.now()}`;
    const expiresAt = this.now() + this.policy.capabilityGrantTtlMs;
    const grant: CapabilityGrant = { ...decision, origin, grantId, expiresAt };
    this.activeGrants.set(grantId, {
      grant,
      request: Object.freeze({ ...request, requestedCapabilities: [...request.requestedCapabilities] }),
      requestedCapabilities: request.requestedCapabilities,
      expiresAt,
      idempotencyKey: request.idempotencyKey,
    });
    return grant;
  }

  private validateGrant(request: TrustRequest, origin: string, grantId: string): CapabilityGrant | undefined {
    const active = this.activeGrants.get(grantId);
    if (
      active === undefined ||
      this.revokedGrantIds.has(grantId) ||
      active.expiresAt <= this.now() ||
      active.grant.runId !== request.runId ||
      active.grant.taskId !== request.taskId ||
      active.grant.actorId !== request.actorId ||
      active.grant.targetId !== request.targetId ||
      active.grant.origin !== origin ||
      active.grant.policyVersion !== this.policy.policyVersion ||
      active.idempotencyKey !== request.idempotencyKey ||
      (request.operation === 'filesystem' &&
        (active.request.operation !== request.operation ||
          active.request.workspaceScope !== request.workspaceScope ||
          active.request.filePath !== request.filePath)) ||
      request.requestedCapabilities.some((capability) => !active.requestedCapabilities.includes(capability))
    ) {
      return undefined;
    }
    return active.grant;
  }

  /**
   * Grants an opaque secret lease. Secret bytes remain in an approved isolated
   * runtime; callers receive only the original opaque handle and lease metadata.
   */
  public async resolveSecret(request: SecretUseRequest): Promise<OpaqueSecretLease> {
    const origin = await this.authorizeOrigin(request);
    const grant = this.validateGrant(
      {
        runId: request.runId,
        taskId: request.taskId,
        actorId: request.actorId,
        operation: 'provider',
        targetId: request.targetId,
        requestedCapabilities: ['secret.use'],
        workspaceScope: 'secret://opaque',
        policyVersion: request.policyVersion,
        idempotencyKey: request.idempotencyKey,
        reason: request.purpose,
        networkHost: request.destinationHost,
      },
      request.origin,
      request.grantId
    );
    if (
      origin.decision !== 'allow' ||
      grant === undefined ||
      !hasText(request.secretHandle) ||
      !hasText(request.purpose)
    ) {
      throw new Error('SECRET_LEASE_DENIED');
    }
    if (
      request.destinationHost !== undefined &&
      !this.isNetworkHostAllowed(
        {
          runId: request.runId,
          taskId: request.taskId,
          actorId: request.actorId,
          operation: 'provider',
          targetId: request.targetId,
          requestedCapabilities: ['secret.use'],
          workspaceScope: 'secret://opaque',
          policyVersion: request.policyVersion,
          idempotencyKey: request.idempotencyKey,
          reason: request.purpose,
          networkHost: request.destinationHost,
        },
        request.origin
      )
    ) {
      throw new Error('SECRET_DESTINATION_NOT_ALLOWED');
    }
    return {
      leaseId: `secret_lease_${request.runId}_${this.now()}`,
      secretHandle: request.secretHandle,
      runId: request.runId,
      taskId: request.taskId,
      targetId: request.targetId,
      expiresAt: grant.expiresAt ?? this.now(),
      policyVersion: grant.policyVersion,
    };
  }

  /** Final serialized egress must present the same live grant issued for the action. */
  public async inspectFinalEgress(request: FinalEgressRequest): Promise<EgressDecision> {
    const originDecision = await this.authorizeOrigin(request);
    if (originDecision.decision !== 'allow') return { ...originDecision, capabilities: request.requestedCapabilities };
    if (request.grantId === undefined) return this.decision(request, 'deny', 'EGRESS_GRANT_REQUIRED', request.origin);
    const grant = this.validateGrant(request, request.origin, request.grantId);
    if (grant === undefined) return this.decision(request, 'deny', 'EGRESS_GRANT_INVALID', request.origin);
    if (/\b(?:api[_-]?key|password|secret|token)\s*[:=]/iu.test(request.serializedPayload)) {
      return { ...grant, decision: 'deny', reasonCode: 'FINAL_EGRESS_SECRET_DETECTED' };
    }
    const policy = this.authorize(request, request.origin);
    return policy.decision === 'allow'
      ? { ...policy, origin: request.origin, grantId: grant.grantId, expiresAt: grant.expiresAt }
      : policy;
  }

  /**
   * Revalidates the exact live grant at the final filesystem commit seam.
   * Unlike a preflight, this binds the approved path and scope to one effect.
   */
  public async inspectFinalFilesystemEffect(request: FinalFilesystemEffectRequest): Promise<CapabilityGrant> {
    const originDecision = await this.authorizeOrigin(request);
    if (originDecision.decision !== 'allow') return { ...originDecision, capabilities: request.requestedCapabilities };
    if (request.operation !== 'filesystem' || request.filePath === undefined) {
      return this.decision(request, 'deny', 'INVALID_FILESYSTEM_EFFECT', request.origin);
    }
    if (request.grantId === undefined) {
      return this.decision(request, 'deny', 'FILESYSTEM_GRANT_REQUIRED', request.origin);
    }
    const grant = this.validateGrant(request, request.origin, request.grantId);
    if (grant === undefined) return this.decision(request, 'deny', 'FILESYSTEM_GRANT_INVALID', request.origin);
    const policy = this.authorize(request);
    return policy.decision === 'allow'
      ? { ...policy, origin: request.origin, grantId: grant.grantId, expiresAt: grant.expiresAt }
      : policy;
  }

  /** Revocation applies to one immutable grant; it cannot silently over-revoke future requests. */
  public async revoke(grantId: string, _reason: string): Promise<void> {
    this.revokedGrantIds.add(grantId);
  }
}
