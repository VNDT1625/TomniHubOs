import { createHash } from 'node:crypto';
import type {
  ContextProjection,
  PolicyDecision,
  SelectionCandidate,
  SelectionDecision,
} from '../../common/foundation/decisionTypes';
import type {
  DurableOutcomeReceiptProjection,
  FoundationEvent,
  OutcomeReceipt,
} from '../../common/foundation/receiptTypes';
import type { RunIntent } from '../../common/foundation/runTypes';
import { assertDelegatedRunIntent, assertRunIntent } from '../../common/foundation/runTypes';
import { redactSecretText } from '../agentRuntime/agentMesh/security/secretFirewall';
import { ChoiceAdapter } from './choiceAdapter';
import { ContextAdapter } from './contextAdapter';
import { EventStore } from './eventStore';
import { ResourceAdapter, type ResourceLease } from './resourceAdapter';
import { SecurityAdapter } from './securityAdapter';
import { TrustBroker, type TrustPolicy } from './trustBroker';

export type RunKernelOptions = {
  eventStore?: EventStore;
  securityAdapter?: SecurityAdapter;
  /** Main-owned composition authority; mutually exclusive with a custom adapter. */
  trustRuntime?: FoundationTrustRuntime;
  contextAdapter?: ContextAdapter;
  choiceAdapter?: ChoiceAdapter;
  resourceAdapter?: ResourceAdapter;
};

export type DelegatedRunResult = {
  parentReceipt: OutcomeReceipt;
  childReceipt: OutcomeReceipt;
};

/**
 * Main-only effect status. A committed effect wins a racing cancellation only
 * when it proves the idempotency identity that the Run owns; unknown effects
 * are terminal failures and are never eligible for automatic replay.
 */
export type RunExecutorEffect =
  | Readonly<{ state: 'committed'; idempotencyKey: string }>
  | Readonly<{ state: 'not_committed' }>
  | Readonly<{ state: 'unknown' }>;

export type RunExecutorResult = Readonly<{
  evidenceRefs: readonly string[];
  effect?: RunExecutorEffect;
}>;

export type RunExecutor = (
  leaseId?: string,
  signal?: AbortSignal,
  targetId?: string,
  activeRun?: ActiveRunExecutionContext
) => Promise<RunExecutorResult>;

export type ActiveRunDelegation = Readonly<{
  childIntent: RunIntent;
  candidates: readonly SelectionCandidate[];
  executor: RunExecutor;
  /** Evidence created before the delegated operation, retained by the parent only. */
  parentEvidence?: readonly string[];
  signal?: AbortSignal;
}>;

/**
 * Opaque Main-process authority scoped to one currently executing parent Run.
 * It cannot be reconstructed from an IPC payload and becomes unusable before
 * the parent terminal event or lease cleanup begins.
 */
export type ActiveRunExecutionContext = Readonly<{
  parentIntent: RunIntent;
  signal?: AbortSignal;
  isActive: () => boolean;
  executeDelegatedChild: (delegation: ActiveRunDelegation) => Promise<OutcomeReceipt>;
}>;

/**
 * Durable Foundation evidence must identify a goal without retaining the
 * user-provided text. Execution keeps the validated intent in memory.
 */
const createGoalAuditProjection = (goal: string): { goalDigest: string; goalProjection: 'redacted' } => ({
  goalDigest: `sha256-${createHash('sha256').update(goal, 'utf8').digest('hex')}`,
  goalProjection: 'redacted',
});

const createOwnerAccountDigest = (accountId: string): string =>
  `sha256-${createHash('sha256').update(accountId, 'utf8').digest('hex')}`;

/**
 * Foundation event journals stay richer than the renderer-facing recovery
 * projection. Account ownership is a Main-only access check, and local
 * workspace/surface metadata is not needed to render the run timeline.
 */
const REDACTED_EVENT_PAYLOAD_KEYS = new Set([
  'ownerAccountDigest',
  'receiptOwnerAccountDigest',
  'workspaceScope',
  'surface',
]);

const redactEventForOwner = (event: FoundationEvent): FoundationEvent =>
  Object.freeze({
    ...event,
    payload: Object.freeze(
      Object.fromEntries(
        Object.entries(event.payload).filter(([key]) => !REDACTED_EVENT_PAYLOAD_KEYS.has(key))
      ) as FoundationEvent['payload']
    ),
  });

