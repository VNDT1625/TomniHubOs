import { describe, expect, it } from 'vitest';
import { hashRequest, resolveIdempotency } from '../src/idempotency.js';

describe('store API idempotency', () => {
  it('replays the same request and rejects a changed request', () => {
    const request = { orderId: 'o-1', amountMinor: 100 };
    const record = { scope: 'checkout', key: 'k-1', requestHash: hashRequest(request), responseJson: '{"ok":true}' };
    expect(resolveIdempotency(record, 'checkout', 'k-1', request)).toEqual({
      kind: 'replay',
      responseJson: '{"ok":true}',
    });
    expect(resolveIdempotency(record, 'checkout', 'k-1', { ...request, amountMinor: 101 })).toEqual({
      kind: 'conflict',
    });
  });
});
