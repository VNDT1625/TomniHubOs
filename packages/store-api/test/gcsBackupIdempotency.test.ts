import { describe, expect, it } from 'vitest';
import { createGcsBackupStore } from '../src/backupStore.js';

describe('GCS backup idempotent conflict handling', () => {
  it('accepts a matching existing object after create-only conflict', async () => {
    const artifact = {
      key: 'backups/a.json',
      bytes: Buffer.from('payload'),
      sha256: 'a'.repeat(64),
      encrypted: {} as never,
      sourceManifestSha256: 'b'.repeat(64),
    };
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 412 })
        : new Response(
            JSON.stringify({ size: String(artifact.bytes.byteLength), metadata: { sha256: artifact.sha256 } }),
            { status: 200 }
          );
    }) as typeof fetch;
    await expect(
      createGcsBackupStore({ bucket: 'locked', accessToken: 'token' }, fetchImpl).create(artifact)
    ).resolves.toMatchObject({ sha256: artifact.sha256 });
  });
});
