import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderOAuthTokenSet } from '@process/services/security/providerExecution/providerOAuthClient';
import { createProviderOAuthVault } from '@process/services/security/providerExecution/providerOAuthVault';

const tokenSet = (providerId: string): ProviderOAuthTokenSet => ({
  providerId,
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  expiresAt: Date.now() + 60_000,
  scope: 'models.read',
});

const codec = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
};

describe('provider OAuth vault', () => {
  it('persists tokens encrypted and scopes reads to the active account', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-provider-oauth-'));
    try {
      const first = createProviderOAuthVault({
        filePath: path.join(root, 'oauth.json'),
        actorId: () => 'account-a',
        codec,
      });
      await first.save(tokenSet('provider-a'));
      await expect(first.load('provider-a')).resolves.toMatchObject({ accessToken: 'access-secret' });

      const other = createProviderOAuthVault({
        filePath: path.join(root, 'oauth.json'),
        actorId: () => 'account-b',
        codec,
      });
      await expect(other.load('provider-a')).resolves.toBeUndefined();
      const raw = await import('node:fs/promises').then(({ readFile }) =>
        readFile(path.join(root, 'oauth.json'), 'utf8')
      );
      expect(raw).not.toContain('access-secret');
      expect(raw).not.toContain('refresh-secret');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent saves and removes only the active account record', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-provider-oauth-'));
    try {
      const filePath = path.join(root, 'oauth.json');
      const vault = createProviderOAuthVault({ filePath, actorId: () => 'account-a', codec });
      await Promise.all([vault.save(tokenSet('provider-a')), vault.save(tokenSet('provider-b'))]);
      await expect(vault.load('provider-a')).resolves.toBeDefined();
      await expect(vault.load('provider-b')).resolves.toBeDefined();
      await vault.remove('provider-a');
      await expect(vault.load('provider-a')).resolves.toBeUndefined();
      await expect(vault.load('provider-b')).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
