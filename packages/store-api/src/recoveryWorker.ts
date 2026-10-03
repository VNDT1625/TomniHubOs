import type { Pool } from 'pg';

export type RecoveryJob = Readonly<{
  recovery_job_id: string;
  job_type: string;
  aggregate_id: string;
  attempts: number;
  lease_until: string | null;
}>;

export type RecoveryHandler = (job: RecoveryJob) => Promise<void>;
export type RecoveryWorker = Readonly<{ runOnce: () => Promise<number> }>;

export const createRecoveryWorker = (
  pool: Pool,
  handlers: Readonly<Record<string, RecoveryHandler>>,
  workerId: string,
  leaseMs = 30_000,
  maxAttempts = 8
): RecoveryWorker => ({
  runOnce: async () => {
    const client = await pool.connect();
    let jobs: RecoveryJob[] = [];
    try {
      await client.query('BEGIN');
      const result = await client.query<RecoveryJob>(
        `WITH candidates AS (SELECT recovery_job_id FROM recovery_jobs WHERE state='pending' AND available_at <= now() AND (lease_until IS NULL OR lease_until < now()) AND attempts < $1 ORDER BY available_at,recovery_job_id FOR UPDATE SKIP LOCKED LIMIT 50) UPDATE recovery_jobs j SET state='leased', attempts=j.attempts+1, lease_until=now()+($2::text || ' milliseconds')::interval FROM candidates WHERE j.recovery_job_id=candidates.recovery_job_id RETURNING j.*`,
        [maxAttempts, leaseMs]
      );
      jobs = result.rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
    client.release();
    for (const job of jobs) {
      const handler = handlers[job.job_type];
      try {
        if (!handler) throw new Error('RECOVERY_HANDLER_NOT_FOUND');
        await handler(job);
        await pool.query(
          "UPDATE recovery_jobs SET state='completed', lease_until=NULL WHERE recovery_job_id=$1 AND state='leased'",
          [job.recovery_job_id]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'RECOVERY_FAILED';
        await pool.query(
          "UPDATE recovery_jobs SET state=CASE WHEN attempts >= $2 THEN 'dead' ELSE 'pending' END, available_at=now()+make_interval(secs => LEAST(300, GREATEST(1, attempts * attempts))), lease_until=NULL, last_error=$3 WHERE recovery_job_id=$1 AND state='leased'",
          [job.recovery_job_id, maxAttempts, message]
        );
      }
    }
    return jobs.length;
  },
});
