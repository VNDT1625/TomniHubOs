import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createOidcOnlineSessionValidator,
  verifyOidcIdToken,
} from '@process/services/security/accountSession/browserOidcClient';
import {
  parseDesktopOidcConfiguration,
  readDesktopOidcConfigurationFromEnvironment,
} from '@process/services/security/accountSession/oidcConfiguration';
import type { AuthenticatedAccountSession } from '@process/services/security/accountSession/types';

const configuration = () =>
  parseDesktopOidcConfiguration({
    issuer: 'https://accounts.tomni.example/',
    clientId: 'tomni-desktop',
    scopes: ['openid', 'profile'],
    redirectUri: 'http://127.0.0.1:43129/oauth/callback',
    onlineValidationMaxAgeMs: 300_000,
    offlineLocalGraceMs: 86_400_000,
  });

const discovery = () =>
  new Response(
    JSON.stringify({
      issuer: 'https://accounts.tomni.example/',
      authorization_endpoint: 'https://accounts.tomni.example/authorize',
      token_endpoint: 'https://accounts.tomni.example/token',
      jwks_uri: 'https://accounts.tomni.example/jwks',
      userinfo_endpoint: 'https://accounts.tomni.example/userinfo',
    })
  );

const fetchRevoked: typeof fetch = async (input) =>
  String(input).includes('.well-known/') ? discovery() : new Response('', { status: 401 });

const fetchSubjectMismatch: typeof fetch = async (input) =>
  String(input).includes('.well-known/') ? discovery() : new Response(JSON.stringify({ sub: 'different-subject' }));

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const signedIdToken = (overrides: Record<string, unknown> = {}) => {
  const keyPair = generateKeyPairSync('rsa', { modulusLength: 2_048 });
  const header = encode({ alg: 'RS256', kid: 'account-key', typ: 'JWT' });
  const payload = encode({
    iss: 'https://accounts.tomni.example/',
    sub: 'subject-1',
    aud: 'tomni-desktop',
    exp: 1_900_000_000,
    nonce: 'nonce-1',
    ...overrides,
  });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keyPair.privateKey).toString('base64url');
  return {
    token: `${header}.${payload}.${signature}`,
    jwks: { keys: [{ ...keyPair.publicKey.export({ format: 'jwk' }), kid: 'account-key', use: 'sig' }] },
  };
};

const session = (): AuthenticatedAccountSession => ({
  schemaVersion: 1,
  accountId: 'subject-1',
  subjectId: 'subject-1',
  issuer: 'https://accounts.tomni.example/',
  clientId: 'tomni-desktop',
  accessToken: 'access-token',
  idToken: 'id-token',
  expiresAt: '2026-08-20T10:00:00.000Z',
  verifiedAt: '2026-08-20T09:00:00.000Z',
});

describe('desktop OIDC verification', () => {
  it('verifies a signed ID token only for the configured issuer, audience, nonce and expiry', () => {
    const fixture = signedIdToken();
    expect(
      verifyOidcIdToken(fixture.token, {
        issuer: 'https://accounts.tomni.example/',
        clientId: 'tomni-desktop',
        nonce: 'nonce-1',
        jwks: fixture.jwks,
        now: new Date('2026-08-20T09:00:00.000Z'),
      }).sub
    ).toBe('subject-1');
    expect(() =>
      verifyOidcIdToken(fixture.token, {
        issuer: 'https://accounts.tomni.example/',
        clientId: 'tomni-desktop',
        nonce: 'other-nonce',
        jwks: fixture.jwks,
        now: new Date('2026-08-20T09:00:00.000Z'),
      })
    ).toThrow('claims do not match');
  });

  it('fails closed when online user-info reports revocation or a different subject', async () => {
    await expect(
      createOidcOnlineSessionValidator(configuration(), fetchRevoked)(session(), new AbortController().signal)
    ).resolves.toEqual({
      status: 'revoked',
    });

    await expect(
      createOidcOnlineSessionValidator(configuration(), fetchSubjectMismatch)(session(), new AbortController().signal)
    ).rejects.toThrow('subject does not match');
  });

  it('rejects redirects for discovery and bearer user-info validation requests', async () => {
    const requests: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const oidcFetch: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return String(input).includes('.well-known/') ? discovery() : new Response(JSON.stringify({ sub: 'subject-1' }));
    };

    await expect(
      createOidcOnlineSessionValidator(configuration(), oidcFetch)(session(), new AbortController().signal)
    ).resolves.toEqual({ status: 'valid' });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://accounts.tomni.example/.well-known/openid-configuration',
      init: { redirect: 'error' },
    });
    expect(requests[1]).toMatchObject({
      url: 'https://accounts.tomni.example/userinfo',
      init: {
        redirect: 'error',
        headers: { authorization: 'Bearer access-token', accept: 'application/json' },
      },
    });
  });

  it('fails closed before an OIDC discovery document can redirect user-info egress off the configured issuer', async () => {
    const requests: string[] = [];
    const crossOriginDiscovery: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          issuer: 'https://accounts.tomni.example/',
          authorization_endpoint: 'https://accounts.tomni.example/authorize',
          token_endpoint: 'https://accounts.tomni.example/token',
          jwks_uri: 'https://accounts.tomni.example/jwks',
          userinfo_endpoint: 'https://not-accounts.tomni.example/userinfo',
        })
      );
    };

    await expect(
      createOidcOnlineSessionValidator(configuration(), crossOriginDiscovery)(session(), new AbortController().signal)
    ).rejects.toThrow('SYSTEM_EGRESS_OIDC_ORIGIN_DENIED');
    expect(requests).toEqual(['https://accounts.tomni.example/.well-known/openid-configuration']);
  });

  it('loads only complete deployment-owned OIDC environment configuration', () => {
    expect(readDesktopOidcConfigurationFromEnvironment({})).toBeUndefined();
    expect(() =>
      readDesktopOidcConfigurationFromEnvironment({ TOMNI_OIDC_ISSUER: 'https://accounts.tomni.example/' })
    ).toThrow('client ID');
  });
});
