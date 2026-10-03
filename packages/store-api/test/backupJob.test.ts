import { describe, expect, it } from 'vitest';
import { createCriticalBackup } from '../src/backupJob.js';

describe('critical backup runner', () => {
  it('creates a content-addressed encrypted backup artifact', async () => {
    const pool = {} as never;
    const result = await createCriticalBackup(
      pool,
      { key: new Uint8Array(32).fill(1), keyId: 'backup-v1', now: () => new Date('2026-01-01T00:00:00.000Z') },
      async () => {
        const files = [{ name: 'audit_events.jsonl', bytes: Buffer.from('audit\\n') }];
        const { createBackupManifest } = await import('../src/backup.js');
        return { files, manifest: createBackupManifest(files, '2026-01-01T00:00:00.000Z') };
      }
    );
    expect(result.key).toMatch(/^backups\/2026-01-01T00-00-00-000Z-/);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.sha256).toHaveLength(64);
  });
});
