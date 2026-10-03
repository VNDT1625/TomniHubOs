import type { Pool, PoolClient } from 'pg';

export type ReconciliationResult = Readonly<{
  runId: string;
  state: 'completed' | 'mismatch' | 'failed';
  mismatches: number;
}>;

type QueryExecutor = Pick<Pool, 'query'>;

const withTransaction = async <T>(pool: Pool, work: (client: QueryExecutor) => Promise<T>): Promise<T> => {
  if (typeof pool.connect !== 'function') return work(pool);
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const runPaddleReconciliation = async (pool: Pool, provider: string): Promise<ReconciliationResult> => {
  const run = await pool.query<{ run_id: string }>(
    'INSERT INTO reconciliation_runs(provider,state) VALUES($1,$2) RETURNING run_id',
    [provider, 'running']
  );
  const runId = run.rows[0]!.run_id;
  try {
    return await withTransaction(pool, async (db) => {
      const mismatches = await db.query<{
        order_id: string;
        payment_id: string | null;
        payment_state: string | null;
      }>(
        "SELECT o.order_id,p.payment_id,p.state AS payment_state FROM orders o LEFT JOIN payments p ON p.order_id=o.order_id WHERE o.state='paid' AND (p.payment_id IS NULL OR p.state <> 'captured')"
      );
      await Promise.all(
        mismatches.rows.map(async (mismatch) => {
          await db.query(
            'INSERT INTO reconciliation_items(run_id,entity_type,entity_id,mismatch_code,expected_json,actual_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
            [
              runId,
              'order',
              mismatch.order_id,
              'PAID_ORDER_PAYMENT_MISSING_OR_INVALID',
              JSON.stringify({ paymentState: 'captured' }),
              JSON.stringify({ paymentId: mismatch.payment_id, paymentState: mismatch.payment_state }),
            ]
          );
          await db.query(
            'INSERT INTO recovery_jobs(job_type,aggregate_id,state) VALUES($1,$2,$3) ON CONFLICT(job_type,aggregate_id) DO NOTHING',
            ['payment-reconciliation', mismatch.order_id, 'pending']
          );
          await db.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
            'reconciliation',
            'payment.reconciliation_mismatch',
            JSON.stringify({
              runId,
              orderId: mismatch.order_id,
              paymentId: mismatch.payment_id,
              paymentState: mismatch.payment_state,
            }),
          ]);
        })
      );
      const count = mismatches.rowCount ?? 0;
      await db.query('UPDATE reconciliation_runs SET state=$1 WHERE run_id=$2', [
        count ? 'mismatch' : 'completed',
        runId,
      ]);
      return { runId, state: count ? 'mismatch' : 'completed', mismatches: count };
    });
  } catch (error) {
    await pool.query('UPDATE reconciliation_runs SET state=$1 WHERE run_id=$2', ['failed', runId]);
    throw error;
  }
};
