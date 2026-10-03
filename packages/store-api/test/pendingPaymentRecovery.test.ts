import { describe, expect, it, vi } from 'vitest';
import { replayPendingPaymentWebhook } from '../src/pendingPaymentRecovery.js';

describe('pending payment recovery', () => {
  it('replays a pending payload through the commerce authority', async () => {
    const applyCapturedPayment = vi.fn().mockResolvedValue({ duplicate: false, entitlementId: 'ent-1' });
    const query = vi.fn().mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          payload_json: {
            providerEventId: 'evt-1',
            orderId: 'order-1',
            provider: 'paddle',
            providerReference: 'txn-1',
            amountMinor: 100,
            currency: 'USD',
            actorSubject: 'paddle',
          },
        },
      ],
    });
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const pool = { query } as never;
    await expect(replayPendingPaymentWebhook(pool, { applyCapturedPayment } as never, 'order-1')).resolves.toBe(true);
    expect(applyCapturedPayment).toHaveBeenCalledWith(expect.objectContaining({ providerEventId: 'evt-1' }));
  });
});
