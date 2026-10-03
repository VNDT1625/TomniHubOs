import { describe, expect, it } from 'vitest';
import { createPostgresStoreRepository } from '../src/repositories.js';

describe('submission idempotency', () => {
  it('rejects reuse of a key for different immutable bytes', async () => {
    const client = {
      query: async () => ({ rowCount: 1, rows: [{ request_fingerprint: 'different' }] }),
      release: () => undefined,
    };
    const repo = createPostgresStoreRepository({ connect: async () => client } as never);
    await expect(
      repo.createSubmission({
        accountId: 'account',
        publisherId: 'publisher',
        packageId: 'pkg',
        version: '1.0.0',
        artifactDigest: `sha256-${'a'.repeat(64)}`,
        manifestDigest: `sha256-${'b'.repeat(64)}`,
        idempotencyKey: 'key-1',
      })
    ).rejects.toThrow('IDEMPOTENCY_KEY_CONFLICT');
  });
});
