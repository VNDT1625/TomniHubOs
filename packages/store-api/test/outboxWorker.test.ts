import { describe, expect, it } from 'vitest';
import { createOutboxWorker } from '../src/outboxWorker.js';
describe('outbox worker', () => {
  it('dispatches failure and supports stop', async () => {
    const calls: string[] = [];
    const client = {
      query: async () => ({
        rows: [{ outbox_id: '1', topic: 'x', aggregate_id: 'a', payload_json: {}, attempts: 1, lease_until: null }],
        rowCount: 1,
      }),
      release: () => {},
    };
    const pool = {
      connect: async () => client,
      query: async (q: string) => {
        calls.push(q);
        return { rows: [], rowCount: 1 };
      },
    } as never;
    const worker = createOutboxWorker(
      pool,
      {
        x: async () => {
          throw new Error('boom');
        },
      },
      'w',
      1000
    );
    expect(await worker.runOnce()).toBe(1);
    expect(calls.some((q) => q.includes('state=CASE'))).toBe(true);
    worker.start();
    worker.stop();
    expect(await worker.runOnce()).toBe(0);
  });
});
