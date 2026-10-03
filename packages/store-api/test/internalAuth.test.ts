import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { internalAuthorized } from '../src/index.js';

const request = (token?: string): IncomingMessage =>
  ({ headers: token ? { 'x-store-internal-token': token } : {} }) as IncomingMessage;

describe('internal route authentication', () => {
  it('fails closed when server token is absent', () => {
    expect(internalAuthorized(request('value'), {})).toBe(false);
  });

  it('rejects absent or different credentials', () => {
    const env = { STORE_INTERNAL_TOKEN: 'expected-secret' };
    expect(internalAuthorized(request(), env)).toBe(false);
    expect(internalAuthorized(request('wrong-secret'), env)).toBe(false);
  });

  it('accepts the exact service credential', () => {
    expect(internalAuthorized(request('expected-secret'), { STORE_INTERNAL_TOKEN: 'expected-secret' })).toBe(true);
  });
});
