import { describe, expect, it } from 'vitest';
import { createCommerceRepository } from '../src/commerceRepository.js';

describe('out-of-order Paddle payment durability', () => {
  it('persists the verified event and queues prerequisite recovery when the order is not present yet', async () => {
    const queries: readonly unknown[][] = [];
    const mutableQueries = queries as unknown[][];
    const client = {
      query: async (sql: string, values?: readonly unknown[]) => {
        mutableQueries.push([sql, values]);
        if (sql.startsWith('INSERT INTO webhook_events'))
          return { rowCount: 1, rows: [{ provider_event_id: 'evt-1' }] };
        if (sql.startsWith('SELECT account_id,package_id')) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const repository = createCommerceRepository({ connect: async () => client } as never);

    await expect(
      repository.applyCapturedPayment({
        providerEventId: 'evt-1',
        orderId: 'order-not-created-yet',
        provider: 'paddle',
        providerReference: 'txn-1',
        amountMinor: 100,
        currency: 'USD',
        actorSubject: 'paddle',
        payloadHash: 'hash-1',
      })
    ).resolves.toEqual({ duplicate: false, pending: true });

    const sql = mutableQueries.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('INSERT INTO pending_payment_webhooks');
    const values = mutableQueries.flatMap(([, parameters]) =>
      Array.isArray(parameters) ? parameters.map(String) : []
    );
    expect(values).toContain('payment-webhook-prerequisite');
    expect(values).toContain('payment.webhook_pending_prerequisite');
    expect(sql).toContain('COMMIT');
  });
});
