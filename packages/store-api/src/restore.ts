import type { Pool } from 'pg';
export type RestoreVerification = Readonly<{
  ledgerTransactions: number;
  unbalancedTransactions: number;
  auditEvents: number;
}>;
export const verifyRestoredStore = async (pool: Pool): Promise<RestoreVerification> => {
  const ledger = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.transaction_id GROUP BY t.transaction_id HAVING count(e.entry_id)=0 OR EXISTS (SELECT 1 FROM ledger_entries ec WHERE ec.transaction_id=t.transaction_id GROUP BY ec.currency HAVING COALESCE(sum(CASE WHEN ec.direction='debit' THEN ec.amount_minor ELSE 0 END),0) <> COALESCE(sum(CASE WHEN ec.direction='credit' THEN ec.amount_minor ELSE 0 END),0))`
  );
  const total = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM ledger_transactions');
  const audit = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM audit_events');
  return {
    ledgerTransactions: Number(total.rows[0]?.count ?? 0),
    unbalancedTransactions: ledger.rows.length,
    auditEvents: Number(audit.rows[0]?.count ?? 0),
  };
};
