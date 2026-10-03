import { describe, expect, it } from 'vitest';
import { createGcsBackupStore } from '../src/backupStore.js';

describe('GCS backup authority', () => {
  const artifact = {
    key: 'backups/a.json',
    bytes: Buffer.from('payload'),
    sha256: 'a'.repeat(64),
    encrypted: {} as never,
    sourceManifestSha256: 'b'.repeat(64),
  };
  it('uses create-only upload precondition and digest metadata', async () => {
    let requestUrl = '';
    let requestHeaders: HeadersInit | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await createGcsBackupStore({ bucket: 'locked', accessToken: 'token' }, fetchImpl).create(artifact);
    expect(requestUrl).toContain('ifGenerationMatch=0');
    expect(requestHeaders).toMatchObject({ 'x-goog-meta-sha256': artifact.sha256 });
  });
  it('maps an existing object response to immutable conflict', async () => {
    const fetchImpl = (async () => new Response('', { status: 412 })) as typeof fetch;
    await expect(
      createGcsBackupStore({ bucket: 'locked', accessToken: 'token' }, fetchImpl).create(artifact)
    ).rejects.toThrow('BACKUP_IMMUTABILITY_CONFLICT');
  });
});
