import { describe, expect, it } from 'vitest';
import { claimOutbox, completeOutboxRow, failOutboxRow } from '../src/outboxRepository.js';
describe('durable outbox repository', () => {
  it('claims with lease and supports completion/failure transitions', async () => {
    const queries: string[] = [];
    const client = {
      query: async (q: string) => {
        queries.push(q);
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const pool = {
      connect: async () => client,
      query: async (q: string) => {
        queries.push(q);
        return { rows: [], rowCount: 1 };
      },
    } as never;
    expect(await claimOutbox(pool, 'worker-a')).toEqual([]);
    await completeOutboxRow(pool, 'id');
    await failOutboxRow(pool, 'id', 'boom');
    expect(queries.some((q) => q.includes('SKIP LOCKED'))).toBe(true);
    expect(queries.some((q) => q.includes("state='delivered'"))).toBe(true);
  });
});