const safeReceiptReference = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 200 &&
  /^[A-Za-z0-9._:@/-]+$/.test(value) &&
  !/(secret|token|password|credential|api.?key|private.?key)/i.test(value);

/**
 * Executors are not receipt authorities. Strip unsafe or secret-bearing
 * references before they can enter the transient receipt or durable journal.
 */
const sanitizeExecutorEvidenceRefs = (evidenceRefs: readonly string[]): readonly string[] =>
  Object.freeze([
    ...new Set(evidenceRefs.filter((value) => safeReceiptReference(value) && !redactSecretText(value).redacted)),
  ]);

const receiptProjectionPayload = (receipt: OutcomeReceipt, ownerAccountDigest: string): FoundationEvent['payload'] => ({
  receiptSchemaVersion: 1,
  receiptOwnerAccountDigest: ownerAccountDigest,
  receiptId: receipt.receiptId,
  receiptRunId: receipt.runId,
  receiptParentRunId: receipt.parentRunId,
  receiptTaskId: receipt.taskId,
  receiptSelectionReceiptId: receipt.selectionReceiptId,
  receiptLeaseId: receipt.leaseId,
  receiptStatus: receipt.status,
  receiptEvidenceRefs: receipt.evidenceRefs.filter(safeReceiptReference),
  receiptCreatedAt: receipt.createdAt,
});

const projectionFromTerminalEvent = (event: FoundationEvent): DurableOutcomeReceiptProjection | undefined => {
  const payload = event.payload;
  const status = payload.receiptStatus;
  const requiredStrings = [
    payload.receiptOwnerAccountDigest,
    payload.receiptId,
    payload.receiptRunId,
    payload.receiptTaskId,
    payload.receiptSelectionReceiptId,
  ];
  if (
    payload.receiptSchemaVersion !== 1 ||
    !requiredStrings.slice(0, 4).every((value) => typeof value === 'string' && safeReceiptReference(value)) ||
    typeof payload.receiptSelectionReceiptId !== 'string' ||
    payload.receiptSelectionReceiptId.length > 200 ||
    (status !== 'verified' && status !== 'failed' && status !== 'cancelled' && status !== 'timed_out') ||
    typeof payload.receiptCreatedAt !== 'number' ||
    !Number.isSafeInteger(payload.receiptCreatedAt) ||
    payload.receiptCreatedAt < 0 ||
    !Array.isArray(payload.receiptEvidenceRefs) ||
    !payload.receiptEvidenceRefs.every((value) => typeof value === 'string' && safeReceiptReference(value))
  ) {
    return undefined;
  }
  if (payload.receiptRunId !== event.runId) return undefined;
  if (payload.receiptParentRunId !== undefined && !safeReceiptReference(payload.receiptParentRunId as string))
    return undefined;
  if (payload.receiptLeaseId !== undefined && !safeReceiptReference(payload.receiptLeaseId as string)) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    ownerAccountDigest: payload.receiptOwnerAccountDigest as string,
    receiptId: payload.receiptId as string,
    runId: payload.receiptRunId as string,
    ...(payload.receiptParentRunId === undefined ? {} : { parentRunId: payload.receiptParentRunId as string }),
    taskId: payload.receiptTaskId as string,
    selectionReceiptId: payload.receiptSelectionReceiptId as string,
    ...(payload.receiptLeaseId === undefined ? {} : { leaseId: payload.receiptLeaseId as string }),
    status,
    evidenceRefs: Object.freeze([...(payload.receiptEvidenceRefs as readonly string[])]),
    createdAt: payload.receiptCreatedAt,
  });
};

export class RunKernel {
  public readonly eventStore: EventStore;
  public readonly securityAdapter: SecurityAdapter;
  public readonly contextAdapter: ContextAdapter;
  public readonly choiceAdapter: ChoiceAdapter;
  public readonly resourceAdapter: ResourceAdapter;
  private receiptProjections = new Map<string, DurableOutcomeReceiptProjection>();

