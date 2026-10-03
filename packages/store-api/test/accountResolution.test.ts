import { describe, expect, it } from 'vitest';
import { createPostgresStoreRepository } from '../src/repositories.js';

describe('account resolution transactions', () => {
  it('wraps first-login account and identity creation in one transaction', async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('external_identities WHERE')) return { rowCount: 0, rows: [] };
        if (sql.includes('INSERT INTO accounts')) return { rowCount: 1, rows: [{ account_id: 'acct-1' }] };
        if (sql.includes('INSERT INTO external_identities')) return { rowCount: 1, rows: [{ account_id: 'acct-1' }] };
        return { rowCount: 0, rows: [] };
      },
      release: () => undefined,
    };
    const repo = createPostgresStoreRepository({ connect: async () => client } as never);
    await expect(repo.resolveAccount('issuer', 'subject')).resolves.toBe('acct-1');
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('pg_advisory_xact_lock');
    expect(calls.at(-1)).toBe('COMMIT');
  });
});
