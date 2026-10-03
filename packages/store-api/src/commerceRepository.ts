import type { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { assertBalancedLedger } from './ledger.js';

export type CommerceRepository = Readonly<{
  applyCapturedPayment: (
    input: Readonly<{
      providerEventId: string;
      orderId: string;
      provider: string;
      providerReference: string;
      amountMinor: number;
      currency: string;
      actorSubject: string;
      payloadHash?: string;
    }>
  ) => Promise<{ duplicate: boolean; pending?: boolean; entitlementId?: string }>;
  requestRefund: (
    input: Readonly<{
      accountId: string;
      orderId: string;
      amountMinor: number;
      currency: string;
      reason: string;
      actorSubject: string;
      idempotencyKey: string;
    }>
  ) => Promise<{ refundId: string; state: 'requested'; providerTransactionId: string; replayed?: boolean }>;
  confirmRefund: (
    input: Readonly<{
      providerEventId: string;
      refundId: string;
      providerRefundId: string;
      actorSubject: string;
      payloadHash?: string;
    }>
  ) => Promise<{ duplicate: boolean; pending?: boolean; entitlementId?: string }>;
  createReconciliationRun: (provider: string) => Promise<string>;
  enqueueRecovery: (jobType: string, aggregateId: string) => Promise<void>;
}>;

export type PendingPaymentWebhook = Readonly<{
  providerEventId: string;
  orderId: string;
  provider: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
  actorSubject: string;
  payloadHash?: string;
}>;

export const assertWebhookPayloadConsistency = (existingHash: string, expectedHash: string): void => {
  if (existingHash !== expectedHash) throw new Error('WEBHOOK_PAYLOAD_CONFLICT');
};

const tx = async <T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const createCommerceRepository = (pool: Pool): CommerceRepository => ({
  applyCapturedPayment: (input) =>
    tx(pool, async (c) => {
      const seen = await c.query(
        'INSERT INTO webhook_events(provider,provider_event_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING provider_event_id',
        ['paddle', input.providerEventId, input.payloadHash ?? input.providerEventId]
      );
      if (!seen.rowCount) {
        const existing = await c.query<{ payload_hash: string }>(
          'SELECT payload_hash FROM webhook_events WHERE provider=$1 AND provider_event_id=$2 FOR UPDATE',
          ['paddle', input.providerEventId]
        );
        if (!existing.rowCount || existing.rows[0]!.payload_hash !== (input.payloadHash ?? input.providerEventId))
          throw new Error('WEBHOOK_PAYLOAD_CONFLICT');
        const pending = await c.query(
          "SELECT 1 FROM pending_payment_webhooks WHERE provider='paddle' AND provider_event_id=$1 AND state='pending' FOR UPDATE",
          [input.providerEventId]
        );
        if (!pending.rowCount) return { duplicate: true };
      }
      const order = await c.query<{
        account_id: string;
        package_id: string;
        version: string;
        state: string;
        amount_minor: string;
        currency: string;
      }>('SELECT account_id,package_id,version,state,amount_minor,currency FROM orders WHERE order_id=$1 FOR UPDATE', [
        input.orderId,
      ]);
      if (!order.rowCount) {
        // Preserve an out-of-order provider event for a later reconciliation pass.
        await c.query(
          'INSERT INTO pending_payment_webhooks(provider,provider_event_id,order_id,payload_json,payload_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,provider_event_id) DO NOTHING',
          [
            'paddle',
            input.providerEventId,
            input.orderId,
            JSON.stringify(input),
            input.payloadHash ?? input.providerEventId,
          ]
        );
        await c.query(
          'INSERT INTO recovery_jobs(job_type,aggregate_id,state) VALUES($1,$2,$3) ON CONFLICT(job_type,aggregate_id) DO NOTHING',
          ['payment-webhook-prerequisite', input.orderId, 'pending']
        );
        await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
          input.actorSubject,
          'payment.webhook_pending_prerequisite',
          JSON.stringify({ providerEventId: input.providerEventId, orderId: input.orderId }),
        ]);
        return { duplicate: false, pending: true };
      }
      const row = order.rows[0]!;
      if (Number(row.amount_minor) !== input.amountMinor || row.currency !== input.currency)
        throw new Error('PAYMENT_AMOUNT_MISMATCH');
      if (row.state === 'paid') return { duplicate: true };
      if (!['created', 'checkout_pending'].includes(row.state)) throw new Error('ORDER_STATE_INVALID');
      await c.query('UPDATE orders SET state=$1 WHERE order_id=$2', ['paid', input.orderId]);
      await c.query(
        "UPDATE pending_payment_webhooks SET state='applied' WHERE provider='paddle' AND provider_event_id=$1 AND state='pending'",
        [input.providerEventId]
      );
      await c.query(
        'INSERT INTO payments(order_id,provider,provider_reference,state,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6)',
        [input.orderId, input.provider, input.providerReference, 'captured', input.amountMinor, input.currency]
      );
      await c.query(
        'INSERT INTO payment_events(payment_event_id,provider_event_id,order_id,payload_json) VALUES($1,$2,$3,$4)',
        [randomUUID(), input.providerEventId, input.orderId, JSON.stringify(input)]
      );
      assertBalancedLedger([
        { direction: 'debit', amountMinor: input.amountMinor, currency: input.currency },
        { direction: 'credit', amountMinor: input.amountMinor, currency: input.currency },
      ]);
      const entitlement = await c.query<{ entitlement_id: string }>(
        'INSERT INTO entitlements(account_id,package_id,version,state) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,package_id,version) DO UPDATE SET state=$4,revision=entitlements.revision+1 RETURNING entitlement_id',
        [row.account_id, row.package_id, row.version, 'active']
      );
      const entitlementId = entitlement.rows[0]!.entitlement_id;
      await c.query('INSERT INTO entitlement_events(entitlement_id,event_kind,payload_json) VALUES($1,$2,$3)', [
        entitlementId,
        'issued',
        JSON.stringify(input),
      ]);
      await c.query('INSERT INTO ledger_transactions(source_event_id) VALUES($1) ON CONFLICT DO NOTHING', [
        input.providerEventId,
      ]);
      const txRow = await c.query<{ transaction_id: string }>(
        'SELECT transaction_id FROM ledger_transactions WHERE source_event_id=$1',
        [input.providerEventId]
      );
      await c.query(
        'INSERT INTO ledger_entries(transaction_id,account_code,direction,amount_minor,currency) VALUES($1,$2,$3,$4,$5),($1,$6,$7,$4,$5)',
        [txRow.rows[0]!.transaction_id, 'cash', 'debit', input.amountMinor, input.currency, 'revenue', 'credit']
      );
      await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
        input.actorSubject,
        'payment.captured',
        JSON.stringify(input),
      ]);
      await c.query('INSERT INTO outbox_events(topic,aggregate_id,payload_json,state) VALUES($1,$2,$3,$4)', [
        'entitlement.issued',
        entitlementId,
        JSON.stringify(input),
        'pending',
      ]);
      return { duplicate: false, entitlementId };
    }),
  requestRefund: (input) =>
    tx(pool, async (c) => {
      const order = await c.query<{
        account_id: string;
        amount_minor: string;
        state: string;
        provider_reference: string;
        currency: string;
      }>(
        'SELECT o.account_id,o.amount_minor,o.state,p.provider_reference,p.currency FROM orders o JOIN payments p ON p.order_id=o.order_id WHERE o.order_id=$1 FOR UPDATE',
        [input.orderId]
      );
      if (!order.rowCount || order.rows[0]!.account_id !== input.accountId || order.rows[0]!.state !== 'paid')
        throw new Error('REFUND_NOT_ELIGIBLE');
      if (!order.rows[0]!.provider_reference) throw new Error('PAYMENT_PROVIDER_REFERENCE_MISSING');
      if (order.rows[0]!.currency !== input.currency) throw new Error('REFUND_CURRENCY_MISMATCH');
      const requestFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            orderId: input.orderId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            reason: input.reason,
          })
        )
        .digest('hex');
      const keyed = await c.query<{ refund_id: string; request_fingerprint: string | null }>(
        'SELECT refund_id,request_fingerprint FROM refunds WHERE order_id=$1 AND idempotency_key=$2 FOR UPDATE',
        [input.orderId, input.idempotencyKey]
      );
      if (keyed.rowCount) {
        if (keyed.rows[0]!.request_fingerprint !== requestFingerprint) throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        return {
          refundId: keyed.rows[0]!.refund_id,
          state: 'requested',
          providerTransactionId: order.rows[0]!.provider_reference!,
          replayed: true,
        };
      }
      if (
        !Number.isSafeInteger(input.amountMinor) ||
        input.amountMinor <= 0 ||
        input.amountMinor > Number(order.rows[0]!.amount_minor)
      )
        throw new Error('REFUND_AMOUNT_INVALID');
      const existing = await c.query<{ refund_id: string }>(
        'SELECT refund_id FROM refunds WHERE order_id=$1 AND state IN ($2,$3)',
        [input.orderId, 'requested', 'confirmed']
      );
      if (existing.rowCount)
        return {
          refundId: existing.rows[0]!.refund_id,
          state: 'requested',
          providerTransactionId: order.rows[0]!.provider_reference!,
          replayed: true,
        };
      const result = await c.query<{ refund_id: string }>(
        'INSERT INTO refunds(order_id,state,amount_minor,reason,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6) RETURNING refund_id',
        [input.orderId, 'requested', input.amountMinor, input.reason, input.idempotencyKey, requestFingerprint]
      );
      await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
        input.actorSubject,
        'refund.requested',
        JSON.stringify(input),
      ]);
      await c.query('INSERT INTO outbox_events(topic,aggregate_id,payload_json,state) VALUES($1,$2,$3,$4)', [
        'refund.requested',
        result.rows[0]!.refund_id,
        JSON.stringify(input),
        'pending',
      ]);
      return {
        refundId: result.rows[0]!.refund_id,
        state: 'requested',
        providerTransactionId: order.rows[0]!.provider_reference!,
      };
    }),
  confirmRefund: (input) =>
    tx(pool, async (c) => {
      const seen = await c.query(
        'INSERT INTO webhook_events(provider,provider_event_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING provider_event_id',
        ['paddle', input.providerEventId, input.payloadHash ?? input.providerEventId]
      );
      if (!seen.rowCount) {
        const existing = await c.query<{ payload_hash: string }>(
          'SELECT payload_hash FROM webhook_events WHERE provider=$1 AND provider_event_id=$2 FOR UPDATE',
          ['paddle', input.providerEventId]
        );
        if (!existing.rowCount || existing.rows[0]!.payload_hash !== (input.payloadHash ?? input.providerEventId))
          throw new Error('WEBHOOK_PAYLOAD_CONFLICT');
        return { duplicate: true };
      }
      const refund = await c.query<{ order_id: string; amount_minor: string }>(
        'SELECT order_id,amount_minor FROM refunds WHERE refund_id=$1 AND state=$2 FOR UPDATE',
        [input.refundId, 'requested']
      );
      if (!refund.rowCount) throw new Error('REFUND_NOT_FOUND');
      const order = await c.query<{
        account_id: string;
        package_id: string;
        version: string;
        amount_minor: string;
        currency: string;
      }>('SELECT account_id,package_id,version,amount_minor,currency FROM orders WHERE order_id=$1 FOR UPDATE', [
        refund.rows[0]!.order_id,
      ]);
      if (!order.rowCount) throw new Error('ORDER_NOT_FOUND');
      await c.query('UPDATE refunds SET state=$1,provider_refund_id=$2 WHERE refund_id=$3', [
        'confirmed',
        input.providerRefundId,
        input.refundId,
      ]);
      const refundedTotal = await c.query<{ total: string }>(
        'SELECT COALESCE(SUM(amount_minor),0) AS total FROM refunds WHERE order_id=$1 AND state=$2',
        [refund.rows[0]!.order_id, 'confirmed']
      );
      const fullyRefunded = Number(refundedTotal.rows[0]!.total) >= Number(order.rows[0]!.amount_minor);
      if (fullyRefunded)
        await c.query('UPDATE orders SET state=$1 WHERE order_id=$2', ['refunded', refund.rows[0]!.order_id]);
      const ent = fullyRefunded
        ? await c.query<{ entitlement_id: string }>(
            'UPDATE entitlements SET state=$1,revision=revision+1 WHERE account_id=$2 AND package_id=$3 AND version=$4 AND state=$5 RETURNING entitlement_id',
            ['revoked', order.rows[0]!.account_id, order.rows[0]!.package_id, order.rows[0]!.version, 'active']
          )
        : { rowCount: 0, rows: [] as { entitlement_id: string }[] };
      if (ent.rowCount) {
        await c.query('INSERT INTO entitlement_events(entitlement_id,event_kind,payload_json) VALUES($1,$2,$3)', [
          ent.rows[0]!.entitlement_id,
          'revoked',
          JSON.stringify(input),
        ]);
      }
      await c.query(
        'INSERT INTO payment_events(payment_event_id,provider_event_id,order_id,payload_json) VALUES($1,$2,$3,$4)',
        [randomUUID(), input.providerEventId, refund.rows[0]!.order_id, JSON.stringify(input)]
      );
      await c.query('INSERT INTO ledger_transactions(source_event_id) VALUES($1) ON CONFLICT DO NOTHING', [
        input.providerEventId,
      ]);
      const txRow = await c.query<{ transaction_id: string }>(
        'SELECT transaction_id FROM ledger_transactions WHERE source_event_id=$1',
        [input.providerEventId]
      );
      assertBalancedLedger([
        { direction: 'debit', amountMinor: Number(refund.rows[0]!.amount_minor), currency: order.rows[0]!.currency },
        { direction: 'credit', amountMinor: Number(refund.rows[0]!.amount_minor), currency: order.rows[0]!.currency },
      ]);
      await c.query(
        'INSERT INTO ledger_entries(transaction_id,account_code,direction,amount_minor,currency) VALUES($1,$2,$3,$4,$5),($1,$6,$7,$4,$5)',
        [
          txRow.rows[0]!.transaction_id,
          'revenue',
          'debit',
          Number(refund.rows[0]!.amount_minor),
          order.rows[0]!.currency,
          'cash',
          'credit',
        ]
      );
      await c.query('INSERT INTO audit_events(actor_subject,action,payload_json) VALUES($1,$2,$3)', [
        input.actorSubject,
        'refund.confirmed',
        JSON.stringify(input),
      ]);
      await c.query('INSERT INTO outbox_events(topic,aggregate_id,payload_json,state) VALUES($1,$2,$3,$4)', [
        'refund.confirmed',
        input.refundId,
        JSON.stringify({ ...input, entitlementId: ent.rows[0]?.entitlement_id, fullyRefunded }),
        'pending',
      ]);
      return { duplicate: false, entitlementId: ent.rows[0]?.entitlement_id };
    }),
  createReconciliationRun: (provider) =>
    tx(
      pool,
      async (c) =>
        (
          await c.query<{ run_id: string }>(
            'INSERT INTO reconciliation_runs(provider,state) VALUES($1,$2) RETURNING run_id',
            [provider, 'running']
          )
        ).rows[0]!.run_id
    ),
  enqueueRecovery: (jobType, aggregateId) =>
    tx(pool, async (c) => {
      await c.query(
        'INSERT INTO recovery_jobs(job_type,aggregate_id,state) VALUES($1,$2,$3) ON CONFLICT(job_type,aggregate_id) DO NOTHING',
        [jobType, aggregateId, 'pending']
      );
    }),
});
