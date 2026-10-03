import { describe, expect, it } from 'vitest';
import { completeOutbox, leaseOutbox } from '../src/outbox.js';
describe('outbox leasing', () => {
  it('recovers expired lease and completes once', () => {
    const event = {
      id: '1',
      topic: 'catalog',
      aggregateId: 'a',
      payload: {},
      state: 'leased' as const,
      attempts: 1,
      leaseUntil: 1,
    };
    const leased = leaseOutbox([event], 2, 10)[0]!;
    expect(leased.attempts).toBe(2);
    expect(completeOutbox(leased).state).toBe('delivered');
  });
});
