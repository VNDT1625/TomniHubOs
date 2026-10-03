import { describe, expect, it } from 'vitest';
import { createRecoveryWorker } from '../src/recoveryWorker.js';

describe('durable recovery worker', () => {
  it('leases and completes a recovery job after handler success', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('WITH candidates'))
          return {
            rowCount: 1,
            rows: [
              {
                recovery_job_id: 'job-1',
                job_type: 'payment-reconciliation',
                aggregate_id: 'order-1',
                attempts: 1,
                lease_until: null,
              },
            ],
          };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 1, rows: [] };
      },
    } as never;
    const worker = createRecoveryWorker(pool, { 'payment-reconciliation': async () => undefined }, 'worker-1');
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(queries).toContain('COMMIT');
    expect(queries.some((sql) => sql.includes("state='completed'"))).toBe(true);
  });

  it('returns failed jobs to pending and dead-letters after max attempts', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('WITH candidates'))
          return {
            rowCount: 1,
            rows: [
              { recovery_job_id: 'job-2', job_type: 'missing', aggregate_id: 'x', attempts: 8, lease_until: null },
            ],
          };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 1, rows: [] };
      },
    } as never;
    await expect(createRecoveryWorker(pool, {}, 'worker-1').runOnce()).resolves.toBe(1);
    expect(queries.some((sql) => sql.includes('state=CASE WHEN attempts >='))).toBe(true);
  });
});
