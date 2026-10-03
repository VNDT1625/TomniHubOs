import { describe, expect, it } from 'vitest';
import { putAuthoritativeArtifact } from '../src/artifacts.js';
describe('authoritative artifact writes', () => {
  it('is idempotent and never overwrites', async () => {
    let current: { digest: string; size: number; metadata: Record<string, string> } | undefined;
    const store = {
      head: async () => current,
      create: async (
        _k: string,
        b: Uint8Array,
        o: { ifGenerationMatch?: number; metadata?: Record<string, string> }
      ) => {
        if (o.ifGenerationMatch !== 0) throw new Error('precondition');
        current = { digest: 'a'.repeat(64), size: b.length, metadata: o.metadata ?? {} };
        return current;
      },
    };
    const first = await putAuthoritativeArtifact(store, 'a'.repeat(64), new Uint8Array([1]));
    expect(first.size).toBe(1);
    expect(await putAuthoritativeArtifact(store, 'a'.repeat(64), new Uint8Array([1]))).toEqual(first);
    current = { digest: 'b'.repeat(64), size: 1, metadata: { sha256: 'b'.repeat(64) } };
    await expect(putAuthoritativeArtifact(store, 'a'.repeat(64), new Uint8Array([1]))).rejects.toThrow(
      'ARTIFACT_IMMUTABILITY_CONFLICT'
    );
  });
});