  constructor(options: RunKernelOptions = {}) {
    if (options.securityAdapter !== undefined && options.trustRuntime !== undefined) {
      throw new Error('RunKernel accepts either a SecurityAdapter or FoundationTrustRuntime, not both.');
    }
    this.eventStore = options.eventStore ?? new EventStore();
    this.securityAdapter = options.securityAdapter ?? options.trustRuntime?.securityAdapter ?? new SecurityAdapter();
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

  private async terminal(
    intent: RunIntent,
    receipt: OutcomeReceipt,
    eventType: Extract<FoundationEvent['eventType'], 'outcome.verified' | 'run.failed' | 'run.cancelled'>,
    payload: FoundationEvent['payload']
  ): Promise<OutcomeReceipt> {
    if (eventType === 'run.failed') {
      console.error('[RunKernel] run.failed:', JSON.stringify(payload), 'runId:', intent.runId);
    }
    const ownerAccountDigest = createOwnerAccountDigest(intent.userId);
    const projection = projectionFromTerminalEvent({
      eventId: 'projection',
      eventType,
      aggregateId: intent.runId,
      runId: intent.runId,
      taskId: intent.rootTaskId,
      sequence: 0,
      correlationId: intent.correlationId,
      occurredAt: receipt.createdAt,
      schemaVersion: 1,
      payload: receiptProjectionPayload(receipt, ownerAccountDigest),
    });
    if (projection === undefined) throw new Error('FOUNDATION_RECEIPT_PROJECTION_INVALID');
    await this.emit(intent, eventType, { ...payload, ...receiptProjectionPayload(receipt, ownerAccountDigest) });
    this.receiptProjections.set(intent.runId, projection);
    return receipt;
  }

  private recoverReceiptProjections(): void {
    this.receiptProjections.clear();
    for (const event of this.eventStore.getAllEvents()) {
      const projection = projectionFromTerminalEvent(event);
      if (projection !== undefined) this.receiptProjections.set(projection.runId, projection);
    }
  }

  /** Returns a redacted durable receipt only when the supplied Main-owned account matches it. */
  public async getReceiptForAccount(accountId: string, runId: string): Promise<OutcomeReceipt | undefined> {
    if (!accountId.trim() || !runId.trim()) return undefined;
    await this.eventStore.initialize();
    this.recoverReceiptProjections();
    const projection = this.receiptProjections.get(runId);
    if (projection === undefined || projection.ownerAccountDigest !== createOwnerAccountDigest(accountId))
      return undefined;
    return Object.freeze({
      receiptId: projection.receiptId,
      runId: projection.runId,
      ...(projection.parentRunId === undefined ? {} : { parentRunId: projection.parentRunId }),
      taskId: projection.taskId,
      selectionReceiptId: projection.selectionReceiptId,
      ...(projection.leaseId === undefined ? {} : { leaseId: projection.leaseId }),
      status: projection.status,
      evidenceRefs: projection.evidenceRefs,
      createdAt: projection.createdAt,
    });
  }

  /**
   * Returns a renderer-safe timeline only if the durable `run.created` event
   * binds this exact run to the live Main-owned account. Legacy or malformed
   * journals have no owner binding and therefore remain unreadable through IPC.
   */
  public async getEventsForAccount(accountId: string, runId: string): Promise<readonly FoundationEvent[] | undefined> {
    if (!accountId.trim() || !runId.trim()) return undefined;
    await this.eventStore.initialize();
    const events = this.eventStore.getEventsByRunId(runId);
    const createdEvents = events.filter((event) => event.eventType === 'run.created');
    if (createdEvents.length !== 1) return undefined;
    const [created] = createdEvents;
    if (created?.payload.ownerAccountDigest !== createOwnerAccountDigest(accountId)) return undefined;
    return Object.freeze(events.map(redactEventForOwner));
  }

  public async executeRun(
    rawIntent: RunIntent,
    candidates: readonly SelectionCandidate[],
    executor: RunExecutor,
    signal?: AbortSignal
  ): Promise<OutcomeReceipt> {
    const intent = assertRunIntent(rawIntent);
    await this.eventStore.initialize();
    this.recoverReceiptProjections();

    // 1. Run Created
    const createdEvt = await this.emit(intent, 'run.created', {
      ...createGoalAuditProjection(intent.goal),
      ownerAccountDigest: createOwnerAccountDigest(intent.userId),
      surface: intent.surface,
      workspaceScope: intent.workspaceScope,
      parentRunId: intent.parentRunId,
    });
    // A sanitizer result is not an authorization to forward the original goal.
    // Fail closed before projecting it into a prompt or invoking any execution target.
    if (redactSecretText(intent.goal).redacted) {
      console.error('[RunKernel] SENSITIVE_GOAL_DENIED: goal contains unredacted secrets. runId:', intent.runId);
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: '',
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'SENSITIVE_GOAL_DENIED', causation: createdEvt.eventId }
      );
    }
    if (signal?.aborted) {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_cancelled_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: '',
          status: 'cancelled',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.cancelled',
        { reason: 'RUN_ABORTED', causation: createdEvt.eventId }
      );
    }

    // 2. Security Preflight
    let policyDecision: PolicyDecision;
    try {
      policyDecision = await this.securityAdapter.preflightCheck(intent);
    } catch {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: '',
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'SECURITY_PREFLIGHT_FAILED' }
      );
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
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: policyDecision.receiptId,
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'SECURITY_DENIED' }
      );
    }

    // 3. Context Projection
    let contextProj: ContextProjection;
    try {
      contextProj = await this.contextAdapter.projectContext(intent);
    } catch {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: '',
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'CONTEXT_PROJECTION_FAILED' }
      );
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
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: '',
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'CANDIDATE_SELECTION_FAILED' }
      );
    }
    await this.emit(intent, 'selection.decided', {
      selectedId: selection.selectedId ?? 'none',
      explanation: selection.explanation,
      receiptId: selection.receiptId,
    });

    if (!selection.selectedId) {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: selection.receiptId,
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'NO_CANDIDATE_SELECTED' }
      );
    }
    const selectedCandidate = candidates.find((candidate) => candidate.id === selection.selectedId);
    const estimatedCostMB = selectedCandidate?.estimatedCostMB ?? 128;
    const executionPriority = selectedCandidate?.priority ?? 1;

    // 5. Target Security Preflight
    let targetPolicy: PolicyDecision;
    try {
      targetPolicy = await this.securityAdapter.targetPreflight(intent, selection.selectedId);
    } catch {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          taskId: intent.rootTaskId,
          selectionReceiptId: selection.receiptId,
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'TARGET_SECURITY_PREFLIGHT_FAILED' }
      );
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
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: selection.receiptId,
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'TARGET_SECURITY_DENIED' }
      );
    }

    if (intent.budget !== undefined && intent.budget.maxEstimatedCostMB < estimatedCostMB) {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: selection.receiptId,
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'RUN_BUDGET_EXCEEDED' }
      );
    }
    if (signal?.aborted) {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_cancelled_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: selection.receiptId,
          status: 'cancelled',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.cancelled',
        { reason: 'RUN_ABORTED' }
      );
    }

    // 6. Resource Lease Request & Grant
    await this.emit(intent, 'lease.requested', { candidateId: selection.selectedId });
    let lease: ResourceLease;
    try {
      lease = await this.resourceAdapter.requestLease(
        {
          runId: intent.runId,
          taskId: intent.rootTaskId,
          candidateId: selection.selectedId,
          resourceKind: 'agent.execution',
          estimatedCostMB,
          priority: executionPriority,
        },
        signal
      );
    } catch {
      return this.terminal(
        intent,
        {
          receiptId: `rcpt_fail_${intent.runId}_${Date.now()}`,
          runId: intent.runId,
          parentRunId: intent.parentRunId,
          taskId: intent.rootTaskId,
          selectionReceiptId: selection.receiptId,
          status: 'failed',
          evidenceRefs: [],
          createdAt: Date.now(),
        },
        'run.failed',
        { reason: 'RESOURCE_LEASE_REJECTED' }
      );
    }
    await this.emit(intent, 'lease.granted', { leaseId: lease.leaseId });

    // 7. Execution and lease cleanup. A terminal event is emitted only after
    // every lease is released, so replay never observes activity after a terminal state.
    let evidenceRefs: readonly string[] = [];
    let status: Extract<OutcomeReceipt['status'], 'verified' | 'failed' | 'cancelled' | 'timed_out'> = 'verified';
    let failureReason: string | undefined;
    let effectState: RunExecutorEffect['state'] = 'not_committed';
    let active = true;
    const delegatedEvidenceRefs: string[] = [];
    const activeRun: ActiveRunExecutionContext = {
      parentIntent: intent,
      signal,
      isActive: () => active && !signal?.aborted,
      executeDelegatedChild: async ({
        childIntent,
        candidates: childCandidates,
        executor: childExecutor,
        parentEvidence = [],
        signal: childSignal,
      }) => {
        if (!active || signal?.aborted) throw new Error('ACTIVE_RUN_SCOPE_INACTIVE');
        const boundedChild = assertDelegatedRunIntent(intent, childIntent);
        const childReceipt = await this.executeRun(boundedChild, childCandidates, childExecutor, childSignal ?? signal);
        if (childReceipt.status !== 'verified') throw new Error('Delegated child did not verify.');
        delegatedEvidenceRefs.push(
          ...parentEvidence,
          `child-receipt:${childReceipt.receiptId}`,
          ...childReceipt.evidenceRefs
        );
        return childReceipt;
      },
    };

    try {
      await this.emit(intent, 'execution.started', { leaseId: lease.leaseId });
      const result = await executor(lease.leaseId, signal, selection.selectedId, activeRun);
      if (result.effect?.state === 'committed' && result.effect.idempotencyKey !== intent.correlationId) {
        throw new Error('COMMITTED_EFFECT_IDEMPOTENCY_MISMATCH');
      }
      effectState = result.effect?.state ?? 'not_committed';
      evidenceRefs = sanitizeExecutorEvidenceRefs([...result.evidenceRefs, ...delegatedEvidenceRefs]);
      await this.emit(intent, 'evidence.recorded', { count: evidenceRefs.length });
    } catch {
      status = 'failed';
      failureReason = 'EXECUTION_THREW_ERROR';
    } finally {
      active = false;
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

    if (effectState === 'unknown' && status === 'verified') {
      status = 'failed';
      failureReason = 'EFFECT_OUTCOME_UNKNOWN';
    }
    if (signal?.aborted && effectState !== 'committed') status = 'cancelled';
    const receipt: OutcomeReceipt = {
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
    if (status === 'cancelled') return this.terminal(intent, receipt, 'run.cancelled', { reason: 'RUN_ABORTED' });
    if (status === 'verified') return this.terminal(intent, receipt, 'outcome.verified', { status: 'verified' });
    return this.terminal(intent, receipt, 'run.failed', { reason: failureReason ?? 'EXECUTION_FAILED' });
  }

  /** Executes a child run only after proving it cannot exceed the parent's grant. */
  public async executeDelegatedRun(
    parentIntent: RunIntent,
    childIntent: RunIntent,
    candidates: readonly SelectionCandidate[],
    executor: RunExecutor,
    signal?: AbortSignal
  ): Promise<OutcomeReceipt> {
    return this.executeRun(assertDelegatedRunIntent(parentIntent, childIntent), candidates, executor, signal);
  }

  /**
   * Executes a bounded child while the parent Run is still active, then records
   * the immutable child receipt as parent evidence before the parent terminal event.
   */
  public async executeRunWithChild(
    parentIntent: RunIntent,
    parentCandidates: readonly SelectionCandidate[],
    childIntent: RunIntent,
    childCandidates: readonly SelectionCandidate[],
    childExecutor: RunExecutor,
    parentEvidence: readonly string[] = [],
    signal?: AbortSignal
  ): Promise<DelegatedRunResult> {
    // A replay after process restart may carry the same parent/child run IDs.
    // Return the durable pair only when it preserves this exact delegated lineage;
    // never append another terminal lifecycle or invoke the child effect again.
    const recoveredParentReceipt = await this.getReceiptForAccount(parentIntent.userId, parentIntent.runId);
    const recoveredChildReceipt = await this.getReceiptForAccount(parentIntent.userId, childIntent.runId);
    if (recoveredParentReceipt !== undefined || recoveredChildReceipt !== undefined) {
      assertDelegatedRunIntent(parentIntent, childIntent);
      if (
        recoveredParentReceipt === undefined ||
        recoveredChildReceipt === undefined ||
        recoveredChildReceipt.parentRunId !== recoveredParentReceipt.runId ||
        !recoveredParentReceipt.evidenceRefs.includes(`child-receipt:${recoveredChildReceipt.receiptId}`)
      ) {
        throw new Error('FOUNDATION_DELEGATED_RECEIPT_LINEAGE_INVALID');
      }
      return { parentReceipt: recoveredParentReceipt, childReceipt: recoveredChildReceipt };
    }

    let childReceipt: OutcomeReceipt | undefined;
    const parentReceipt = await this.executeRun(
      parentIntent,
      parentCandidates,
      async () => {
        childReceipt = await this.executeDelegatedRun(
          parentIntent,
          childIntent,
          childCandidates,
          childExecutor,
          signal
        );
        if (childReceipt.status !== 'verified') throw new Error('Delegated child did not verify.');
        return {
          evidenceRefs: [...parentEvidence, `child-receipt:${childReceipt.receiptId}`, ...childReceipt.evidenceRefs],
        };
      },
      signal
    );
    if (childReceipt === undefined) throw new Error('Parent execution did not create a delegated child receipt.');
    return { parentReceipt, childReceipt };
  }
}

