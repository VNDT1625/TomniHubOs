import type { FoundationEvent } from '../../common/foundation/receiptTypes';
import { createEvent } from '../../common/foundation/receiptTypes';

export class EventStore {
  private events: FoundationEvent[] = [];
  private idempotencyKeys = new Set<string>();

  public append(event: FoundationEvent, idempotencyKey?: string): FoundationEvent {
    if (idempotencyKey) {
      if (this.idempotencyKeys.has(idempotencyKey)) {
        throw new Error(`Duplicate event idempotency key: ${idempotencyKey}`);
      }
      this.idempotencyKeys.add(idempotencyKey);
    }
    const validated = createEvent(event);
    this.events.push(validated);
    return validated;
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
  }
}
