import { describe, expect, it, vi } from 'vitest';
import { createSessionStoreApiClient } from '@/process/services/storeApiSessionClient';

describe('Main-owned Store API session binding', () => {
  it('reads the bearer token only from the current account session', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const requireOnlineSession = vi.fn(() => ({ accessToken: 'main-session-token' }));
    const client = createSessionStoreApiClient({ requireOnlineSession } as never, {
      baseUrl: 'http://127.0.0.1:8787',
      fetchImpl,
    });
    await client.catalog();
    expect(requireOnlineSession).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer main-session-token');
  });

  it('does not issue a request when Main session is unavailable', async () => {
    const fetchImpl = vi.fn();
    const client = createSessionStoreApiClient(
      {
        requireOnlineSession: () => {
          throw new Error('ACCOUNT_SESSION_REQUIRED');
        },
      } as never,
      { baseUrl: 'http://127.0.0.1:8787', fetchImpl }
    );
    await expect(client.entitlements()).rejects.toThrow('ACCOUNT_SESSION_REQUIRED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