export type FoundationTrustRuntimeOptions = Readonly<{
  /** A policy authority is supplied by Main composition, never an IPC caller. */
  trustBroker?: TrustBroker;
  /** Constructing a broker is allowed only from a complete Main-owned policy. */
  policy?: TrustPolicy;
  /** Resolves the authenticated Main subject at the point a run starts. */
  actorId: () => string;
}>;

/**
 * Binds a Foundation RunKernel and every later governed execution scope to the
 * same Main-owned TrustBroker. It deliberately has no renderer construction
 * path: a missing policy, actor drift, policy-version drift, bad origin, or
 * revocation fails before a target is selected or started.
 */
export class FoundationTrustRuntime {
  public readonly trustBroker: TrustBroker;
  public readonly securityAdapter: SecurityAdapter;
  private revokedReason: string | undefined;

  public constructor(private readonly options: FoundationTrustRuntimeOptions) {
    if ((options.trustBroker === undefined) === (options.policy === undefined)) {
      throw new Error('FOUNDATION_TRUST_POLICY_REQUIRED');
    }
    this.trustBroker = options.trustBroker ?? new TrustBroker(options.policy);
    this.securityAdapter = new SecurityAdapter(this.trustBroker);
  }

  public get policyVersion(): string {
    return this.trustBroker.policyVersion;
  }

