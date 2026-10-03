import { createHmac, timingSafeEqual } from 'node:crypto';
export const verifyPaddleWebhook = (
  rawBody: Uint8Array,
  signature: string,
  secret: string,
  nowMs = Date.now()
): void => {
  const fields = Object.fromEntries(signature.split(';').map((part) => part.split('=', 2) as [string, string]));
  const ts = fields.ts;
  const supplied = fields.h1;
  if (
    !ts ||
    !/^\d+$/.test(ts) ||
    Math.abs(nowMs - Number(ts) * 1000) > 300_000 ||
    !supplied ||
    !/^[a-f0-9]{64}$/.test(supplied)
  )
    throw new Error('PADDLE_SIGNATURE_INVALID');
  const expected = createHmac('sha256', secret).update(`${ts}:`).update(rawBody).digest('hex');
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new Error('PADDLE_SIGNATURE_INVALID');
};
export type PayoutProvider = Readonly<{ createPayout(): Promise<never> }>;
export const unsupportedMvpPayoutProvider: PayoutProvider = {
  createPayout: async () => {
    throw new Error('PAYOUT_NOT_SUPPORTED_MVP');
  },
};
