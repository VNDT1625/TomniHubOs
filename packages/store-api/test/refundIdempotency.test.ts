import { describe, expect, it } from 'vitest';
import { createCommerceRepository } from '../src/commerceRepository.js';

describe('refund idempotency', () => {
  it('replays the same request and rejects a changed request', async () => {
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('FROM orders'))
          return {
            rowCount: 1,
            rows: [
              { account_id: 'acct', amount_minor: '1000', state: 'paid', provider_reference: 'txn-1', currency: 'USD' },
            ],
          };
        if (sql.includes('request_fingerprint')) {
          if (calls.filter((value) => value.includes('request_fingerprint')).length === 1)
            return { rowCount: 1, rows: [{ refund_id: 'r1', request_fingerprint: 'different' }] };
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => undefined,
    };
    const repo = createCommerceRepository({ connect: async () => client } as never);
    await expect(
      repo.requestRefund({
        accountId: 'acct',
        orderId: 'o1',
        amountMinor: 100,
        reason: 'x',
        currency: 'USD',
        actorSubject: 'acct',
        idempotencyKey: 'k1',
      })
    ).rejects.toThrow('IDEMPOTENCY_KEY_CONFLICT');
  });
  it('rejects a refund currency mismatch before persistence', async () => {
    const client = {
      query: async (sql: string) =>
        sql.includes('FROM orders')
          ? {
              rowCount: 1,
              rows: [
                {
                  account_id: 'acct',
                  amount_minor: '1000',
                  state: 'paid',
                  provider_reference: 'txn-1',
                  currency: 'EUR',
                },
              ],
            }
          : { rowCount: 0, rows: [] },
      release: () => undefined,
    };
    const repo = createCommerceRepository({ connect: async () => client } as never);
    await expect(
      repo.requestRefund({
        accountId: 'acct',
        orderId: 'o1',
        amountMinor: 100,
        reason: 'x',
        currency: 'USD',
        actorSubject: 'acct',
        idempotencyKey: 'k2',
      })
    ).rejects.toThrow('REFUND_CURRENCY_MISMATCH');
  });
});
