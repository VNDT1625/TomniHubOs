import { describe, expect, it } from 'vitest';
import { MemoryAccountStorage, MockAccountClient } from '../src/core';

describe('mock account client', () => {
  it('registers, verifies, and signs in a new account', async () => {
    const client = new MockAccountClient(new MemoryAccountStorage());
    const registered = await client.register({
      email: 'owner@example.com',
      displayName: 'Owner',
      password: 'Tomny@2026',
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    const verified = await client.verifyEmail(registered.value.verificationCode);
    expect(verified.ok).toBe(true);

    const signedIn = await client.login({
      email: 'owner@example.com',
      password: 'Tomny@2026',
      remember: true,
    });
    expect(signedIn.ok).toBe(true);
    expect(client.snapshot().authStatus).toBe('signedIn');
  });

  it('locks sign-in after repeated invalid credentials', async () => {
    const client = new MockAccountClient(new MemoryAccountStorage());
    await client.loadDemoAccount();

    let finalCode = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await client.login({
        email: 'thuan@tomni.local',
        password: 'wrong-password',
        remember: false,
      });
      if (!result.ok) finalCode = result.code;
    }

    expect(finalCode).toBe('ACCOUNT_LOCKED');
  });

  it('does not allow source-code sync even when requested', async () => {
    const client = new MockAccountClient(new MemoryAccountStorage());
    await client.loadDemoAccount();
    await client.updateSync({
      enabled: true,
      settings: true,
      automations: true,
      accountProfile: true,
      workspaceMetadata: true,
      conversations: true,
      sourceCode: true,
    });

    expect(client.snapshot().sync.sourceCode).toBe(false);
  });

  it('revoking the current device signs the account out', async () => {
    const client = new MockAccountClient(new MemoryAccountStorage());
    await client.loadDemoAccount();
    const current = client.snapshot().sessions.find((session) => session.current);
    expect(current).toBeDefined();
    if (!current) return;

    await client.revokeDevice(current.deviceId);
    expect(client.snapshot().authStatus).toBe('signedOut');
  });

  it('rejects account deletion without the exact confirmation phrase', async () => {
    const client = new MockAccountClient(new MemoryAccountStorage());
    await client.loadDemoAccount();

    const result = await client.deleteAccount('delete');
    expect(result.ok).toBe(false);
  });
});
