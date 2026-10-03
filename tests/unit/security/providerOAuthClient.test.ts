import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createProviderOAuthClient,
  type ProviderOAuthError,
  type ProviderOAuthTokenSet,
} from '@process/services/security/providerExecution/providerOAuthClient';

const descriptor = {
  providerId: 'provider-openai',
  authorizationEndpoint: 'https://provider.example/authorize',
  tokenEndpoint: 'https://provider.example/token',
  revokeEndpoint: 'https://provider.example/revoke',
  clientId: 'tomni-desktop',
  redirectUri: 'http://127.0.0.1:43129/oauth/callback',
  scopes: ['offline_access', 'model.read'],
} as const;

const createVault = (initial?: ProviderOAuthTokenSet) => {
  let current = initial;
  return {
    load: vi.fn(async () => current),
    save: vi.fn(async (tokens: ProviderOAuthTokenSet) => {
      current = tokens;
    }),
    remove: vi.fn(async () => {
      current = undefined;
    }),
  };
};

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const challengeFor = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

describe('provider OAuth client', () => {
  it('performs state-bound PKCE authorization and stores a validated token set', async () => {
    const vault = createVault();
    const opened: string[] = [];
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = {
      openExternal: vi.fn(async (url: string) => void opened.push(url)),
      waitForCallback: vi.fn(async ({ state }: { redirectUri: string; state: string }) => ({
        state,
        code: 'authorization-code',
      })),
      random: (bytes: number) => Buffer.alloc(bytes, 7),
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3_600, scope: 'model.read' });
      }),
    };
    const client = createProviderOAuthClient(descriptor, vault, transport);

    const tokens = await client.beginAuthorization();
    const authorization = new URL(opened[0]!);
    const verifier = Buffer.alloc(48, 7).toString('base64url');
    expect(authorization.searchParams.get('code_challenge')).toBe(challengeFor(verifier));
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(requests[0]?.init).toMatchObject({ redirect: 'error' });
    expect(tokens).toMatchObject({
      providerId: descriptor.providerId,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    expect(vault.save).toHaveBeenCalledWith(tokens);
  });

  it('serializes refresh and preserves a rotated refresh token when omitted by the provider', async () => {
    let now = 100_000;
    const vault = createVault({
      providerId: descriptor.providerId,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: now + 1,
      scope: 'model.read',
    });
    let calls = 0;
    const client = createProviderOAuthClient(descriptor, vault, {
      openExternal: async () => undefined,
      waitForCallback: async () => ({ code: 'unused', state: 'unused' }),
      now: () => now,
      fetch: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json({ access_token: 'new-access', expires_in: 3_600 });
      },
    });

    const [first, second] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(first).toBe('new-access');
    expect(second).toBe('new-access');
    expect(calls).toBe(1);
    expect(vault.save).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'old-refresh' }));
    now += 1;
  });

  it('removes credentials on invalid_grant and reports reauthorization', async () => {
    const vault = createVault({
      providerId: descriptor.providerId,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1,
      scope: 'model.read',
    });
    const client = createProviderOAuthClient(descriptor, vault, {
      openExternal: async () => undefined,
      waitForCallback: async () => ({ code: 'unused', state: 'unused' }),
      now: () => 100,
      fetch: async () => json({ error: 'invalid_grant' }, 400),
    });

    await expect(client.getAccessToken()).rejects.toMatchObject<Partial<ProviderOAuthError>>({
      code: 'PROVIDER_OAUTH_REAUTH_REQUIRED',
    });
    expect(vault.remove).toHaveBeenCalledWith(descriptor.providerId);
    await expect(client.status()).resolves.toBe('missing');
  });

  it('disconnects locally even when remote revocation is unavailable', async () => {
    const vault = createVault({
      providerId: descriptor.providerId,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 999_999,
      scope: 'model.read',
    });
    const fetch = vi.fn(async () => json({}, 503));
    const client = createProviderOAuthClient(descriptor, vault, {
      openExternal: async () => undefined,
      waitForCallback: async () => ({ code: 'unused', state: 'unused' }),
      fetch,
    });

    await expect(client.disconnect()).resolves.toEqual({ remoteRevoked: false });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vault.remove).toHaveBeenCalledWith(descriptor.providerId);
    await expect(client.status()).resolves.toBe('missing');
  });
});
