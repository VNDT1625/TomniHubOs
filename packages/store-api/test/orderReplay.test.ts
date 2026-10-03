import { describe, expect, it } from 'vitest';
import { createPostgresStoreRepository } from '../src/repositories.js';

import { createHash } from 'node:crypto';
describe('checkout order replay', () => {
  it('returns the complete persisted order for an idempotent retry', async () => {
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ packageId: 'pkg', version: '1.0.0', amountMinor: 100, currency: 'USD' }))
      .digest('hex');
    const order = {
      order_id: 'order-1',
      state: 'checkout_pending',
      provider_checkout_id: 'paddle:txn-1',
      offer_json: { productId: 'price_1' },
      provider_price_id: 'price_1',
      request_fingerprint: requestFingerprint,
    };
    const client = {
      query: async (sql: string) => {
        if (sql.includes('FROM orders')) return { rowCount: 1, rows: [order] };
        throw new Error('unexpected query');
      },
      release: () => undefined,
    };
    const repo = createPostgresStoreRepository({ connect: async () => client } as never);
    await expect(
      repo.createOrder({
        accountId: 'acct',
        packageId: 'pkg',
        version: '1.0.0',
        amountMinor: 100,
        currency: 'USD',
        idempotencyKey: 'key-1',
      })
    ).resolves.toEqual(order);
  });
});
