import { describe, expect, it } from 'vitest';
import type { ISqliteDriver, IStatement } from '@process/services/database/drivers/ISqliteDriver';
import { StoreCommerceLedger } from '@process/services/database/storeCommerceLedger';

type PersistedOrder = { idempotencyKey: string; lifecycle: string };
type PersistedEvent = {
  kind: string;
  providerEventId: string | null;
  idempotencyKey: string;
  orderId: string;
  payload: string;
};
type InMemoryCommerceDatabase = { orders: Map<string, PersistedOrder>; events: Map<string, PersistedEvent> };

/** A restart-safe in-memory SQLite contract double; production uses BetterSqlite3Driver. */
class CommerceLedgerDriver implements ISqliteDriver {
  public constructor(private readonly state: InMemoryCommerceDatabase) {}

  public prepare(sql: string): IStatement {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      get: (...args: unknown[]) => {
        if (normalized.includes('FROM store_commerce_order_ledger WHERE order_id')) {
          const record = this.state.orders.get(String(args[0]));
          return record === undefined ? undefined : { lifecycle_json: record.lifecycle };
        }
        if (normalized.includes('FROM store_commerce_order_ledger WHERE idempotency_key')) {
          for (const [orderId, record] of this.state.orders) {
            if (record.idempotencyKey === args[0]) return { order_id: orderId };
          }
          return undefined;
        }
        throw new Error(`Unsupported statement: ${normalized}`);
      },
      all: (...args: unknown[]) => {
        if (!normalized.includes('FROM store_commerce_event_ledger'))
          throw new Error(`Unsupported statement: ${normalized}`);
        if (normalized.includes('WHERE order_id = ?')) {
          const orderId = String(args[0]);
          return [...this.state.events.entries()]
            .filter(([, record]) => record.orderId === orderId)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([eventIdentity, record]) => ({
              event_identity: eventIdentity,
              kind: record.kind,
              payload_json: record.payload,
            }));
        }
        const [eventIdentity, idempotencyKey, providerEventId] = args.map((value) =>
          value === null ? null : String(value)
        );
        return [...this.state.events.entries()]
          .filter(
            ([identity, record]) =>
              identity === eventIdentity ||
              record.idempotencyKey === idempotencyKey ||
              (providerEventId !== null && record.providerEventId === providerEventId)
          )
          .map(([, record]) => ({ order_id: record.orderId, payload_json: record.payload }));
      },
      run: (...args: unknown[]) => {
        if (normalized.startsWith('INSERT INTO store_commerce_order_ledger')) {
          const [orderId, idempotencyKey, lifecycle] = args.map(String);
          this.state.orders.set(orderId, { idempotencyKey, lifecycle });
          return { changes: 1, lastInsertRowid: 1 };
        }
        if (normalized.startsWith('INSERT INTO store_commerce_event_ledger')) {
          const [identity, kind, providerEventId, idempotencyKey, orderId, payload] = args;
          this.state.events.set(String(identity), {
            kind: String(kind),
            providerEventId: providerEventId === null ? null : String(providerEventId),
            idempotencyKey: String(idempotencyKey),
            orderId: String(orderId),
            payload: String(payload),
          });
          return { changes: 1, lastInsertRowid: 1 };
        }
        if (normalized.startsWith('UPDATE store_commerce_order_ledger')) {
          const [lifecycle, orderId] = args.map(String);
          const record = this.state.orders.get(orderId);
          if (record === undefined) return { changes: 0, lastInsertRowid: 0 };
          this.state.orders.set(orderId, { ...record, lifecycle });
          return { changes: 1, lastInsertRowid: 0 };
        }
        throw new Error(`Unsupported statement: ${normalized}`);
      },
    };
  }

  public exec(_sql: string): void {}
  public pragma(_sql: string, _options?: { simple?: boolean }): unknown {
    return undefined;
  }
  public transaction<T>(operation: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return operation;
  }
  public close(): void {}
}

const initialOrder = {
  schemaVersion: 1,
  orderId: 'order-1',
  accountId: 'account-1',
  offer: {
    schemaVersion: 1,
    offerId: 'offer-1',
    productId: 'product-1',
    package: { packageId: 'com.tomny.core', packageVersion: '1.0.0', publisherId: 'com.tomny' },
    sellerKind: 'first-party',
    price: { currency: 'USD', amountMinor: 500 },
    taxTreatment: 'not-applicable',
    revision: 'rev-1',
    active: true,
  },
  state: 'created',
  idempotencyKey: 'create-1',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
} as const;

const payment = (kind: 'authorized' | 'captured' | 'failed', suffix: string, occurredAt: string) => ({
  schemaVersion: 1,
  paymentEventId: `payment-${suffix}`,
  orderId: 'order-1',
  providerEventId: `provider-${suffix}`,
  kind,
  amount: { currency: 'USD', amountMinor: 500 },
  idempotencyKey: `payment-key-${suffix}`,
  occurredAt,
});

