import { describe, expect, it, vi } from 'vitest';
import { createPaddlePaymentProvider, createPaddleRefundProvider } from '../src/providers.js';

describe('Paddle providers', () => {
  const checkout = {
    orderId: 'o1',
    amountMinor: 100,
    currency: 'USD',
    packageId: 'pkg',
    version: '1.0.0',
    priceId: 'price_1',
  };
  it('creates checkout', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'txn_1', checkout: { url: 'https://checkout' } } }), { status: 200 })
    );
    const r = await createPaddlePaymentProvider({ apiKey: 'secret', fetchImpl }).createCheckout(checkout);
    expect(r.reference).toBe('txn_1');
  });
  it('creates refund request', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'ref_1' } }), { status: 200 }));
    const r = await createPaddleRefundProvider({ apiKey: 'secret', fetchImpl }).requestRefund({
      orderId: 'o1',
      amountMinor: 100,
      currency: 'USD',
    });
    expect(r.reference).toBe('ref_1');
  });
  it('fails closed on provider errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    await expect(createPaddlePaymentProvider({ apiKey: 'secret', fetchImpl }).createCheckout(checkout)).rejects.toThrow(
      'PADDLE_PROVIDER_REQUEST_FAILED'
    );
  });
  it('times out a hung provider request', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    );
    await expect(
      createPaddlePaymentProvider({ apiKey: 'secret', fetchImpl, timeoutMs: 1_000 }).createCheckout(checkout)
    ).rejects.toThrow('PADDLE_PROVIDER_TIMEOUT');
  });
  it('rejects non-HTTPS provider endpoints', async () => {
    await expect(
      createPaddlePaymentProvider({ apiKey: 'secret', baseUrl: 'http://metadata.google' }).createCheckout(checkout)
    ).rejects.toThrow('PADDLE_ENDPOINT_INVALID');
  });
});
