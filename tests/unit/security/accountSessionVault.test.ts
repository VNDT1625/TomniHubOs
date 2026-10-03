import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccountSessionVault } from '@process/services/security/accountSession/accountSessionVault';
import { createAccountSessionService } from '@process/services/security/accountSession/accountSessionService';
import { parseDesktopOidcConfiguration } from '@process/services/security/accountSession/oidcConfiguration';
import {
  toAccountSessionSnapshot,
  type AuthenticatedAccountSession,
} from '@process/services/security/accountSession/types';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const session = (): AuthenticatedAccountSession => ({
  schemaVersion: 1,
  accountId: 'account-1',
  subjectId: 'subject-1',
  issuer: 'https://accounts.tomni.example/',
  clientId: 'tomni-desktop',
  displayName: 'Ava',
  accessToken: 'access-token-secret',
  refreshToken: 'refresh-token-secret',
  idToken: 'id-token-secret',
  expiresAt: '2026-08-20T10:00:00.000Z',
  verifiedAt: '2026-08-20T09:00:00.000Z',
});

const codec = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8').toString('base64'),
  decrypt: (value: string) => {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (!decoded.startsWith('encrypted:')) throw new Error('invalid ciphertext');
    return decoded.slice('encrypted:'.length);
  },
};

const temporaryVaultPath = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-account-session-'));
  roots.push(root);
  return path.join(root, 'account-session.v1.json');
};

const validConfiguration = () => ({
  issuer: 'https://accounts.tomni.example/',
  clientId: 'tomni-desktop',
  scopes: ['openid', 'profile', 'offline_access'],
  redirectUri: 'http://127.0.0.1:43129/oauth/callback',
  onlineValidationMaxAgeMs: 300_000,
  offlineLocalGraceMs: 86_400_000,
});

describe('account session vault', () => {
  it('persists only encrypted session material and returns a secret-free snapshot', async () => {
    const filePath = await temporaryVaultPath();
    const vault = createAccountSessionVault({ filePath, codec });
    await vault.save(session());

    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).not.toContain('access-token-secret');
    expect(persisted).not.toContain('refresh-token-secret');
    expect(await vault.load()).toEqual(session());
    expect(toAccountSessionSnapshot(await vault.load())).toEqual({
      phase: 'authenticated',
      accountId: 'account-1',
      displayName: 'Ava',
      expiresAt: '2026-08-20T10:00:00.000Z',
      verifiedAt: '2026-08-20T09:00:00.000Z',
    });
  });

  it('fails closed for missing protected storage and corrupt ciphertext', async () => {
    const unavailable = createAccountSessionVault({
      filePath: await temporaryVaultPath(),
      codec: { ...codec, isAvailable: () => false },
    });
    await expect(unavailable.load()).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_PROTECTED_STORAGE_UNAVAILABLE' });

    const filePath = await temporaryVaultPath();
    const vault = createAccountSessionVault({ filePath, codec });
    await vault.save(session());
    const tampered = createAccountSessionVault({
      filePath,
      codec: { ...codec, decrypt: () => '{"unknown":true}' },
    });
    await expect(tampered.load()).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_STORAGE_CORRUPT' });
  });

  it('clears an encrypted durable session', async () => {
    const filePath = await temporaryVaultPath();
    const vault = createAccountSessionVault({ filePath, codec });
    await vault.save(session());
    await vault.clear();
    await expect(vault.load()).resolves.toBeUndefined();
  });
});

describe('desktop OIDC configuration', () => {
  it('accepts only Main-defined HTTPS issuer and loopback callback', () => {
    expect(parseDesktopOidcConfiguration(validConfiguration())).toEqual({
      ...validConfiguration(),
      scopes: ['offline_access', 'openid', 'profile'],
    });
  });

  it('rejects an arbitrary redirect, a non-HTTPS issuer, and missing openid scope', () => {
    expect(() =>
      parseDesktopOidcConfiguration({ ...validConfiguration(), redirectUri: 'tomny://oauth/callback' })
    ).toThrow('loopback callback');
    expect(() =>
      parseDesktopOidcConfiguration({ ...validConfiguration(), issuer: 'http://accounts.tomni.example/' })
    ).toThrow('HTTPS');
    expect(() => parseDesktopOidcConfiguration({ ...validConfiguration(), scopes: ['profile'] })).toThrow('scopes');
  });
});

describe('account session service', () => {
  it('requires online validation and permits only an unexpired explicitly saved local grace session', async () => {
    const vault = createAccountSessionVault({ filePath: await temporaryVaultPath(), codec });
    const clock = new Date('2026-08-20T09:00:00.000Z');
    const service = createAccountSessionService({
      vault,
      now: () => clock,
      validateOnline: async () => {
        throw new Error('network unavailable');
      },
    });
    await vault.save({ ...session(), offlineLocalOnlyUntil: '2026-08-20T10:00:00.000Z' });

    await expect(service.restore()).resolves.toMatchObject({ phase: 'authenticated', offlineLocalOnly: true });
    expect(() => service.requireOnlineSession()).toThrow('Online account validation');
  });

  it('clears a revoked session and accepts a newly verified Main-owned session', async () => {
    const vault = createAccountSessionVault({ filePath: await temporaryVaultPath(), codec });
    const clock = new Date('2026-08-20T09:00:00.000Z');
    await vault.save(session());
    const revoked = createAccountSessionService({
      vault,
      now: () => clock,
      validateOnline: async () => ({ status: 'revoked' }),
    });
    await expect(revoked.restore()).resolves.toEqual({ phase: 'unauthenticated' });
    await expect(vault.load()).resolves.toBeUndefined();

    const valid = createAccountSessionService({
      vault,
      now: () => clock,
      validateOnline: async () => ({ status: 'valid' }),
    });
    await expect(valid.recordVerifiedSession(session())).resolves.toMatchObject({
      phase: 'authenticated',
      offlineLocalOnly: false,
    });
    expect(valid.requireOnlineSession().accountId).toBe('account-1');
  });

  it('rejects an expired token immediately and requires revalidation once the configured online-validation age elapses', async () => {
    const vault = createAccountSessionVault({ filePath: await temporaryVaultPath(), codec });
    let clock = new Date('2026-08-20T09:00:00.000Z');
    const service = createAccountSessionService({
      vault,
      now: () => clock,
      onlineValidationMaxAgeMs: 300_000,
      validateOnline: async () => ({ status: 'valid' }),
    });
    await service.recordVerifiedSession(session());
    expect(service.requireOnlineSession().subjectId).toBe('subject-1');

    clock = new Date('2026-08-20T09:05:01.000Z');
    expect(() => service.requireOnlineSession()).toThrow('Online account validation has expired');

    let expirationClock = new Date('2026-08-20T09:58:00.000Z');
    const expired = createAccountSessionService({
      vault,
      now: () => expirationClock,
      validateOnline: async () => ({ status: 'valid' }),
    });
    await expired.recordVerifiedSession({ ...session(), expiresAt: '2026-08-20T10:00:00.000Z' });
    expirationClock = new Date('2026-08-20T10:00:01.000Z');
    expect(() => expired.requireOnlineSession()).toThrow('account session has expired');
  });
});
