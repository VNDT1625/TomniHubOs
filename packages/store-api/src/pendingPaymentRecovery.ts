import type { Pool } from 'pg';
import type { CommerceRepository, PendingPaymentWebhook } from './commerceRepository.js';

const parsePendingPayment = (value: unknown): PendingPaymentWebhook => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PENDING_PAYMENT_PAYLOAD_INVALID');
  const payload = value as Record<string, unknown>;
  const required = (key: keyof PendingPaymentWebhook): string => {
    const field = payload[key];
    if (typeof field !== 'string' || !field) throw new Error('PENDING_PAYMENT_PAYLOAD_INVALID');
    return field;
  };
  const amountMinor = Number(payload.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('PENDING_PAYMENT_PAYLOAD_INVALID');
  return {
    providerEventId: required('providerEventId'),
    orderId: required('orderId'),
    provider: required('provider'),
    providerReference: required('providerReference'),
    amountMinor,
    currency: required('currency'),
    actorSubject: required('actorSubject'),
    ...(typeof payload.payloadHash === 'string' ? { payloadHash: payload.payloadHash } : {}),
  };
};

export const replayPendingPaymentWebhook = async (
  pool: Pool,
  commerce: CommerceRepository,
  orderId: string
): Promise<boolean> => {
  let replayed = false;
  // Drain all currently available events so one recovery lease cannot strand
  // later out-of-order events for the same order.
  for (;;) {
    const pending = await pool.query<{ payload_json: unknown }>(
      "SELECT payload_json FROM pending_payment_webhooks WHERE provider='paddle' AND order_id=$1 AND state='pending' AND available_at <= now() ORDER BY created_at LIMIT 1",
      [orderId]
    );
    if (!pending.rowCount) return replayed;
    const result = await commerce.applyCapturedPayment(parsePendingPayment(pending.rows[0]!.payload_json));
    if (result.pending) throw new Error('PAYMENT_WEBHOOK_PREREQUISITE_MISSING');
    replayed = true;
  }
};
