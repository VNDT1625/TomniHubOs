import { describe, expect, it } from 'vitest';
import { createLocalBackupStore } from '../src/backupStore.js';

describe('backup store', () => {
  it('is idempotent for the same key and digest', async () => {
    const store = createLocalBackupStore();
    const artifact = {
      key: 'backups/a.json',
      bytes: Buffer.from('a'),
      sha256: 'a'.repeat(64),
      encrypted: {} as never,
      sourceManifestSha256: 'b'.repeat(64),
    };
    await expect(store.create(artifact)).resolves.toMatchObject({ sha256: artifact.sha256 });
    await expect(store.create(artifact)).resolves.toMatchObject({ sha256: artifact.sha256 });
  });
  it('rejects a conflicting immutable object', async () => {
    const store = createLocalBackupStore();
    const base = {
      key: 'backups/a.json',
      bytes: Buffer.from('a'),
      sha256: 'a'.repeat(64),
      encrypted: {} as never,
      sourceManifestSha256: 'b'.repeat(64),
    };
    await store.create(base);
    await expect(store.create({ ...base, sha256: 'c'.repeat(64) })).rejects.toThrow('BACKUP_IMMUTABILITY_CONFLICT');
  });
});
