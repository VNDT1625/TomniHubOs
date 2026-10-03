import { describe, expect, it } from 'vitest';
import { runPaddleReconciliation } from '../src/reconciliation.js';

describe('Paddle reconciliation recovery evidence', () => {
  it('queues a durable recovery job and audit event for each mismatch', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('INSERT INTO reconciliation_runs')) return { rowCount: 1, rows: [{ run_id: 'run-1' }] };
        if (sql.includes('SELECT o.order_id'))
          return { rowCount: 1, rows: [{ order_id: 'order-1', payment_id: null, payment_state: null }] };
        return { rowCount: 1, rows: [] };
      },
    } as never;
    await expect(runPaddleReconciliation(pool, 'paddle')).resolves.toEqual({
      runId: 'run-1',
      state: 'mismatch',
      mismatches: 1,
    });
    expect(queries.some((sql) => sql.includes('INSERT INTO recovery_jobs'))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO audit_events'))).toBe(true);
  });

  it('commits all evidence atomically when a real pool client is available', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT o.order_id')) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 1, rows: [{ run_id: 'run-2' }] };
      },
      connect: async () => client,
    } as never;
    await expect(runPaddleReconciliation(pool, 'paddle')).resolves.toEqual({
      runId: 'run-2',
      state: 'completed',
      mismatches: 0,
    });
    expect(queries).toContain('BEGIN');
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it('rolls back evidence and durably marks the run failed', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT o.order_id')) throw new Error('provider unavailable');
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 1, rows: [{ run_id: 'run-3' }] };
      },
      connect: async () => client,
    } as never;
    await expect(runPaddleReconciliation(pool, 'paddle')).rejects.toThrow('provider unavailable');
    expect(queries).toContain('ROLLBACK');
    expect(queries.at(-1)).toContain('UPDATE reconciliation_runs SET state=$1');
  });
});
