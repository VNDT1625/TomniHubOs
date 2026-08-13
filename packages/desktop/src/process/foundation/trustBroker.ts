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
  requireApprovalForMutation: boolean;
};

const DEFAULT_POLICY: TrustPolicy = {
  allowedCapabilities: ['execution.safe', 'target.execute', 'workspace.read'],
  allowedNetworkHosts: [],
  trustedPackageIds: [],
  requireApprovalForMutation: true,
};

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

    if (request.requestedCapabilities.some((capability) => !this.policy.allowedCapabilities.includes(capability))) {
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
}
