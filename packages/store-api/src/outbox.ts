export type OutboxState = 'pending' | 'leased' | 'delivered' | 'dead';
export type OutboxEvent = Readonly<{
  id: string;
  topic: string;
  aggregateId: string;
  payload: unknown;
  state: OutboxState;
  attempts: number;
  leaseUntil?: number;
}>;
export const leaseOutbox = (events: readonly OutboxEvent[], now = Date.now(), leaseMs = 30_000): OutboxEvent[] =>
  events
    .filter((e) => e.state === 'pending' || (e.state === 'leased' && Boolean(e.leaseUntil && e.leaseUntil <= now)))
    .map((e) => ({ ...e, state: 'leased', attempts: e.attempts + 1, leaseUntil: now + leaseMs }));

export const completeOutbox = (event: OutboxEvent): OutboxEvent => ({
  ...event,
  state: 'delivered',
  leaseUntil: undefined,
});
