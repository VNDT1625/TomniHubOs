import { randomUUID } from 'node:crypto';

type JsonObject = Readonly<Record<string, unknown>>;
export type StoreApiClientOptions = Readonly<{
  baseUrl: string;
  accessToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;
export type StoreApiClient = Readonly<{
  catalog: () => Promise<JsonObject>;
  entitlements: () => Promise<JsonObject>;
  enrollPublisher: () => Promise<JsonObject>;
  stageArtifact: (input: JsonObject) => Promise<JsonObject>;
  submitPackage: (input: JsonObject, idempotencyKey: string) => Promise<JsonObject>;
  reviews: () => Promise<JsonObject>;
  decideReview: (reviewId: string, decision: 'approve' | 'reject', input: JsonObject) => Promise<JsonObject>;
  publishCatalog: (input: JsonObject) => Promise<JsonObject>;
  checkout: (input: JsonObject, idempotencyKey: string) => Promise<JsonObject>;
  refund: (input: JsonObject, idempotencyKey: string) => Promise<JsonObject>;
  downloadTicket: (digest: string) => Promise<JsonObject>;
}>;

const pathPart = (value: string): string => encodeURIComponent(value);
const requireObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('STORE_API_INVALID_RESPONSE');
  return value as JsonObject;
};

/** Main-process client; renderer never receives the service credential or raw refresh token. */
export const createStoreApiClient = (options: StoreApiClientOptions): StoreApiClient => {
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== 'https:' && baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost')
    throw new Error('STORE_API_BASE_URL_INVALID');
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = async (
    method: string,
    path: string,
    body?: JsonObject,
    idempotencyKey?: string
  ): Promise<JsonObject> => {
    const token = await options.accessToken();
    if (!token) throw new Error('STORE_API_AUTH_REQUIRED');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 15_000, 60_000));
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          'x-request-id': randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const payload = (await response.json().catch((): undefined => undefined)) as unknown;
      if (!response.ok) {
        const code = requireObject(payload).code;
        throw new Error(typeof code === 'string' ? code : 'STORE_API_REQUEST_FAILED');
      }
      return requireObject(payload);
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    catalog: () => request('GET', '/v1/catalog'),
    entitlements: () => request('GET', '/v1/entitlements'),
    enrollPublisher: () => request('POST', '/v1/publishers/enroll', {}),
    stageArtifact: (input) => request('POST', '/v1/publisher-artifacts/stage', input),
    submitPackage: (input, idempotencyKey) => request('POST', '/v1/submissions', input, idempotencyKey),
    reviews: () => request('GET', '/v1/reviews'),
    decideReview: (reviewId, decision, input) =>
      request('POST', '/v1/reviews/' + pathPart(reviewId) + '/' + decision, input),
    publishCatalog: (input) => request('POST', '/v1/catalog/publications', input),
    checkout: (input, idempotencyKey) => request('POST', '/v1/checkout', input, idempotencyKey),
    refund: (input, idempotencyKey) => request('POST', '/v1/refunds', input, idempotencyKey),
    downloadTicket: (digest) => request('POST', `/v1/artifacts/${pathPart(digest)}/download-ticket`),
  };
};
