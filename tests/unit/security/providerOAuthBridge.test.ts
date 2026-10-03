import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProviderOAuthBridge } from '@process/services/security/providerExecution/providerOAuthBridge';

type Handler = (value: unknown) => Promise<unknown>;
const registered = new Map<string, Handler>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: Handler | undefined) => {
        if (handler) registered.set(channel, handler);
        else registered.delete(channel);
      },
    }),
  },
}));

describe('provider OAuth bridge', () => {
  beforeEach(() => registered.clear());

  it('requires an online account and validates provider metadata before starting OAuth', async () => {
    const requireOnlineSession = vi.fn(() => {
      throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    });
    const beginAuthorization = vi.fn();
    registerProviderOAuthBridge({
      accountSession: { requireOnlineSession } as never,
      providerStore: { get: vi.fn() },
      clients: new Map([['openai-oauth', { beginAuthorization } as never]]),
    });

    const handler = registered.get('tomny-provider-oauth.begin');
    await expect(handler?.({ providerId: 'openai-oauth' })).resolves.toEqual({
      ok: false,
      error: 'ACCOUNT_SESSION_ONLINE_REQUIRED',
    });
    expect(beginAuthorization).not.toHaveBeenCalled();
  });

  it('keeps token values out of status and disconnect responses', async () => {
    const client = {
      beginAuthorization: vi.fn(async () => ({
        providerId: 'openai-oauth',
        accessToken: 'secret',
        expiresAt: 123,
        scope: 'openid',
      })),
      status: vi.fn(async () => 'active'),
      disconnect: vi.fn(async () => ({ remoteRevoked: true })),
    };
    const accountSession = { requireOnlineSession: vi.fn(() => ({ accountId: 'account-1' })) };
    const providerStore = { get: vi.fn(async () => ({ id: 'openai-oauth', auth_type: 'oauth' })) };
    registerProviderOAuthBridge({
      accountSession: accountSession as never,
      providerStore,
      clients: new Map([['openai-oauth', client as never]]),
    });

    await expect(registered.get('tomny-provider-oauth.begin')?.({ providerId: 'openai-oauth' })).resolves.toEqual({
      ok: true,
      data: { providerId: 'openai-oauth', status: 'active' },
    });
    await expect(registered.get('tomny-provider-oauth.status')?.({ providerId: 'openai-oauth' })).resolves.toEqual({
      ok: true,
      data: { providerId: 'openai-oauth', status: 'active' },
    });
    await expect(registered.get('tomny-provider-oauth.disconnect')?.({ providerId: 'openai-oauth' })).resolves.toEqual({
      ok: true,
      data: { providerId: 'openai-oauth', remoteRevoked: true },
    });
    expect(JSON.stringify([...registered])).not.toContain('secret');
  });

  it('rejects unknown providers and malformed requests without invoking a client', async () => {
    const client = { beginAuthorization: vi.fn() };
    registerProviderOAuthBridge({
      accountSession: { requireOnlineSession: vi.fn() } as never,
      providerStore: { get: vi.fn(async () => undefined) },
      clients: new Map([['openai-oauth', client as never]]),
    });

    await expect(registered.get('tomny-provider-oauth.begin')?.({ providerId: 'bad value' })).resolves.toEqual({
      ok: false,
      error: 'PROVIDER_OAUTH_REQUEST_INVALID',
    });
    await expect(registered.get('tomny-provider-oauth.begin')?.({ providerId: 'openai-oauth' })).resolves.toEqual({
      ok: false,
      error: 'PROVIDER_OAUTH_UNAVAILABLE',
    });
    expect(client.beginAuthorization).not.toHaveBeenCalled();
  });
});
