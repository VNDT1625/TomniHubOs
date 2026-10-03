import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalCatalogPayload, signReleaseArtifact } from '../src/publication.js';
describe('release publication signing', () => {
  it('canonicalizes and persists compatible Ed25519 signature', async () => {
    const calls: string[] = [];
    const pool = {
      query: async (q: string) => {
        calls.push(q);
        return { rows: [], rowCount: 1 };
      },
    } as never;
    const signer = { keyId: 'k1', sign: async (payload: Uint8Array) => new Uint8Array(64).fill(payload[0] ?? 0) };
    const input = { packageId: 'pkg', version: '1.0.0', artifactDigest: `sha256-${'a'.repeat(64)}` };
    const out = await signReleaseArtifact(pool, signer, input);
    expect(out.keyId).toBe('k1');
    expect(out.canonicalDigest).toBe(createHash('sha256').update(canonicalCatalogPayload(input)).digest('hex'));
    expect(calls[0]).toContain('release_signatures');
  });
  it('rejects incompatible signer output', async () => {
    const pool = { query: async () => ({ rows: [], rowCount: 1 }) } as never;
    await expect(
      signReleaseArtifact(
        pool,
        { keyId: 'bad', sign: async () => new Uint8Array(1) },
        { packageId: 'p', version: '1', artifactDigest: `sha256-${'a'.repeat(64)}` }
      )
    ).rejects.toThrow('SIGNER_INCOMPATIBLE_ED25519_OUTPUT');
  });
});
