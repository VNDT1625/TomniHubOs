import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPublisherAuthority } from '@process/services/security/accountSession/publisherAuthority';
import type { AccountSessionService } from '@process/services/security/accountSession/accountSessionService';
import { AccountSessionError, type AuthenticatedAccountSession } from '@process/services/security/accountSession/types';
import type { SystemEgressAuthority } from '@process/services/security/systemEgressAuthority';

const onlineSession = (): AuthenticatedAccountSession => ({
  schemaVersion: 1,
  accountId: 'account-1',
  subjectId: 'subject-1',
  issuer: 'https://accounts.tomni.example/',
  clientId: 'tomni-desktop',
  displayName: 'Ava',
  accessToken: 'access-token-main-only',
  idToken: 'id-token-main-only',
  expiresAt: '2026-08-20T10:00:00.000Z',
  verifiedAt: '2026-08-20T09:00:00.000Z',
});

const accountSession = (session: AuthenticatedAccountSession): AccountSessionService => ({
  restore: async () => ({
    phase: 'authenticated',
    accountId: session.accountId,
    displayName: session.displayName,
    expiresAt: session.expiresAt,
    verifiedAt: session.verifiedAt,
    offlineLocalOnly: false,
  }),
  recordVerifiedSession: async () => ({
    phase: 'authenticated',
    accountId: session.accountId,
    displayName: session.displayName,
    expiresAt: session.expiresAt,
    verifiedAt: session.verifiedAt,
    offlineLocalOnly: false,
  }),
  signOut: async () => undefined,
  snapshot: () => ({
    phase: 'authenticated',
    accountId: session.accountId,
    displayName: session.displayName,
    expiresAt: session.expiresAt,
    verifiedAt: session.verifiedAt,
    offlineLocalOnly: false,
  }),
  requireOnlineSession: () => session,
});

const signingKey = () => {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const spkiSha256 = `sha256-${createHash('sha256')
    .update(pair.publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex')}`;
  return { keyId: 'publisher-key-1', algorithm: 'Ed25519' as const, publicKeyPem, spkiSha256 };
};

const authorityResponse = (key: ReturnType<typeof signingKey>, overrides: Record<string, unknown> = {}) => ({
  subjectId: 'subject-1',
  publisherId: 'com.tomni.publisher',
  namespace: 'com.tomni.publisher',
  role: 'publisher',
  status: 'active',
  authorityRevision: 'authority-v1',
  activeSigningKey: key,
  ...overrides,
});

const responseAt = (body: unknown, url: string): Response => {
  const response = new Response(JSON.stringify(body));
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

describe('publisher authority', () => {
  it('resolves an active publisher identity and enrolled Ed25519 key only from the online Main session', async () => {
    const key = signingKey();
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer access-token-main-only',
        accept: 'application/json',
      });
      expect(init?.redirect).toBe('error');
      return responseAt(authorityResponse(key), 'https://accounts.tomni.example/desktop/publisher-authority');
    });
    const authority = createPublisherAuthority({
      endpoint: 'https://accounts.tomni.example/desktop/publisher-authority',
      accountSession: accountSession(onlineSession()),
      fetch: request,
      now: () => new Date('2026-08-20T09:00:00.000Z'),
    });

    await expect(authority.requirePublisherPrincipal()).resolves.toMatchObject({
      subjectId: 'subject-1',
      publisherId: 'com.tomni.publisher',
      activeSigningKey: { keyId: 'publisher-key-1', spkiSha256: key.spkiSha256 },
      verifiedAt: '2026-08-20T09:00:00.000Z',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not allow a bearer request to follow a redirect', async () => {
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe('error');
      throw new TypeError('redirect blocked for Bearer access-token-main-only');
    });
    const authority = createPublisherAuthority({
      endpoint: 'https://accounts.tomni.example/desktop/publisher-authority',
      accountSession: accountSession(onlineSession()),
      fetch: request,
    });

    await expect(authority.requirePublisherPrincipal()).rejects.toMatchObject({
      code: 'ACCOUNT_SESSION_INVALID',
      message: 'Publisher authority request failed.',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a response URL does not exactly match the configured authority endpoint', async () => {
    const key = signingKey();
    const authority = createPublisherAuthority({
      endpoint: 'https://accounts.tomni.example/desktop/publisher-authority',
      accountSession: accountSession(onlineSession()),
      fetch: async () => responseAt(authorityResponse(key), 'https://attacker.example/publisher-authority'),
    });

    await expect(authority.requirePublisherPrincipal()).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
  });

  it('fails closed for a mismatched account, inactive authority, or mismatched enrolled-key fingerprint', async () => {
    const key = signingKey();
    const session = accountSession(onlineSession());
    const authorityFor = (response: Record<string, unknown>) =>
      createPublisherAuthority({
        endpoint: 'https://accounts.tomni.example/desktop/publisher-authority',
        accountSession: session,
        fetch: async () => new Response(JSON.stringify(response)),
      });

    await expect(
      authorityFor(authorityResponse(key, { subjectId: 'other-subject' })).requirePublisherPrincipal()
    ).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
    await expect(
      authorityFor(authorityResponse(key, { status: 'suspended' })).requirePublisherPrincipal()
    ).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_UNAUTHENTICATED' });
    await expect(
      authorityFor(
        authorityResponse(key, { activeSigningKey: { ...key, spkiSha256: `sha256-${'0'.repeat(64)}` } })
      ).requirePublisherPrincipal()
    ).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
  });

  it('does not call the authority endpoint when Main has no online account session', async () => {
    const request = vi.fn<typeof fetch>();
    const authority = createPublisherAuthority({
      endpoint: 'https://accounts.tomni.example/desktop/publisher-authority',
      accountSession: {
        restore: async () => ({ phase: 'unauthenticated' }),
        recordVerifiedSession: async () => ({ phase: 'unauthenticated' }),
        signOut: async () => undefined,
        snapshot: () => ({ phase: 'unauthenticated' }),
        requireOnlineSession: () => {
          throw new AccountSessionError('ACCOUNT_SESSION_UNAUTHENTICATED', 'A verified account session is required.');
        },
      },
      fetch: request,
    });

    await expect(authority.requirePublisherPrincipal()).rejects.toMatchObject({
      code: 'ACCOUNT_SESSION_UNAUTHENTICATED',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed before fetch when the Main egress authority denies the configured publisher endpoint', async () => {
    const request = vi.fn<typeof fetch>();
    const denyEgress: SystemEgressAuthority = {
      authorize: vi.fn(() => ({
        decision: 'deny',
        code: 'SYSTEM_EGRESS_PUBLISHER_AUTHORITY_DESTINATION_DENIED',
      })),
    };
    const authority = createPublisherAuthority({
      endpoint: 'https://accounts.tomni.example/desktop/publisher-authority',
      accountSession: accountSession(onlineSession()),
      fetch: request,
      egressAuthority: denyEgress,
    });

    await expect(authority.requirePublisherPrincipal()).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
    expect(denyEgress.authorize).toHaveBeenCalledWith({
      egressClass: 'publisher-authority',
      destination: 'https://accounts.tomni.example/desktop/publisher-authority',
      publisherAuthorityOrigin: 'https://accounts.tomni.example',
    });
    expect(request).not.toHaveBeenCalled();
  });
});
