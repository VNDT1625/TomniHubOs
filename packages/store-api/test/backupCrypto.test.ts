import { describe, expect, it } from 'vitest';
import { createBackupManifest } from '../src/backup.js';
import type { BackupBundle } from '../src/backupExport.js';
import { decryptBackupBundle, encryptBackupBundle } from '../src/backupCrypto.js';

describe('encrypted backup bundle', () => {
  it('round-trips and verifies the manifest', () => {
    const files = [{ name: 'audit_events.jsonl', bytes: Buffer.from('event-1\\n') }];
    const bundle: BackupBundle = { files, manifest: createBackupManifest(files, '2026-01-01T00:00:00.000Z') };
    const key = new Uint8Array(32).fill(7);
    const encrypted = encryptBackupBundle(bundle, key, 'backup-key-v1');
    expect(decryptBackupBundle(encrypted, key).manifest.manifestSha256).toBe(bundle.manifest.manifestSha256);
  });
  it('rejects tampered ciphertext', () => {
    const files = [{ name: 'ledger_entries.jsonl', bytes: Buffer.from('entry-1\\n') }];
    const bundle: BackupBundle = { files, manifest: createBackupManifest(files, '2026-01-01T00:00:00.000Z') };
    const encrypted = encryptBackupBundle(bundle, new Uint8Array(32).fill(3), 'backup-key-v1');
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + 'AA' };
    expect(() => decryptBackupBundle(tampered, new Uint8Array(32).fill(3))).toThrow();
  });
});
