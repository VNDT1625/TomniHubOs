import { describe, expect, it } from 'vitest';
import { statusForStoreError } from '../src/index.js';

describe('Store API error mapping', () => {
  it.each([
    ['AUTH_REQUIRED', 401],
    ['REVIEW_SELF_APPROVAL_DENIED', 403],
    ['ORDER_NOT_FOUND', 404],
    ['IDEMPOTENCY_KEY_CONFLICT', 409],
    ['PAYLOAD_TOO_LARGE', 413],
    ['PADDLE_NOT_CONFIGURED', 503],
    ['AUTH_JWKS_UNAVAILABLE', 503],
    ['PAYMENT_AMOUNT_INVALID', 400],
    ['PADDLE_PROVIDER_TIMEOUT', 503],
    ['PADDLE_PROVIDER_REQUEST_FAILED', 503],
  ] as const)('maps %s to %s', (code, status) => {
    expect(statusForStoreError(code)).toBe(status);
  });
});
