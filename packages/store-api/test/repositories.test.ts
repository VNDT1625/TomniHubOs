import { describe, expect, it } from 'vitest';
import { createPostgresStoreRepository } from '../src/repositories.js';

describe('catalog repository authority', () => {
  it('returns only published entry with signature metadata', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 1, rows: [{ package_id: 'pkg', version: '1.0.0', state: 'published' }] };
      },
      release: () => undefined,
    };
    const repo = createPostgresStoreRepository({ connect: async () => client } as never);
    const entry = await repo.getCatalogEntry('pkg', '1.0.0');
    expect(entry?.package_id).toBe('pkg');
    expect(queries[0]).toContain('ce.state=$3');
    expect(queries[0]).toContain('rs.signature');
  });

  it('returns undefined when entry is absent or revoked', async () => {
    const client = {
      query: async () => ({ rowCount: 0, rows: [] }),
      release: () => undefined,
    };
    const repo = createPostgresStoreRepository({ connect: async () => client } as never);
    await expect(repo.getCatalogEntry('missing', '1.0.0')).resolves.toBeUndefined();
  });
});
