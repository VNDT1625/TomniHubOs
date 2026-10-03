import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAccountModelSelectionBridge } from '@/process/services/security/accountSession/accountModelSelectionBridge';
import { createAccountModelSelectionVault } from '@/process/services/security/accountSession/accountModelSelectionVault';

const roots: string[] = [];
const codec = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(`protected:${value}`, 'utf8').toString('base64'),
  decrypt: (value: string) => {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (!decoded.startsWith('protected:')) throw new Error('invalid');
    return decoded.slice('protected:'.length);
  },
};

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-selection-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('account model selection vault', () => {
  it('lists only Main-discovered available targets and models for an authenticated account', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
    const accountSession = {
      requireOnlineSession: vi.fn(() => ({ accountId: 'account-1' })),
    };
    registerAccountModelSelectionBridge({
      ipcMain: {
        handle: (channel, handler) => {
          handlers.set(channel, handler as (event: unknown, payload?: unknown) => Promise<unknown>);
        },
        removeHandler: vi.fn(),
      },
      accountSession: accountSession as never,
      vault: { load: vi.fn(), save: vi.fn(), clear: vi.fn() },
      runtime: {
        listTargets: vi.fn().mockResolvedValue([
          { id: 'cloud-model', available: true },
          { id: 'offline-model', available: false },
          { id: 'local-model', available: true },
        ]),
        listModels: vi.fn(async (targetId: string) => (targetId === 'cloud-model' ? [{ key: 'gpt-5.6' }] : [])),
      },
      workspace: () => 'C:/workspace',
      verifySender: () => true,
    });
    const handler = handlers.get('hub-model-selection.list');
    if (handler === undefined) throw new Error('Hub model catalog handler was not registered.');

    await expect(handler({})).resolves.toEqual({
      ok: true,
      targets: [{ targetId: 'cloud-model', modelKeys: ['gpt-5.6'] }],
    });
    expect(accountSession.requireOnlineSession).toHaveBeenCalledOnce();
  });

  it('encrypts an account-bound target/model choice and does not expose it to another account', async () => {
    const rootDir = await temporaryRoot();
    const vault = createAccountModelSelectionVault({ rootDir, codec });
    const selection = {
      schemaVersion: 1 as const,
      accountId: 'account-1',
      targetId: 'provider-openai',
      modelKey: 'gpt-5.6',
      updatedAt: '2026-08-20T12:00:00.000Z',
    };

    await vault.save(selection);

    const names = await (await import('node:fs/promises')).readdir(rootDir);
    const stored = await readFile(path.join(rootDir, names[0]!), 'utf8');
    expect(stored).not.toContain(selection.modelKey);
    await expect(vault.load(selection.accountId)).resolves.toEqual(selection);
    await expect(vault.load('account-2')).resolves.toBeUndefined();
  });

  it('fails closed for unavailable protected storage and invalid records, then clears the exact account selection', async () => {
    const rootDir = await temporaryRoot();
    const unavailable = createAccountModelSelectionVault({ rootDir, codec: { ...codec, isAvailable: () => false } });
    await expect(unavailable.load('account-1')).rejects.toMatchObject({
      code: 'ACCOUNT_SESSION_PROTECTED_STORAGE_UNAVAILABLE',
    });

    const vault = createAccountModelSelectionVault({ rootDir, codec });
    await expect(
      vault.save({ schemaVersion: 1, accountId: 'account-1', targetId: '', modelKey: 'gpt-5.6', updatedAt: 'bad-date' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_SESSION_INVALID' });
    await vault.save({
      schemaVersion: 1,
      accountId: 'account-1',
      targetId: 'target-1',
      modelKey: 'model-1',
      updatedAt: '2026-08-20T12:00:00.000Z',
    });
    await vault.clear('account-1');
    await expect(vault.load('account-1')).resolves.toBeUndefined();
  });
});
