import type {
  ContextProjection,
  PolicyDecision,
  SelectionCandidate,
  SelectionDecision,
} from '../../common/foundation/decisionTypes';
import type { FoundationEvent, OutcomeReceipt } from '../../common/foundation/receiptTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import { assertDelegatedRunIntent, assertRunIntent } from '../../common/foundation/runTypes';
import { ChoiceAdapter } from './choiceAdapter';
import { ContextAdapter } from './contextAdapter';
import { EventStore } from './eventStore';
import { ResourceAdapter, type ResourceLease } from './resourceAdapter';
import { SecurityAdapter } from './securityAdapter';

export type RunKernelOptions = {
  eventStore?: EventStore;
  securityAdapter?: SecurityAdapter;
  contextAdapter?: ContextAdapter;
  choiceAdapter?: ChoiceAdapter;
  resourceAdapter?: ResourceAdapter;
};

export class RunKernel {
  public readonly eventStore: EventStore;
  public readonly securityAdapter: SecurityAdapter;
  public readonly contextAdapter: ContextAdapter;
  public readonly choiceAdapter: ChoiceAdapter;
  public readonly resourceAdapter: ResourceAdapter;

  constructor(options: RunKernelOptions = {}) {
    this.eventStore = options.eventStore ?? new EventStore();
    this.securityAdapter = options.securityAdapter ?? new SecurityAdapter();
    this.contextAdapter = options.contextAdapter ?? new ContextAdapter();
    this.choiceAdapter = options.choiceAdapter ?? new ChoiceAdapter();
    this.resourceAdapter = options.resourceAdapter ?? new ResourceAdapter();
  }

  private emit(
    intent: RunIntent,
    eventType: FoundationEvent['eventType'],
    payload: FoundationEvent['payload'],
    causationId?: string
  ): Promise<FoundationEvent> {
    const seq = this.eventStore.getNextSequence(intent.runId);
    const eventId = `evt_${intent.runId}_${seq}_${Date.now()}`;
    return this.eventStore.appendDurably({
      eventId,
      eventType,
      aggregateId: intent.runId,
      runId: intent.runId,
      taskId: intent.rootTaskId,
      sequence: seq,
      causationId,
      correlationId: intent.correlationId,
      occurredAt: Date.now(),
      schemaVersion: 1,
      payload,
    });
  }

