import type { Pool } from 'pg';
export type DurableOutboxRow = Readonly<{
  outbox_id: string;
  topic: string;
  aggregate_id: string;
  payload_json: unknown;
  attempts: number;
  lease_until: string | null;
}>;
export const claimOutbox = async (
  pool: Pool,
  workerId: string,
  leaseMs = 30_000,
  maxAttempts = 8
): Promise<DurableOutboxRow[]> => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await c.query<DurableOutboxRow>(
      `WITH candidates AS (SELECT outbox_id FROM outbox_events WHERE state='pending' AND available_at <= now() AND (lease_until IS NULL OR lease_until < now()) AND attempts < $1 ORDER BY available_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT 50) UPDATE outbox_events e SET state='leased', attempts=e.attempts+1, lease_until=now()+($2::text || ' milliseconds')::interval, last_error=$3 FROM candidates WHERE e.outbox_id=candidates.outbox_id RETURNING e.*`,
      [maxAttempts, leaseMs, workerId]
    );
    await c.query('COMMIT');
    return result.rows;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
};
export const completeOutboxRow = async (pool: Pool, id: string): Promise<void> => {
  await pool.query(
    "UPDATE outbox_events SET state='delivered', delivered_at=now(), lease_until=NULL WHERE outbox_id=$1 AND state='leased'",
    [id]
  );
};
export const failOutboxRow = async (pool: Pool, id: string, errorMessage: string, maxAttempts = 8): Promise<void> => {
  await pool.query(
    "UPDATE outbox_events SET state=CASE WHEN attempts >= $3 THEN 'dead' ELSE 'pending' END, available_at=now()+make_interval(secs => LEAST(300, GREATEST(1, attempts * attempts))), lease_until=NULL, last_error=$2 WHERE outbox_id=$1 AND state='leased'",
    [id, errorMessage.slice(0, 500), maxAttempts]
  );
};
