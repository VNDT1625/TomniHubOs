import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_SESSION_NATIVE_CHANNELS, HUB_MODEL_SELECTION_NATIVE_CHANNELS } from '@/common/types/platform/electron';
import { registerAccountAuthBridge } from '@process/services/security/accountSession/accountAuthBridge';
import { registerAccountModelSelectionBridge } from '@process/services/security/accountSession/accountModelSelectionBridge';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const createHarness = () => {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  };
};

describe('account authentication IPC bridge', () => {
  it('exposes only secret-free status and fails closed before OIDC composition', async () => {
    const harness = createHarness();
    const restore = vi.fn(async () => ({ phase: 'unauthenticated' as const }));
    const signOut = vi.fn(async () => undefined);
    const dispose = registerAccountAuthBridge({
      ipcMain: harness.ipcMain as never,
      accountSession: {
        restore,
        signOut,
        snapshot: () => ({ phase: 'unauthenticated' }),
        recordVerifiedSession: async () => ({ phase: 'authenticated' }),
        requireOnlineSession: () => {
          throw new Error('unreachable');
        },
      },
      verifySender: () => true,
      diagnosticsConsent: { get: () => false, set: () => undefined },
    });

    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.getStatus)?.({})).resolves.toEqual({
      phase: 'unauthenticated',
    });
    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.beginSignIn)?.({})).resolves.toEqual({
      started: false,
      code: 'ACCOUNT_SIGN_IN_NOT_CONFIGURED',
    });
    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.signOut)?.({})).resolves.toBeUndefined();
    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.getDiagnosticsConsent)?.({})).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_DIAGNOSTICS_CONSENT_ACCOUNT_REQUIRED',
    });
    expect(restore).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    dispose();
    expect(harness.handlers).toHaveLength(0);
  });

  it('rejects non-main-frame/untrusted renderers before any account operation', async () => {
    const harness = createHarness();
    const restore = vi.fn(async () => ({ phase: 'unauthenticated' as const }));
    registerAccountAuthBridge({
      ipcMain: harness.ipcMain as never,
      accountSession: {
        restore,
        signOut: async () => undefined,
        snapshot: () => ({ phase: 'unauthenticated' }),
        recordVerifiedSession: async () => ({ phase: 'authenticated' }),
        requireOnlineSession: () => {
          throw new Error('unreachable');
        },
      },
      verifySender: () => false,
      diagnosticsConsent: { get: () => false, set: () => undefined },
    });

    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.getStatus)?.({})).rejects.toThrow(
      'ACCOUNT_SESSION_SENDER_UNTRUSTED'
    );
    expect(restore).not.toHaveBeenCalled();
    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.getDiagnosticsConsent)?.({})).resolves.toEqual({
      ok: false,
      code: 'ACCOUNT_DIAGNOSTICS_CONSENT_SENDER_UNTRUSTED',
    });
  });

  it('allows configured sign-in only from the trusted renderer', async () => {
    const harness = createHarness();
    const beginSignIn = vi.fn(async () => ({ started: true }));
    registerAccountAuthBridge({
      ipcMain: harness.ipcMain as never,
      accountSession: {
        restore: async () => ({ phase: 'unauthenticated' }),
        signOut: async () => undefined,
        snapshot: () => ({ phase: 'unauthenticated' }),
        recordVerifiedSession: async () => ({ phase: 'authenticated' }),
        requireOnlineSession: () => {
          throw new Error('unreachable');
        },
      },
      verifySender: () => true,
      diagnosticsConsent: { get: () => false, set: () => undefined },
      beginSignIn,
    });

    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.beginSignIn)?.({})).resolves.toEqual({
      started: true,
    });
    expect(beginSignIn).toHaveBeenCalledOnce();
  });

  it('allows an online account to read or revoke only its explicit diagnostics choice', async () => {
    const harness = createHarness();
    const get = vi.fn(() => false);
    const set = vi.fn();
    const requireOnlineSession = vi.fn(() => ({ accountId: 'verified-account' }) as never);
    registerAccountAuthBridge({
      ipcMain: harness.ipcMain as never,
      accountSession: {
        restore: async () => ({ phase: 'authenticated' }),
        signOut: async () => undefined,
        snapshot: () => ({ phase: 'authenticated' }),
        recordVerifiedSession: async () => ({ phase: 'authenticated' }),
        requireOnlineSession,
      },
      verifySender: () => true,
      diagnosticsConsent: { get, set },
    });

    await expect(harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.getDiagnosticsConsent)?.({})).resolves.toEqual({
      ok: true,
      granted: false,
    });
    await expect(
      harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.setDiagnosticsConsent)?.({}, { granted: true })
    ).resolves.toEqual({ ok: true, granted: true });
    await expect(
      harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.setDiagnosticsConsent)?.({}, { granted: false })
    ).resolves.toEqual({ ok: true, granted: false });
    await expect(
      harness.handlers.get(ACCOUNT_SESSION_NATIVE_CHANNELS.setDiagnosticsConsent)?.(
        {},
        { granted: false, accountId: 'attacker' }
      )
    ).resolves.toEqual({ ok: false, code: 'ACCOUNT_DIAGNOSTICS_CONSENT_REQUEST_INVALID' });

    expect(requireOnlineSession).toHaveBeenCalledTimes(4);
    expect(get).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenNthCalledWith(1, true);
    expect(set).toHaveBeenNthCalledWith(2, false);
  });

  it('stores only an account-bound, Main-verified Hub target/model selection', async () => {
    const harness = createHarness();
    const load = vi.fn(async () => undefined);
    const save = vi.fn(async () => undefined);
    registerAccountModelSelectionBridge({
      ipcMain: harness.ipcMain as never,
      accountSession: {
        restore: async () => ({ phase: 'authenticated' }),
        signOut: async () => undefined,
        snapshot: () => ({ phase: 'authenticated' }),
        recordVerifiedSession: async () => ({ phase: 'authenticated' }),
        requireOnlineSession: () => ({ accountId: 'account-1' }) as never,
      },
      vault: { load, save, clear: async () => undefined },
      runtime: {
        listTargets: async () => [{ id: 'provider-openai', available: true }],
        listModels: async () => [{ key: 'gpt-5.6' }],
      },
      workspace: () => 'C:/user-data/hub-capability-derivation',
      verifySender: () => true,
      now: () => new Date('2026-08-20T12:00:00.000Z'),
    });

    await expect(harness.handlers.get(HUB_MODEL_SELECTION_NATIVE_CHANNELS.get)?.({})).resolves.toEqual({ ok: true });
    await expect(
      harness.handlers.get(HUB_MODEL_SELECTION_NATIVE_CHANNELS.set)?.(
        {},
        { targetId: 'provider-openai', modelKey: 'gpt-5.6' }
      )
    ).resolves.toEqual({
      ok: true,
      selection: { targetId: 'provider-openai', modelKey: 'gpt-5.6', updatedAt: '2026-08-20T12:00:00.000Z' },
    });
    expect(save).toHaveBeenCalledWith({
      schemaVersion: 1,
      accountId: 'account-1',
      targetId: 'provider-openai',
      modelKey: 'gpt-5.6',
      updatedAt: '2026-08-20T12:00:00.000Z',
    });
    await expect(
      harness.handlers.get(HUB_MODEL_SELECTION_NATIVE_CHANNELS.set)?.(
        {},
        { targetId: 'provider-openai', modelKey: 'unknown' }
      )
    ).resolves.toEqual({ ok: false, code: 'HUB_MODEL_SELECTION_UNAVAILABLE' });
    await expect(
      harness.handlers.get(HUB_MODEL_SELECTION_NATIVE_CHANNELS.set)?.(
        {},
        { accountId: 'attacker', targetId: 'provider-openai', modelKey: 'gpt-5.6' }
      )
    ).resolves.toEqual({ ok: false, code: 'HUB_MODEL_SELECTION_REQUEST_INVALID' });
    expect(load).toHaveBeenCalledWith('account-1');
  });

  it('does not expose a local account registration handler', () => {
    const harness = createHarness();
    registerAccountAuthBridge({
      ipcMain: harness.ipcMain as never,
      accountSession: {
        restore: async () => ({ phase: 'unauthenticated' }),
        signOut: async () => undefined,
        snapshot: () => ({ phase: 'unauthenticated' }),
        recordVerifiedSession: async () => ({ phase: 'authenticated' }),
        requireOnlineSession: () => {
          throw new Error('unreachable');
        },
      },
      verifySender: () => true,
      diagnosticsConsent: { get: () => false, set: () => undefined },
    });

    expect(ACCOUNT_SESSION_NATIVE_CHANNELS).not.toHaveProperty('register');
    expect([...harness.handlers.keys()]).not.toContain('account-session.register');
  });
});
