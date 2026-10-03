import { describe, expect, it } from 'vitest';
import { createBackupManifest } from '../src/backup.js';
import type { BackupBundle } from '../src/backupExport.js';
import { encryptBackupBundle } from '../src/backupCrypto.js';
import { restoreEncryptedBackupArtifact } from '../src/backupRestore.js';

describe('backup artifact restore', () => {
  it('restores and verifies an encrypted artifact', () => {
    const files = [{ name: 'audit_events.jsonl', bytes: Buffer.from('audit\\n') }];
    const bundle: BackupBundle = { files, manifest: createBackupManifest(files, '2026-01-01T00:00:00.000Z') };
    const key = new Uint8Array(32).fill(5);
    const encrypted = encryptBackupBundle(bundle, key, 'backup-v1');
    expect(restoreEncryptedBackupArtifact(Buffer.from(JSON.stringify(encrypted)), key).files).toHaveLength(1);
  });
  it('rejects malformed artifact bytes', () => {
    expect(() => restoreEncryptedBackupArtifact(Buffer.from('not-json'), new Uint8Array(32))).toThrow(
      'BACKUP_ARTIFACT_INVALID'
    );
  });
});
