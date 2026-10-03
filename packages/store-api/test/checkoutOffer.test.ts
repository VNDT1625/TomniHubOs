import { describe, expect, it } from 'vitest';
import { createPostgresStoreRepository } from '../src/repositories.js';

const repositoryForOffer = (offer: unknown) => {
  let call = 0;
  const client = {
    query: async () => {
      call += 1;
      if (call === 1) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ offer_json: offer }] };
    },
    release: () => undefined,
  };
  return createPostgresStoreRepository({ connect: async () => client } as never);
};

describe('checkout catalog price authority', () => {
  it('rejects a client amount that differs from offer.price', async () => {
    const repo = repositoryForOffer({
      active: true,
      productId: 'price_1',
      price: { amountMinor: 500, currency: 'USD' },
    });
    await expect(
      repo.createOrder({
        accountId: 'acct',
        packageId: 'pkg',
        version: '1',
        amountMinor: 1,
        currency: 'USD',
        idempotencyKey: 'key-12345',
      })
    ).rejects.toThrow('PAYMENT_AMOUNT_MISMATCH');
  });
  it('rejects malformed paid offers', async () => {
    const repo = repositoryForOffer({ active: true, amountMinor: 500, currency: 'USD' });
    await expect(
      repo.createOrder({
        accountId: 'acct',
        packageId: 'pkg',
        version: '1',
        amountMinor: 500,
        currency: 'USD',
        idempotencyKey: 'key-12345',
      })
    ).rejects.toThrow('CATALOG_OFFER_INVALID');
  });
});
