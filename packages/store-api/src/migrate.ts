import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
const { Pool } = pg;

export type MigrationResult = Readonly<{ applied: readonly string[]; skipped: readonly string[] }>;

const migrationName = (file: string): boolean => /^\d{3}_[a-z0-9_]+\.sql$/.test(file);

export const runStoreMigrations = async (
  databaseUrl: string,
  migrationsDir = resolve('migrations')
): Promise<MigrationResult> => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS store_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const files = (await readdir(migrationsDir)).filter(migrationName).sort();
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await pool.query<{ checksum: string }>(
        'SELECT checksum FROM store_schema_migrations WHERE name=$1',
        [file]
      );
      if (existing.rowCount) {
        if (existing.rows[0]!.checksum !== checksum) throw new Error(`MIGRATION_DRIFT:${file}`);
        skipped.push(file);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [file]);
        await client.query(sql);
        await client.query('INSERT INTO store_schema_migrations(name,checksum) VALUES($1,$2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return { applied, skipped };
  } finally {
    await pool.end();
  }
};

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED');
  const result = await runStoreMigrations(databaseUrl);
  console.log(JSON.stringify(result));
}
