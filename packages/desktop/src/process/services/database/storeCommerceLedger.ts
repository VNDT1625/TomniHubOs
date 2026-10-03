/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  parseCommerceOrder,
  parseCommerceOrderLifecycle,
  parsePaymentEvent,
  parseRefund,
  type AcquisitionGrant,
  type CommerceOrder,
  type CommerceOrderLifecycle,
  type Entitlement,
  type PaymentEvent,
  type Refund,
} from '@/common/packages';
import type { ISqliteDriver } from './drivers/ISqliteDriver';

const MAX_LIFECYCLE_BYTES = 64 * 1024;
const STORE_COMMERCE_POLICY_VERSION = 'store-commerce-v1';

export type StoreCommerceLedgerOptions = {
  createId?: () => string;
  policyVersion?: string;
};

type LedgerRow = Readonly<{ lifecycle_json: string }>;
type EventRow = Readonly<{ order_id: string; payload_json: string }>;
type OrderEventRow = Readonly<{ event_identity: string; kind: 'payment' | 'refund'; payload_json: string }>;

const clone = <T>(value: T): T => structuredClone(value);
const serialize = (value: unknown): string => JSON.stringify(value);
const isNonBlankText = (value: string): boolean => value.trim().length > 0 && value.length <= 200;

const assertSafeId = (label: string, value: string): void => {
  if (!isNonBlankText(value) || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
};

const latestTime = (left: string, right: string): string => (Date.parse(left) >= Date.parse(right) ? left : right);

/**
 * Main-process Store ledger for validated authoritative ordinary-money events.
 * It is deliberately not a payment-provider adapter and can never mint Credit.
 */
export class StoreCommerceLedger {
  private readonly createId: () => string;
  private readonly policyVersion: string;

  public constructor(
    private readonly database: ISqliteDriver,
    options: StoreCommerceLedgerOptions = {}
  ) {
    this.createId = options.createId ?? randomUUID;
    this.policyVersion = options.policyVersion ?? STORE_COMMERCE_POLICY_VERSION;
    assertSafeId('Store commerce policy version', this.policyVersion);
    this.initialize();
  }

  /** Creates one Store order before payment evidence is accepted. */
  public createOrder(input: unknown): CommerceOrderLifecycle {
    const order = parseCommerceOrder(input);
    if (order.state !== 'created' || order.createdAt !== order.updatedAt || !order.offer.active) {
      throw new Error('A Store order must begin as an active created offer with matching creation and update time.');
    }
    const lifecycle = parseCommerceOrderLifecycle({ order, paymentEvents: [], refunds: [] });
    return this.transaction(() => {
      const existing = this.lookupLifecycle(order.orderId);
      if (existing !== undefined) {
        if (serialize(existing) !== serialize(lifecycle))
          throw new Error('Store order ID is already bound to another order.');
        return existing;
      }
      const idempotency = this.database
        .prepare('SELECT order_id FROM store_commerce_order_ledger WHERE idempotency_key = ?')
        .get(order.idempotencyKey) as { order_id?: unknown } | undefined;
      if (idempotency !== undefined) throw new Error('Store order idempotency key is already bound to another order.');
      this.database
        .prepare('INSERT INTO store_commerce_order_ledger (order_id, idempotency_key, lifecycle_json) VALUES (?, ?, ?)')
        .run(order.orderId, order.idempotencyKey, serialize(lifecycle));
      return clone(lifecycle);
    });
  }

  /** Applies authorization, capture, or failure exactly once; only capture can issue commercial admission. */
  public recordPayment(input: unknown): CommerceOrderLifecycle {
    const payment = parsePaymentEvent(input);
    if (payment.kind === 'refunded')
      throw new Error('Refund payment events are not accepted; record a compensating Store refund.');
    const paymentKind: Exclude<typeof payment.kind, 'refunded'> = payment.kind;
    return this.transaction(() => {
      const existingEvent = this.lookupEvent(
        'payment',
        payment.paymentEventId,
        payment.providerEventId,
        payment.idempotencyKey
      );
      if (existingEvent !== undefined) {
        if (existingEvent.order_id !== payment.orderId || existingEvent.payload_json !== serialize(payment)) {
          throw new Error('Store payment identifier is already bound to different authoritative evidence.');
        }
        return this.requireLifecycle(payment.orderId);
      }

      const lifecycle = this.requireLifecycle(payment.orderId);
      const nextState = this.nextPaymentState(lifecycle.order.state, paymentKind);
      const nextOrder: CommerceOrder = {
        ...lifecycle.order,
        state: nextState,
        updatedAt: latestTime(lifecycle.order.updatedAt, payment.occurredAt),
      };
      const captured = paymentKind === 'captured';
      const entitlement: Entitlement | undefined = captured
        ? {
            schemaVersion: 1,
            entitlementId: `entitlement:${this.createId()}`,
            accountId: nextOrder.accountId,
            offerId: nextOrder.offer.offerId,
            package: clone(nextOrder.offer.package),
            state: 'active',
            issuedAt: payment.occurredAt,
          }
        : lifecycle.entitlement;
      const activeGrant: AcquisitionGrant | undefined = captured
        ? {
            schemaVersion: 1,
            grantId: `grant:${this.createId()}`,
            accountId: nextOrder.accountId,
            offerId: nextOrder.offer.offerId,
            package: clone(nextOrder.offer.package),
            entitlementId: entitlement!.entitlementId,
            policyVersion: this.policyVersion,
            offlineRule: 'none',
          }
        : lifecycle.activeGrant;
      const next = parseCommerceOrderLifecycle({
        order: nextOrder,
        paymentEvents: [...lifecycle.paymentEvents, payment],
        refunds: lifecycle.refunds,
        ...(entitlement === undefined ? {} : { entitlement }),
        ...(activeGrant === undefined ? {} : { activeGrant }),
      });
      this.persistEvent(
        'payment',
        payment.paymentEventId,
        payment.providerEventId,
        payment.idempotencyKey,
        payment.orderId,
        payment
      );
      this.persistLifecycle(next);
      return clone(next);
    });
  }

  /** Applies a full compensating refund exactly once and revokes the matching active commercial admission. */
  public recordRefund(input: unknown): CommerceOrderLifecycle {
    const refund = parseRefund(input);
    return this.transaction(() => {
      const existingEvent = this.lookupEvent('refund', refund.refundId, undefined, refund.idempotencyKey);
      if (existingEvent !== undefined) {
        if (existingEvent.order_id !== refund.orderId || existingEvent.payload_json !== serialize(refund)) {
          throw new Error('Store refund identifier is already bound to different authoritative evidence.');
        }
        return this.requireLifecycle(refund.orderId);
      }
      const lifecycle = this.requireLifecycle(refund.orderId);
      if (lifecycle.order.state !== 'paid' || lifecycle.entitlement?.state !== 'active') {
        throw new Error('A Store refund requires one paid order with an active entitlement.');
      }
      const next = parseCommerceOrderLifecycle({
        order: {
          ...lifecycle.order,
          state: 'refunded',
          updatedAt: latestTime(lifecycle.order.updatedAt, refund.createdAt),
        },
        paymentEvents: [
          ...lifecycle.paymentEvents,
          {
            schemaVersion: 1,
            paymentEventId: `refund:${refund.refundId}`,
            orderId: refund.orderId,
            providerEventId: `refund:${refund.refundId}`,
            kind: 'refunded',
            amount: clone(refund.amount),
            idempotencyKey: `refund-event:${refund.idempotencyKey}`,
            occurredAt: refund.createdAt,
          },
        ],
        refunds: [...lifecycle.refunds, refund],
        entitlement: { ...lifecycle.entitlement, state: 'revoked' },
      });
      this.persistEvent('refund', refund.refundId, undefined, refund.idempotencyKey, refund.orderId, refund);
      this.persistLifecycle(next);
      return clone(next);
    });
  }

  /** Reconstructs and revalidates persisted state; tampered or incomplete evidence fails closed. */
  public getLifecycle(orderId: string): CommerceOrderLifecycle | undefined {
    assertSafeId('Store order ID', orderId);
    return this.transaction(() => this.lookupLifecycle(orderId));
  }

  private initialize(): void {
    this.database.exec(`CREATE TABLE IF NOT EXISTS store_commerce_order_ledger (
      order_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      lifecycle_json TEXT NOT NULL CHECK(length(lifecycle_json) <= ${MAX_LIFECYCLE_BYTES})
    )`);
    this.database.exec(`CREATE TABLE IF NOT EXISTS store_commerce_event_ledger (
      event_identity TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('payment', 'refund')),
      provider_event_id TEXT UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(length(payload_json) <= ${MAX_LIFECYCLE_BYTES}),
      FOREIGN KEY(order_id) REFERENCES store_commerce_order_ledger(order_id) ON DELETE RESTRICT
    )`);
  }

  private transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  private lookupLifecycle(orderId: string): CommerceOrderLifecycle | undefined {
    const row = this.database
      .prepare('SELECT lifecycle_json FROM store_commerce_order_ledger WHERE order_id = ?')
      .get(orderId) as LedgerRow | undefined;
    if (row === undefined) return undefined;
    if (typeof row.lifecycle_json !== 'string' || row.lifecycle_json.length > MAX_LIFECYCLE_BYTES) {
      throw new Error('Persisted Store lifecycle is invalid.');
    }
    let value: unknown;
    try {
      value = JSON.parse(row.lifecycle_json);
    } catch {
      throw new Error('Persisted Store lifecycle cannot be decoded.');
    }
    const lifecycle = parseCommerceOrderLifecycle(value);
    this.assertEvidenceMatchesLifecycle(orderId, lifecycle);
    return clone(lifecycle);
  }

  private requireLifecycle(orderId: string): CommerceOrderLifecycle {
    const lifecycle = this.lookupLifecycle(orderId);
    if (lifecycle === undefined) throw new Error('Store order does not exist.');
    return lifecycle;
  }

  private lookupEvent(
    kind: 'payment' | 'refund',
    eventIdentity: string,
    providerEventId: string | undefined,
    idempotencyKey: string
  ): EventRow | undefined {
    const rows = this.database
      .prepare(
        'SELECT order_id, payload_json FROM store_commerce_event_ledger WHERE event_identity = ? OR idempotency_key = ? OR (? IS NOT NULL AND provider_event_id = ?)'
      )
      .all(eventIdentity, idempotencyKey, providerEventId, providerEventId) as EventRow[];
    if (rows.length === 0) return undefined;
    if (rows.length !== 1) throw new Error(`Store ${kind} identifiers resolve to conflicting records.`);
    return rows[0];
  }

  /**
   * The lifecycle is a materialized view, never the sole accounting authority.
   * Reopening the ledger therefore proves its payment/refund evidence still has
   * exactly one immutable event row for every recorded real-world event.
   */
  private assertEvidenceMatchesLifecycle(orderId: string, lifecycle: CommerceOrderLifecycle): void {
    const rows = this.database
      .prepare(
        'SELECT event_identity, kind, payload_json FROM store_commerce_event_ledger WHERE order_id = ? ORDER BY event_identity ASC'
      )
      .all(orderId) as OrderEventRow[];

    const expected = new Map<string, { kind: 'payment' | 'refund'; payload: string }>();
    for (const payment of lifecycle.paymentEvents) {
      if (payment.kind === 'refunded') continue;
      if (expected.has(payment.paymentEventId))
        throw new Error('Persisted Store lifecycle has duplicate payment evidence.');
      expected.set(payment.paymentEventId, { kind: 'payment', payload: serialize(payment) });
    }
    for (const refund of lifecycle.refunds) {
      if (expected.has(refund.refundId)) throw new Error('Persisted Store lifecycle has conflicting refund evidence.');
      expected.set(refund.refundId, { kind: 'refund', payload: serialize(refund) });
    }

    if (rows.length !== expected.size) throw new Error('Persisted Store evidence is incomplete or duplicated.');
    for (const row of rows) {
      if (
        typeof row.event_identity !== 'string' ||
        (row.kind !== 'payment' && row.kind !== 'refund') ||
        typeof row.payload_json !== 'string' ||
        row.payload_json.length > MAX_LIFECYCLE_BYTES
      ) {
        throw new Error('Persisted Store evidence is invalid.');
      }
      const expectedEvent = expected.get(row.event_identity);
      if (
        expectedEvent === undefined ||
        expectedEvent.kind !== row.kind ||
        expectedEvent.payload !== row.payload_json
      ) {
        throw new Error('Persisted Store evidence does not match its lifecycle.');
      }
      expected.delete(row.event_identity);
    }
    if (expected.size !== 0) throw new Error('Persisted Store evidence is incomplete.');
  }

  private persistEvent(
    kind: 'payment' | 'refund',
    eventIdentity: string,
    providerEventId: string | undefined,
    idempotencyKey: string,
    orderId: string,
    payload: PaymentEvent | Refund
  ): void {
    this.database
      .prepare(
        'INSERT INTO store_commerce_event_ledger (event_identity, kind, provider_event_id, idempotency_key, order_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(eventIdentity, kind, providerEventId ?? null, idempotencyKey, orderId, serialize(payload));
  }

  private persistLifecycle(lifecycle: CommerceOrderLifecycle): void {
    const update = this.database
      .prepare('UPDATE store_commerce_order_ledger SET lifecycle_json = ? WHERE order_id = ?')
      .run(serialize(lifecycle), lifecycle.order.orderId);
    if (update.changes !== 1) throw new Error('Store lifecycle persistence failed.');
  }

  private nextPaymentState(
    current: CommerceOrder['state'],
    kind: Exclude<PaymentEvent['kind'], 'refunded'>
  ): CommerceOrder['state'] {
    if (current === 'created' && kind === 'authorized') return 'payment-pending';
    if (current === 'payment-pending' && kind === 'captured') return 'paid';
    if (current === 'payment-pending' && kind === 'failed') return 'failed';
    throw new Error(`Out-of-order Store payment event: ${current} cannot accept ${kind}.`);
  }
}