  public async executeRun(
    rawIntent: RunIntent,
    candidates: readonly SelectionCandidate[],
    executor: (
      leaseId?: string,
      signal?: AbortSignal,
      targetId?: string
    ) => Promise<{ evidenceRefs: readonly string[] }>,
    signal?: AbortSignal
  ): Promise<OutcomeReceipt> {
    const intent = assertRunIntent(rawIntent);
    await this.eventStore.initialize();

    // 1. Run Created
    const createdEvt = await this.emit(intent, 'run.created', {
      goal: intent.goal,
      surface: intent.surface,
      workspaceScope: intent.workspaceScope,
      parentRunId: intent.parentRunId,
    });
    if (signal?.aborted) {
      await this.emit(intent, 'run.cancelled', { reason: 'RUN_ABORTED' }, createdEvt.eventId);
      return {
        receiptId: `rcpt_cancelled_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: '',
        status: 'cancelled',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    // 2. Security Preflight
    let policyDecision: PolicyDecision;
    try {
      policyDecision = await this.securityAdapter.preflightCheck(intent);
    } catch {
      await this.emit(intent, 'run.failed', { reason: 'SECURITY_PREFLIGHT_FAILED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: '',
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }
    await this.emit(
      intent,
      'policy.decided',
      {
        decision: policyDecision.decision,
        reasonCode: policyDecision.reasonCode,
        receiptId: policyDecision.receiptId,
      },
      createdEvt.eventId
    );

    if (policyDecision.decision === 'approval_required') {
      const approval = {
        stage: 'preflight' as const,
        decisionReceiptId: policyDecision.receiptId,
        reasonCode: policyDecision.reasonCode,
        capabilities: policyDecision.capabilities,
        expiresAt: policyDecision.expiresAt,
      };
      await this.emit(intent, 'approval.required', approval);
      return {
        receiptId: `rcpt_approval_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: policyDecision.receiptId,
        status: 'approval_required',
        approval,
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    if (policyDecision.decision === 'deny') {
      await this.emit(intent, 'run.failed', { reason: 'SECURITY_DENIED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: policyDecision.receiptId,
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    // 3. Context Projection
    let contextProj: ContextProjection;
    try {
      contextProj = await this.contextAdapter.projectContext(intent);
    } catch {
      await this.emit(intent, 'run.failed', { reason: 'CONTEXT_PROJECTION_FAILED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: '',
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }
    await this.emit(intent, 'context.projected', {
      maxChars: contextProj.maxChars,
      sensitivity: contextProj.sensitivity,
    });

    // 4. Candidate Selection
    let selection: SelectionDecision;
    try {
      selection = await this.choiceAdapter.selectCandidate(intent, candidates);
    } catch {
      await this.emit(intent, 'run.failed', { reason: 'CANDIDATE_SELECTION_FAILED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: '',
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }
    await this.emit(intent, 'selection.decided', {
      selectedId: selection.selectedId ?? 'none',
      explanation: selection.explanation,
      receiptId: selection.receiptId,
    });

    if (!selection.selectedId) {
      await this.emit(intent, 'run.failed', { reason: 'NO_CANDIDATE_SELECTED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    // 5. Target Security Preflight
    let targetPolicy: PolicyDecision;
    try {
      targetPolicy = await this.securityAdapter.targetPreflight(intent, selection.selectedId);
    } catch {
      await this.emit(intent, 'run.failed', { reason: 'TARGET_SECURITY_PREFLIGHT_FAILED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }
    if (targetPolicy.decision === 'approval_required') {
      const approval = {
        stage: 'target-preflight' as const,
        decisionReceiptId: targetPolicy.receiptId,
        reasonCode: targetPolicy.reasonCode,
        targetId: selection.selectedId,
        capabilities: targetPolicy.capabilities,
        expiresAt: targetPolicy.expiresAt,
      };
      await this.emit(intent, 'approval.required', approval);
      return {
        receiptId: `rcpt_approval_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'approval_required',
        approval,
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    if (targetPolicy.decision === 'deny') {
      await this.emit(intent, 'run.failed', { reason: 'TARGET_SECURITY_DENIED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    if (intent.budget !== undefined && intent.budget.maxEstimatedCostMB < 128) {
      await this.emit(intent, 'run.failed', { reason: 'RUN_BUDGET_EXCEEDED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }
    if (signal?.aborted) {
      await this.emit(intent, 'run.cancelled', { reason: 'RUN_ABORTED' });
      return {
        receiptId: `rcpt_cancelled_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'cancelled',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }

    // 6. Resource Lease Request & Grant
    await this.emit(intent, 'lease.requested', { candidateId: selection.selectedId });
    let lease: ResourceLease;
    try {
      lease = await this.resourceAdapter.requestLease({
        runId: intent.runId,
        taskId: intent.rootTaskId,
        candidateId: selection.selectedId,
        resourceKind: 'agent.execution',
        estimatedCostMB: 128,
        priority: 1,
      });
    } catch {
      await this.emit(intent, 'run.failed', { reason: 'RESOURCE_LEASE_REJECTED' });
      return {
        receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
        runId: intent.runId,
        parentRunId: intent.parentRunId,
        taskId: intent.rootTaskId,
        selectionReceiptId: selection.receiptId,
        status: 'failed',
        evidenceRefs: [],
        createdAt: Date.now(),
      };
    }
    await this.emit(intent, 'lease.granted', { leaseId: lease.leaseId });

    // 7. Execution and lease cleanup. A terminal event is emitted only after
    // every lease is released, so replay never observes activity after a terminal state.
    let evidenceRefs: readonly string[] = [];
    let status: OutcomeReceipt['status'] = 'verified';
    let failureReason: string | undefined;

    try {
      await this.emit(intent, 'execution.started', { leaseId: lease.leaseId });
      const result = await executor(lease.leaseId, signal, selection.selectedId);
      evidenceRefs = result.evidenceRefs;
      await this.emit(intent, 'evidence.recorded', { count: evidenceRefs.length });
    } catch {
      status = 'failed';
      failureReason = 'EXECUTION_THREW_ERROR';
    } finally {
      try {
        const released = await this.resourceAdapter.releaseLease(lease.leaseId);
        if (released) {
          await this.emit(intent, 'lease.released', { leaseId: lease.leaseId });
        } else {
          status = 'failed';
          failureReason = 'LEASE_RELEASE_FAILED';
        }
      } catch {
        status = 'failed';
        failureReason = 'LEASE_RELEASE_FAILED';
      }
    }

    if (signal?.aborted) {
      status = 'cancelled';
      await this.emit(intent, 'run.cancelled', { reason: 'RUN_ABORTED' });
    } else if (status === 'verified') {
      await this.emit(intent, 'outcome.verified', { status: 'verified' });
    } else {
      await this.emit(intent, 'run.failed', { reason: failureReason ?? 'EXECUTION_FAILED' });
    }

    return {
      receiptId: `rcpt_${intent.runId}_${Date.now()}`,
      runId: intent.runId,
      parentRunId: intent.parentRunId,
      taskId: intent.rootTaskId,
      selectionReceiptId: selection.receiptId,
      leaseId: lease.leaseId,
      status,
      evidenceRefs,
      createdAt: Date.now(),
    };
  }

  /** Executes a child run only after proving it cannot exceed the parent's grant. */
  public async executeDelegatedRun(
    parentIntent: RunIntent,
    childIntent: RunIntent,
    candidates: readonly SelectionCandidate[],
    executor: (
      leaseId?: string,
      signal?: AbortSignal,
      targetId?: string
    ) => Promise<{ evidenceRefs: readonly string[] }>,
    signal?: AbortSignal
  ): Promise<OutcomeReceipt> {
    return this.executeRun(assertDelegatedRunIntent(parentIntent, childIntent), candidates, executor, signal);
  }
}
