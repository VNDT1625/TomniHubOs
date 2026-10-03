export type CheckoutSession = Readonly<{ provider: string; reference: string; url?: string }>;
export type PaymentProvider = Readonly<{
  createCheckout: (
    input: Readonly<{
      orderId: string;
      amountMinor: number;
      currency: string;
      packageId: string;
      version: string;
      priceId: string;
    }>
  ) => Promise<CheckoutSession>;
}>;
export type RefundProvider = Readonly<{
  requestRefund: (
    input: Readonly<{ orderId: string; amountMinor: number; currency: string }>
  ) => Promise<Readonly<{ reference: string }>>;
}>;
export type PayoutProvider = Readonly<{
  createPayout: (
    input: Readonly<{ publisherId: string; amountMinor: number; currency: string }>
  ) => Promise<Readonly<{ reference: string }>>;
}>;
type PaddleResponse = Readonly<{ data?: Readonly<{ id?: string; checkout?: Readonly<{ url?: string }> }> }>;
type PaddleRequestConfig = Readonly<{ apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }>;
const postPaddle = async (input: PaddleRequestConfig, path: string, body: unknown): Promise<PaddleResponse> => {
  const base = new URL(input.baseUrl ?? 'https://api.paddle.com');
  const local = base.hostname === '127.0.0.1' || base.hostname === 'localhost';
  if (base.protocol !== 'https:' && !local) throw new Error('PADDLE_ENDPOINT_INVALID');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(input.timeoutMs ?? 15_000, 1_000), 60_000));
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${base.toString().replace(/\/$/u, '')}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('PADDLE_PROVIDER_TIMEOUT', { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error('PADDLE_PROVIDER_REQUEST_FAILED');
  const payload = (await response.json()) as PaddleResponse;
  if (!payload.data?.id) throw new Error('PADDLE_PROVIDER_INVALID_RESPONSE');
  return payload;
};
export const createPaddlePaymentProvider = (input: PaddleRequestConfig): PaymentProvider => ({
  createCheckout: async (order) => {
    if (!order.priceId.trim()) throw new Error('PADDLE_PRICE_ID_REQUIRED');
    const payload = await postPaddle(input, '/transactions', {
      items: [{ price_id: order.priceId }],
      custom_data: { order_id: order.orderId, version: order.version },
    });
    return { provider: 'paddle', reference: payload.data!.id!, url: payload.data?.checkout?.url };
  },
});
export const createPaddleRefundProvider = (input: PaddleRequestConfig): RefundProvider => ({
  requestRefund: async (refund) => {
    const payload = await postPaddle(input, '/adjustments', {
      action: 'refund',
      transaction_id: refund.orderId,
      amount: { currency_code: refund.currency, value: String(refund.amountMinor) },
    });
    return { reference: payload.data!.id! };
  },
});
export const unavailablePaymentProvider: PaymentProvider = {
  createCheckout: async () => {
    throw new Error('PADDLE_NOT_CONFIGURED');
  },
};
export const unavailablePayoutProvider: PayoutProvider = {
  createPayout: async () => {
    throw new Error('PAYOUT_NOT_SUPPORTED');
  },
};

export const unavailableRefundProvider: RefundProvider = {
  requestRefund: async () => {
    throw new Error('PADDLE_NOT_CONFIGURED');
  },
};
