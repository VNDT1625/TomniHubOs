import path from 'node:path';

import type { PolicyDecision } from '../../common/foundation/decisionTypes';

export type TrustOperation = 'agent' | 'cli' | 'filesystem' | 'mcp' | 'network' | 'package' | 'provider';

export type TrustRequest = {
  runId: string;
  taskId: string;
  operation: TrustOperation;
  targetId: string;
  requestedCapabilities: readonly string[];
  workspaceScope: string;
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
};

const DEFAULT_POLICY: TrustPolicy = {
  allowedCapabilities: ['execution.safe', 'target.execute', 'workspace.read'],
  allowedNetworkHosts: [],
  trustedPackageIds: [],
  allowedOrigins: [],
  requireApprovalForMutation: true,
};

export type TrustOriginRequest = Pick<TrustRequest, 'runId' | 'taskId' | 'targetId'> & { origin: string };
export type FinalEgressRequest = TrustRequest & { origin: string; serializedPayload: string };

const isWithinWorkspace = (workspaceScope: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(workspaceScope), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const isMutating = (capability: string): boolean => capability.endsWith('.write') || capability.endsWith('.delete');

/**
 * Single policy decision point for action authority. It deliberately returns only
 * structured receipts, never credentials or raw action payloads.
 */
export class TrustBroker {
  private readonly policy: TrustPolicy;
  private readonly revokedCapabilities = new Set<string>();

  constructor(policy: Partial<TrustPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  public authorize(request: TrustRequest): PolicyDecision {
    const receiptId = `trust_${request.runId}_${request.taskId}_${request.operation}_${Date.now()}`;
    const base = {
      runId: request.runId,
      taskId: request.taskId,
      targetId: request.targetId,
      capabilities: request.requestedCapabilities,
      receiptId,
    };

    if (
      request.requestedCapabilities.some(
        (capability) =>
          !this.policy.allowedCapabilities.includes(capability) || this.revokedCapabilities.has(capability)
      )
    ) {
      return { ...base, decision: 'deny', reasonCode: 'CAPABILITY_NOT_ALLOWED' };
    }
    if (
      request.operation === 'filesystem' &&
      request.filePath !== undefined &&
      !isWithinWorkspace(request.workspaceScope, request.filePath)
    ) {
      return { ...base, decision: 'deny', reasonCode: 'WORKSPACE_SCOPE_VIOLATION' };
    }
    if (
      request.operation === 'network' &&
      (request.networkHost === undefined || !this.policy.allowedNetworkHosts.includes(request.networkHost))
    ) {
      return { ...base, decision: 'deny', reasonCode: 'NETWORK_HOST_NOT_ALLOWED' };
    }
    if (
      request.operation === 'package' &&
      (request.packageSigned !== true ||
        request.packageId === undefined ||
        !this.policy.trustedPackageIds.includes(request.packageId))
    ) {
      return { ...base, decision: 'deny', reasonCode: 'PACKAGE_NOT_TRUSTED' };
    }
    if (this.policy.requireApprovalForMutation && request.requestedCapabilities.some(isMutating)) {
      return { ...base, decision: 'approval_required', reasonCode: 'MUTATION_REQUIRES_APPROVAL' };
    }
    return { ...base, decision: 'allow', reasonCode: 'TRUST_ALLOWED' };
  }

  /** Unknown renderers, subframes, and package origins are denied before capability evaluation. */
  public authorizeOrigin(request: TrustOriginRequest): PolicyDecision {
    const allowed = this.policy.allowedOrigins.includes(request.origin);
    return {
      runId: request.runId,
      taskId: request.taskId,
      targetId: request.targetId,
      capabilities: [],
      receiptId: `trust_origin_${request.runId}_${Date.now()}`,
      decision: allowed ? 'allow' : 'deny',
      reasonCode: allowed ? 'ORIGIN_ALLOWED' : 'ORIGIN_NOT_ALLOWED',
    };
  }

  public requestCapability(request: TrustRequest, origin: string): PolicyDecision {
    const originDecision = this.authorizeOrigin({ ...request, origin });
    return originDecision.decision === 'allow' ? this.authorize(request) : originDecision;
  }

  /** Final serialized egress is checked separately so model or tool output cannot bypass policy. */
  public inspectFinalEgress(request: FinalEgressRequest): PolicyDecision {
    const originDecision = this.authorizeOrigin(request);
    if (originDecision.decision !== 'allow') return originDecision;
    if (/\b(?:api[_-]?key|password|secret|token)\s*[:=]/iu.test(request.serializedPayload)) {
      return { ...this.authorize(request), decision: 'deny', reasonCode: 'FINAL_EGRESS_SECRET_DETECTED' };
    }
    return this.authorize(request);
  }

  /** Revocation is immediate for all future authorization checks in this runtime. */
  public revoke(capability: string): void {
    this.revokedCapabilities.add(capability);
  }
}
