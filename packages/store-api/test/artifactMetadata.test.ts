import { describe, expect, it } from 'vitest';
import { persistStagedArtifact } from '../src/artifactMetadata.js';
describe('artifact metadata persistence', () => {
  it('persists metadata after transaction', async () => {
    const calls: string[] = [];
    const client = {
      query: async (q: string) => {
        calls.push(q);
        return { rows: [{ publisher_id: 'pub' }], rowCount: 1 };
      },
      release: () => {},
    };
    const pool = {
      query: async () => ({ rows: [{ publisher_id: 'pub' }], rowCount: 1 }),
      connect: async () => client,
    } as never;
    const out = await persistStagedArtifact(pool, {
      bytes: Buffer.from('pkg'),
      accountId: 'acct',
      packageId: 'pkg',
      version: '1.0.0',
      manifestDigest: `sha256-${'a'.repeat(64)}`,
    });
    expect(out.objectKey).toBe(`sha256/${out.digest.slice(7)}`);
    expect(calls[0]).toBe('BEGIN');
    expect(calls.at(-1)).toBe('COMMIT');
  });

  it('rejects before authoritative upload without publisher membership', async () => {
    let uploaded = false;
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as never;
    const authoritativeStore = {
      head: async () => undefined,
      create: async () => {
        uploaded = true;
        throw new Error('unexpected upload');
      },
    } as never;
    await expect(
      persistStagedArtifact(pool, {
        bytes: Buffer.from('pkg'),
        accountId: 'acct',
        packageId: 'pkg',
        version: '1.0.0',
        manifestDigest: `sha256-${'a'.repeat(64)}`,
        authoritativeStore,
      })
    ).rejects.toThrow('PUBLISHER_MEMBERSHIP_REQUIRED');
    expect(uploaded).toBe(false);
  });
});
