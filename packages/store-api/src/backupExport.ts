import type { Pool } from 'pg';
import { createBackupManifest, type BackupManifest } from './backup.js';

export type BackupBundle = Readonly<{
  files: readonly Readonly<{ name: string; bytes: Uint8Array }>[];
  manifest: BackupManifest;
}>;
export const exportCriticalStoreState = async (pool: Pool): Promise<BackupBundle> => {
  const tables = ['ledger_transactions', 'ledger_entries', 'payment_events', 'entitlement_events', 'audit_events'];
  const files = await Promise.all(
    tables.map(async (table) => {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY created_at`);
      const body = result.rows.map((row) => JSON.stringify(row)).join('\n') + (result.rows.length ? '\n' : '');
      return { name: `${table}.jsonl`, bytes: Buffer.from(body) };
    })
  );
  return { files, manifest: createBackupManifest(files) };
};
