import type { PolicyDecision } from '../../common/foundation/decisionTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import { inspectOutboundText } from '../services/security/outboundTextInspection';
import type { OutboundInspectionRequest, OutboundPolicyContext } from '../services/security/types';
import { TrustBroker } from './trustBroker';

export class SecurityAdapter {
  public constructor(private readonly trustBroker = new TrustBroker()) {}

  public async preflightCheck(intent: RunIntent): Promise<PolicyDecision> {
    const request: OutboundInspectionRequest = {
      schemaVersion: 1,
      requestId: `req_${intent.runId}_${Date.now()}`,
      runId: intent.runId,
      taskId: intent.rootTaskId,
      actorId: intent.userId,
      surface: 'agent',
      target: { kind: 'foundation.preflight', id: intent.surface },
      parts: [
        { id: 'part_goal', text: intent.goal, role: 'user', source: 'user' },
        ...intent.constraints.map((c, i) => ({
          id: `part_constraint_${i}`,
          text: c,
          role: 'user' as const,
          source: 'user' as const,
        })),
      ],
      sensitivity: 'normal',
    };

    const context: OutboundPolicyContext = {
      allowSanitize: true,
      requireApprovalForFindings: false,
      policyVersion: intent.policyVersion,
      now: () => Date.now(),
      createReceiptId: () => `sec_rcpt_${intent.runId}_${Date.now()}`,
    };

    const inspection = await inspectOutboundText(request, context);

    const isBlocked = inspection.decision === 'block' || inspection.decision === 'failed_closed';
    const isApproval = inspection.decision === 'approval_required';

    if (isBlocked || isApproval) {
      return {
        decision: isBlocked ? 'deny' : 'approval_required',
        runId: intent.runId,
        taskId: intent.rootTaskId,
        capabilities: intent.capabilityGrant ?? ['workspace.read', 'execution.safe'],
        reasonCode: inspection.reasonCode,
        receiptId: inspection.receipt.receiptId,
      };
    }
    return this.trustBroker.authorize({
      runId: intent.runId,
      taskId: intent.rootTaskId,
      operation: 'agent',
      targetId: intent.surface,
      requestedCapabilities: intent.capabilityGrant ?? ['workspace.read', 'execution.safe'],
      workspaceScope: intent.workspaceScope,
    });
  }

  public async targetPreflight(intent: RunIntent, targetId: string): Promise<PolicyDecision> {
    return this.trustBroker.authorize({
      runId: intent.runId,
      taskId: intent.rootTaskId,
      operation: 'agent',
      targetId,
      requestedCapabilities: ['target.execute'],
      workspaceScope: intent.workspaceScope,
    });
  }
}
