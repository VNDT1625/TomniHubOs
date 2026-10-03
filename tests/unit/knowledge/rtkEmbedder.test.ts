import { describe, expect, it, vi } from 'vitest';

import {
  createHashingEmbedder,
  createProviderEmbedder,
  resolveRtkEmbedder,
  type CreateProviderEmbedderOptions,
  type GovernedEmbeddingAuthority,
} from '@/process/knowledge/rtkEmbedder';

describe('RTK remote embedding containment', () => {
  it('keeps the deterministic local fallback available without network access', async () => {
    const embedder = await resolveRtkEmbedder();

    expect(embedder.providerId).toBe('local-hashing');
    await expect(embedder.embed(['private fact and debug text'])).resolves.toHaveLength(1);
  });

  it('fails closed even when a metadata-only authority would admit an operation', async () => {
    const authorizeEmbedding = vi.fn(async () => true);
    const authority: GovernedEmbeddingAuthority = { authorizeEmbedding };
    const network = vi.fn();
    vi.stubGlobal('fetch', network);

    try {
      const embedder = await createProviderEmbedder({ authority });
      const resolved = await resolveRtkEmbedder({ authority });

      expect(embedder).toBeNull();
      expect(resolved.providerId).toBe('local-hashing');
      expect(authorizeEmbedding).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not inspect an injected authority before selecting the local-only path', async () => {
    let authorityReads = 0;
    const options = {} as CreateProviderEmbedderOptions;
    Object.defineProperty(options, 'authority', {
      get: () => {
        authorityReads += 1;
        return { authorizeEmbedding: vi.fn(async () => true) };
      },
    });

    await expect(createProviderEmbedder(options)).resolves.toBeNull();
    await expect(resolveRtkEmbedder(options)).resolves.toMatchObject({ providerId: 'local-hashing' });
    expect(authorityReads).toBe(0);
  });

  it('keeps local embeddings deterministic for bounded and large inputs', async () => {
    const embedder = createHashingEmbedder();
    const input = ['bounded input', 'x'.repeat(64 * 1024 + 1)];

    await expect(embedder.embed(input)).resolves.toEqual(await embedder.embed(input));
  });
});
