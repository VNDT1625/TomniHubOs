import { describe, expect, it } from 'vitest';
import { verifyDownloadTicket, type DownloadTicket } from '../src/artifactRepository.js';

const base: DownloadTicket = {
  ticketId: 'ticket-1',
  digest: `sha256-${'a'.repeat(64)}`,
  expiresAt: '2030-01-01T00:00:00.000Z',
  objectKey: `sha256/${'a'.repeat(64)}`,
};

describe('download ticket proof', () => {
  it('accepts a correctly signed ticket', async () => {
    const { issueDownloadTicket } = await import('../src/artifactRepository.js');
    const pool = {
      query: async (sql: string) =>
        sql.includes('catalog_entries')
          ? { rowCount: 1, rows: [{ package_id: 'pkg', version: '1' }] }
          : { rowCount: 1, rows: [{}] },
    } as never;
    const ticket = await issueDownloadTicket(pool, { accountId: 'acct', digest: base.digest, ticketSecret: 'secret' });
    expect(verifyDownloadTicket(ticket, 'acct', 'secret')).toBe(true);
  });
  it('rejects tampered or expired tickets', () => {
    const tampered = { ...base, proof: 'bad' };
    expect(verifyDownloadTicket(tampered, 'acct', 'secret')).toBe(false);
    expect(verifyDownloadTicket({ ...tampered, expiresAt: '2020-01-01T00:00:00.000Z' }, 'acct', 'secret')).toBe(false);
  });
});
