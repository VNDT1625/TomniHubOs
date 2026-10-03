import { describe, expect, it } from 'vitest';
import { verifyRestoredStore } from '../src/restore.js';

describe('restore ledger currency invariant', () => {
  it('uses per-currency balance rather than rejecting multiple currencies outright', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (query: string) => {
        queries.push(query);
        return { rows: query.includes('ledger_transactions t') ? [] : [{ count: '0' }] };
      },
    } as never;
    await expect(verifyRestoredStore(pool)).resolves.toMatchObject({ unbalancedTransactions: 0 });
    expect(queries[0]).toContain('GROUP BY ec.currency');
  });
});
