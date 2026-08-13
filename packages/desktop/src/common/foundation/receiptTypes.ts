export type FoundationEventType =
  | 'run.created'
  | 'policy.decided'
  | 'context.projected'
  | 'selection.decided'
  | 'lease.requested'
  | 'lease.granted'
  | 'lease.released'
  | 'execution.started'
  | 'evidence.recorded'
  | 'outcome.verified'
  | 'approval.required'
  | 'run.failed'
  | 'run.cancelled';

export type FoundationEvent = {
  eventId: string;
  eventType: FoundationEventType;
  aggregateId: string;
  runId: string;
  taskId?: string;
  sequence: number;
  causationId?: string;
  correlationId: string;
  occurredAt: number;
  schemaVersion: number;
  payload: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;
};

export type ApprovalRequirement = {
  stage: 'preflight' | 'target-preflight';
  decisionReceiptId: string;
  reasonCode: string;
  targetId?: string;
  capabilities: readonly string[];
  expiresAt?: number;
};

export type OutcomeReceipt = {
  receiptId: string;
  runId: string;
  taskId: string;
  selectionReceiptId: string;
  leaseId?: string;
  status: 'verified' | 'failed' | 'cancelled' | 'timed_out' | 'approval_required';
  approval?: ApprovalRequirement;
  evidenceRefs: readonly string[];
  createdAt: number;
};

const forbidden = /(secret|token|password|credential|api.?key|private.?key)/i;

export const assertSafePayload = (payload: FoundationEvent['payload']): FoundationEvent['payload'] => {
  for (const key of Object.keys(payload)) {
    if (forbidden.test(key)) throw new Error(`Unsafe event payload key: ${key}`);
    const value = payload[key];
    if (typeof value === 'string' && forbidden.test(value)) {
      throw new Error('Unsafe event payload value.');
    }
  }
  return payload;
};

export const createEvent = (event: FoundationEvent): FoundationEvent => {
  if (!Number.isSafeInteger(event.schemaVersion) || event.schemaVersion < 1) {
    throw new Error('Unsupported foundation event schema.');
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new Error('Invalid event sequence.');
  assertSafePayload(event.payload);
  return event;
};
