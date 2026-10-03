import { describe, expect, it } from 'vitest';
import { recoverStoreJobs } from '../src/recovery.js';

describe('recovery lease reset', () => {
  it('resets recovery and outbox leases with availability timestamp', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: sql.includes('recovery_jobs') ? 2 : 3, rows: [] };
      },
    } as never;
    await expect(recoverStoreJobs(pool, new Date('2026-01-01T00:00:00.000Z'))).resolves.toEqual({
      checkoutClaimsReset: 3,
      recoveryLeasesReset: 2,
      outboxLeasesReset: 3,
      leasedReset: 8,
      queued: 3,
    });
    expect(queries.filter((sql) => sql.includes('available_at=')).length).toBe(2);
    expect(queries.some((sql) => sql.includes('checkout_claim_until < '))).toBe(true);
  });

  it('commits all lease resets as one database transaction', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: sql.includes('recovery_jobs') ? 2 : 3, rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as never;
    await expect(recoverStoreJobs(pool)).resolves.toMatchObject({ leasedReset: 8 });
    expect(queries[0]).toBe('BEGIN');
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it('rolls back when one lease reset fails', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('recovery_jobs')) throw new Error('database unavailable');
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as never;
    await expect(recoverStoreJobs(pool)).rejects.toThrow('database unavailable');
    expect(queries).toContain('ROLLBACK');
  });
});
