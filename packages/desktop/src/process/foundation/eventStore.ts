import type { FoundationEvent } from '../../common/foundation/receiptTypes';
import { createEvent } from '../../common/foundation/receiptTypes';
import type { DurableEventPayload, DurableEventStore } from '../services/agentChat/durability';

const FOUNDATION_DURABLE_SESSION_ID = 'foundation.run-kernel';
const TERMINAL_EVENT_TYPES = new Set<FoundationEvent['eventType']>(['outcome.verified', 'run.cancelled', 'run.failed']);

export type EventStoreOptions = {
  journal?: DurableEventStore;
};

export class EventStore {
  private events: FoundationEvent[] = [];
  private idempotencyKeys = new Set<string>();
  private terminalRunIds = new Set<string>();
  private initialized = false;
  private initialization: Promise<void> | undefined;

  public constructor(private readonly options: EventStoreOptions = {}) {}

  public initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    this.initialization ??= this.initializeOnce().catch((error: unknown) => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    if (!this.options.journal) {
      this.initialized = true;
      return;
    }

    await this.options.journal.initialize();
    const entries = await this.options.journal.query({ sessionId: FOUNDATION_DURABLE_SESSION_ID, limit: 10_000 });
    const recovered = entries
      .map((entry) => foundationEventFromDurablePayload(entry.payload))
      .filter((event): event is FoundationEvent => event !== undefined);
    this.events = recovered.toSorted(
      (left, right) => left.occurredAt - right.occurredAt || left.sequence - right.sequence
    );
    this.terminalRunIds = new Set(
      this.events.filter((event) => TERMINAL_EVENT_TYPES.has(event.eventType)).map((event) => event.runId)
    );
    this.initialized = true;
  }

  public append(event: FoundationEvent, idempotencyKey?: string): FoundationEvent {
    const validated = this.validateAppend(event, idempotencyKey);
    this.commit(validated, idempotencyKey);
    return validated;
  }

  public async appendDurably(event: FoundationEvent, idempotencyKey?: string): Promise<FoundationEvent> {
    const validated = this.validateAppend(event, idempotencyKey);
    if (this.options.journal) {
      await this.options.journal.append({
        sessionId: FOUNDATION_DURABLE_SESSION_ID,
        requestId: validated.runId,
        kind: 'custom',
        visibility: 'private',
        payload: { foundationEvent: validated as unknown as DurableEventPayload },
      });
    }
    this.commit(validated, idempotencyKey);
    return validated;
  }

  private validateAppend(event: FoundationEvent, idempotencyKey?: string): FoundationEvent {
    if (idempotencyKey) {
      if (this.idempotencyKeys.has(idempotencyKey)) {
        throw new Error(`Duplicate event idempotency key: ${idempotencyKey}`);
      }
    }
    if (this.terminalRunIds.has(event.runId)) {
      throw new Error(`Cannot append event after terminal state for run: ${event.runId}`);
    }
    return createEvent(event);
  }

  private commit(validated: FoundationEvent, idempotencyKey?: string): void {
    if (idempotencyKey) this.idempotencyKeys.add(idempotencyKey);
    this.events.push(validated);
    if (TERMINAL_EVENT_TYPES.has(validated.eventType)) this.terminalRunIds.add(validated.runId);
  }

  public getEventsByRunId(runId: string): readonly FoundationEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  public getNextSequence(runId: string): number {
    const runEvents = this.getEventsByRunId(runId);
    return runEvents.length;
  }

  public clear(): void {
    this.events = [];
    this.idempotencyKeys.clear();
    this.terminalRunIds.clear();
  }
}

const foundationEventFromDurablePayload = (payload: DurableEventPayload): FoundationEvent | undefined => {
  if (!isRecord(payload) || !isRecord(payload.foundationEvent)) return undefined;
  const value = payload.foundationEvent;
  const sequence = value.sequence;
  const occurredAt = value.occurredAt;
  const schemaVersion = value.schemaVersion;
  if (
    typeof value.eventId !== 'string' ||
    typeof value.eventType !== 'string' ||
    typeof value.aggregateId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    typeof value.correlationId !== 'string' ||
    typeof occurredAt !== 'number' ||
    !Number.isFinite(occurredAt) ||
    typeof schemaVersion !== 'number' ||
    !Number.isSafeInteger(schemaVersion) ||
    !isRecord(value.payload)
  ) {
    return undefined;
  }

  try {
    return createEvent({
      eventId: value.eventId,
      eventType: value.eventType as FoundationEvent['eventType'],
      aggregateId: value.aggregateId,
      runId: value.runId,
      taskId: typeof value.taskId === 'string' ? value.taskId : undefined,
      sequence,
      causationId: typeof value.causationId === 'string' ? value.causationId : undefined,
      correlationId: value.correlationId,
      occurredAt,
      schemaVersion,
      payload: value.payload as FoundationEvent['payload'],
    });
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
