import type { Pool, PoolClient } from 'pg';

export type RecoverySummary = Readonly<{
  checkoutClaimsReset: number;
  recoveryLeasesReset: number;
  outboxLeasesReset: number;
  leasedReset: number;
  queued: number;
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

export const recoverStoreJobs = async (pool: Pool, now = new Date()): Promise<RecoverySummary> =>
  withTransaction(pool, async (db) => {
    const checkouts = await db.query(
      "UPDATE orders SET state='created',checkout_claim_until=NULL WHERE state='checkout_creating' AND checkout_claim_until < $1",
      [now]
    );
    const recovery = await db.query(
      "UPDATE recovery_jobs SET state='pending', lease_until=NULL, available_at=$1 WHERE state='leased' AND lease_until < $1",
      [now]
    );
    const outbox = await db.query(
      "UPDATE outbox_events SET state='pending', lease_until=NULL, available_at=$1 WHERE state='leased' AND lease_until < $1",
      [now]
    );
    const checkoutClaimsReset = checkouts.rowCount ?? 0;
    const recoveryLeasesReset = recovery.rowCount ?? 0;
    const outboxLeasesReset = outbox.rowCount ?? 0;
    return {
      checkoutClaimsReset,
      recoveryLeasesReset,
      outboxLeasesReset,
      leasedReset: checkoutClaimsReset + recoveryLeasesReset + outboxLeasesReset,
      queued: outboxLeasesReset,
    };
  });