const refund = {
  schemaVersion: 1,
  refundId: 'refund-1',
  orderId: 'order-1',
  paymentEventId: 'payment-capture',
  amount: { currency: 'USD', amountMinor: 500 },
  reasonCode: 'customer-request',
  idempotencyKey: 'refund-key-1',
  createdAt: '2026-08-14T00:03:00.000Z',
} as const;

const createLedger = () => {
  const state: InMemoryCommerceDatabase = { orders: new Map(), events: new Map() };
  let count = 0;
  const open = () =>
    new StoreCommerceLedger(new CommerceLedgerDriver(state), {
      createId: () => `opaque-${++count}`,
      policyVersion: 'store-commerce-v1',
    });
  return { open, state };
};

describe('StoreCommerceLedger', () => {
  it('persists a captured entitlement and opaque acquisition grant across restart, then revokes them on full refund', async () => {
    const { open } = createLedger();
    const first = open();
    expect(first.createOrder(initialOrder).order.state).toBe('created');
    expect(first.recordPayment(payment('authorized', 'authorization', '2026-08-14T00:01:00.000Z')).order.state).toBe(
      'payment-pending'
    );
    const captured = first.recordPayment(payment('captured', 'capture', '2026-08-14T00:02:00.000Z'));
    expect(captured).toMatchObject({
      order: { state: 'paid' },
      entitlement: { state: 'active', entitlementId: 'entitlement:opaque-1' },
      activeGrant: { grantId: 'grant:opaque-2', offlineRule: 'none' },
    });

    const restarted = open();
    expect(restarted.getLifecycle('order-1')).toEqual(captured);
    const refunded = restarted.recordRefund(refund);
    expect(refunded).toMatchObject({ order: { state: 'refunded' }, entitlement: { state: 'revoked' } });
    expect(refunded.activeGrant).toBeUndefined();
    expect(open().getLifecycle('order-1')).toEqual(refunded);
  });

  it('accepts only exact idempotent replay and rejects duplicate, conflicting, and out-of-order evidence without effects', async () => {
    const { open } = createLedger();
    const ledger = open();
    ledger.createOrder(initialOrder);
    const authorization = payment('authorized', 'authorization', '2026-08-14T00:01:00.000Z');
    const pending = ledger.recordPayment(authorization);
    expect(ledger.recordPayment(authorization)).toEqual(pending);
    expect(() => ledger.recordPayment(payment('captured', 'capture', '2026-08-14T00:00:30.000Z'))).toThrow(
      /authoritative occurrence order/i
    );
    expect(ledger.getLifecycle('order-1')).toEqual(pending);
    expect(() => ledger.recordPayment({ ...authorization, amount: { currency: 'USD', amountMinor: 501 } })).toThrow(
      /different authoritative evidence/i
    );
    expect(ledger.getLifecycle('order-1')).toEqual(pending);
    expect(() => ledger.recordRefund(refund)).toThrow(/paid order/i);
    expect(ledger.getLifecycle('order-1')).toEqual(pending);
  });

  it('keeps payment, entitlement, grant, and refund exactly once across reopen and replay', () => {
    const { open, state } = createLedger();
    const authorization = payment('authorized', 'authorization', '2026-08-14T00:01:00.000Z');
    const capture = payment('captured', 'capture', '2026-08-14T00:02:00.000Z');
    const first = open();
    first.createOrder(initialOrder);
    first.recordPayment(authorization);
    const paid = first.recordPayment(capture);

    const reopened = open();
    expect(reopened.recordPayment(capture)).toEqual(paid);
    expect(state.orders).toHaveLength(1);
    expect(state.events).toHaveLength(2);
    expect(reopened.recordRefund(refund)).toMatchObject({
      order: { state: 'refunded' },
      entitlement: { state: 'revoked' },
    });

    const afterRefundRestart = open();
    const refunded = afterRefundRestart.getLifecycle('order-1');
    expect(afterRefundRestart.recordPayment(capture)).toEqual(refunded);
    expect(afterRefundRestart.recordRefund(refund)).toEqual(refunded);
    expect(state.orders).toHaveLength(1);
    expect(state.events).toHaveLength(3);
    expect(refunded).toMatchObject({
      paymentEvents: expect.arrayContaining([
        expect.objectContaining({ paymentEventId: authorization.paymentEventId }),
        expect.objectContaining({ paymentEventId: capture.paymentEventId }),
      ]),
      refunds: [expect.objectContaining({ refundId: refund.refundId })],
    });
    expect(refunded?.paymentEvents).toHaveLength(3);
    expect(refunded?.activeGrant).toBeUndefined();
    expect(() => afterRefundRestart.recordPayment(payment('authorized', 'late', '2026-08-14T00:04:00.000Z'))).toThrow(
      /out-of-order/i
    );
    expect(state.events).toHaveLength(3);
  });

  it('fails closed on reopen when the append-only evidence rows no longer match the stored lifecycle', () => {
    const { open, state } = createLedger();
    const ledger = open();
    ledger.createOrder(initialOrder);
    ledger.recordPayment(payment('authorized', 'authorization', '2026-08-14T00:01:00.000Z'));
    state.events.clear();
    expect(() => open().getLifecycle('order-1')).toThrow(/evidence is incomplete/i);
  });
});
