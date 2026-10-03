import { describe, expect, it } from 'vitest';
import { verifyRestoredStore } from '../src/restore.js';

describe('restore verification', () => {
  it('reports ledger and audit continuity', async () => {
    const pool = {
      query: async (q: string) => ({
        rows: q.includes('ledger_transactions t') ? [] : [{ count: q.includes('ledger_transactions') ? '2' : '5' }],
      }),
    } as never;
    expect(await verifyRestoredStore(pool)).toEqual({
      ledgerTransactions: 2,
      unbalancedTransactions: 0,
      auditEvents: 5,
    });
  });

  it('counts ledger transactions with missing entries as invalid', async () => {
    const pool = {
      query: async (q: string) => ({
        rows: q.includes('ledger_transactions t') ? [{ transaction_id: 'tx-missing' }] : [{ count: '1' }],
      }),
    } as never;
    await expect(verifyRestoredStore(pool)).resolves.toMatchObject({
      ledgerTransactions: 1,
      unbalancedTransactions: 1,
      auditEvents: 1,
    });
  });
});