  /** Resolves the authenticated Main actor bound to every governed Run. */
  public get actorId(): string {
    const actorId = this.options.actorId();
    if (!actorId.trim()) throw new Error('FOUNDATION_TRUST_RUNTIME_ACTOR_REQUIRED');
    return actorId;
  }

  /** Creates a kernel whose preflight has exactly this runtime's broker identity. */
  public createRunKernel(options: Omit<RunKernelOptions, 'securityAdapter' | 'trustRuntime'> = {}): RunKernel {
    return new RunKernel({ ...options, trustRuntime: this });
  }

  /** Stops future starts without relying on a grant that may not yet exist. */
  public revoke(reason: string): void {
    this.revokedReason = reason.trim() || 'FOUNDATION_TRUST_RUNTIME_REVOKED';
  }

  /** Main-only boundary assertion before any RunKernel lifecycle event or target selection. */
  public async assertRunStart(kernel: RunKernel, intent: RunIntent, origin: string): Promise<void> {
    if (this.revokedReason !== undefined) throw new Error(`FOUNDATION_TRUST_RUNTIME_REVOKED:${this.revokedReason}`);
    if (kernel.securityAdapter.trustBroker !== this.trustBroker) {
      throw new Error('FOUNDATION_TRUST_RUNTIME_KERNEL_MISMATCH');
    }
    const actorId = this.actorId;
    if (actorId !== intent.userId) throw new Error('FOUNDATION_TRUST_RUNTIME_ACTOR_MISMATCH');
    if (intent.policyVersion !== this.policyVersion) throw new Error('FOUNDATION_TRUST_RUNTIME_POLICY_MISMATCH');
    const originDecision = await this.trustBroker.authorizeOrigin({
      runId: intent.runId,
      taskId: intent.rootTaskId,
      actorId,
      targetId: intent.surface,
      policyVersion: intent.policyVersion,
      origin,
    });
    if (originDecision.decision !== 'allow')
      throw new Error(`FOUNDATION_TRUST_RUNTIME_ORIGIN_DENIED:${originDecision.reasonCode}`);
  }
}
