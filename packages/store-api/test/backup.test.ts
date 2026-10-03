import { describe, expect, it } from 'vitest';
import { createBackupManifest, verifyBackupManifest } from '../src/backup.js';
describe('backup manifest', () => {
  it('verifies hashes and detects corruption', () => {
    const files = [
      { name: 'ledger.jsonl', bytes: Buffer.from('ledger') },
      { name: 'audit.jsonl', bytes: Buffer.from('audit') },
    ];
    const manifest = createBackupManifest(files, '2026-01-01T00:00:00.000Z');
    expect(() => verifyBackupManifest(manifest, files)).not.toThrow();
    expect(() =>
      verifyBackupManifest(manifest, [...files.slice(0, 1), { name: 'audit.jsonl', bytes: Buffer.from('tampered') }])
    ).toThrow('BACKUP_MANIFEST_INVALID');
  });

  it('rejects ambiguous or unsafe backup filenames', () => {
    expect(() =>
      createBackupManifest([
        { name: 'audit.jsonl', bytes: Buffer.from('a') },
        { name: 'audit.jsonl', bytes: Buffer.from('b') },
      ])
    ).toThrow('BACKUP_FILE_NAME_INVALID');
    expect(() => createBackupManifest([{ name: '../audit.jsonl', bytes: Buffer.from('a') }])).toThrow(
      'BACKUP_FILE_NAME_INVALID'
    );
  });
});
