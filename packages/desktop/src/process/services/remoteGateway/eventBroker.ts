import type { TomniRemoteEvent, TomniRemoteEventPayload } from './types';

export class TomniRemoteEventBroker {
  private readonly listeners = new Set<(event: TomniRemoteEvent) => void>();
  private readonly history: TomniRemoteEvent[] = [];
  private sequence = 0;

  public constructor(private readonly historyLimit = 1_024) {}

  public publish(event: TomniRemoteEventPayload): TomniRemoteEvent {
    const envelope = { sequence: ++this.sequence, timestamp: Date.now(), ...event };
    this.history.push(envelope);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    for (const listener of this.listeners) listener(envelope);
    return envelope;
  }

  public after(sequence: number): TomniRemoteEvent[] {
    return this.history.filter((event) => event.sequence > sequence);
  }

  public subscribe(listener: (event: TomniRemoteEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public latestSequence(): number {
    return this.sequence;
  }
}
