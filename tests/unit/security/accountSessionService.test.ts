import { describe, expect, it, vi } from 'vitest';

import { createAccountSessionService } from '@process/services/security/accountSession/accountSessionService';

import type { AccountSessionVault } from '@process/services/security/accountSession/accountSessionVault';
import type { AuthenticatedAccountSession } from '@process/services/security/accountSession/types';

const session = (expiresAt = '2026-08-20T10:00:00.000Z'): AuthenticatedAccountSession => ({
  schemaVersion: 1,
  accountId: 'account-1',
  subjectId: 'subject-1',
  issuer: 'https://accounts.tomni.example/',
  clientId: 'tomni-desktop',
  accessToken: 'access-token-secret',
  idToken: 'id-token-secret',
  expiresAt,
  verifiedAt: '2026-08-20T09:00:00.000Z',
});

const vault = (): AccountSessionVault => {
  let saved: AuthenticatedAccountSession | undefined;
  return {
    load: async () => saved,
    save: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = undefined;
    },
  };
};

describe('account session execution state', () => {
  it('notifies when a restored session becomes online-valid and when it signs out', async () => {
    const persistedVault = vault();
    await persistedVault.save(session());
    const service = createAccountSessionService({
      vault: persistedVault,
      now: () => new Date('2026-08-20T09:00:00.000Z'),
      validateOnline: async () => ({ status: 'valid' }),
    });
    const reasons: string[] = [];
    service.subscribe?.((change) => reasons.push(change.reason));

    await service.restore();
    await service.signOut();

    expect(reasons).toEqual(['restored', 'signed_out']);
  });

  it('clears legacy synthetic sessions before online validation', async () => {
    const persistedVault = vault();
    await persistedVault.save({
      ...session(),
      accountId: 'sovereign-local-account-42',
      subjectId: 'sovereign-local-account-42',
      issuer: 'tomny://local-account',
      clientId: 'tomny-desktop-local',
    });
    const validateOnline = vi.fn(async () => ({ status: 'valid' as const }));
    const service = createAccountSessionService({
      vault: persistedVault,
      now: () => new Date('2026-08-20T09:00:00.000Z'),
      validateOnline,
    });

    await expect(service.restore()).resolves.toEqual({ phase: 'unauthenticated' });
    await expect(persistedVault.load()).resolves.toBeUndefined();
    expect(validateOnline).not.toHaveBeenCalled();
  });

  it('emits a secret-free deadline and invalidates it once online validation is stale', async () => {
    let time = new Date('2026-08-20T09:00:00.000Z');
    const service = createAccountSessionService({
      vault: vault(),
      now: () => time,
      onlineValidationMaxAgeMs: 60_000,
      validateOnline: async () => ({ status: 'valid' }),
    });
    const changes: unknown[] = [];
    service.subscribe?.((change) => changes.push(change));

    await service.recordVerifiedSession(session());
    expect(service.onlineExecutionDeadline?.()).toBe('2026-08-20T09:01:00.000Z');
    expect(changes).toEqual([
      expect.objectContaining({
        reason: 'recorded',
        onlineExecutionDeadline: '2026-08-20T09:01:00.000Z',
      }),
    ]);

    time = new Date('2026-08-20T09:01:00.000Z');
    expect(() => service.requireOnlineSession()).toThrow('Online account validation has expired');
    expect(service.onlineExecutionDeadline?.()).toBeUndefined();
    expect(changes).toEqual([
      expect.anything(),
      expect.objectContaining({
        reason: 'invalidated',
        snapshot: expect.objectContaining({ phase: 'authenticated' }),
      }),
    ]);
  });
});
