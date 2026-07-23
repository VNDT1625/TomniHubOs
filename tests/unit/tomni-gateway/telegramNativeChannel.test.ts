import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { TelegramChannelService } from '@process/services/telegram/service';

const TOKEN = '123456:secret-token';
let directory: string | undefined;

const telegramResponse = (result: unknown): Response =>
  new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('native Telegram channel', () => {
  it('tests getMe, encrypts the token capability, polls pairing, and authorizes a user', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-telegram-'));
    const secrets = new Map<string, string>();
    const vault: SecretVault = {
      put: vi.fn(async (_input, payload) => {
        secrets.set('secret://telegram', payload.token);
        return {
          handle: 'secret://telegram',
          label: 'Telegram',
          kind: 'token',
          fields: ['token'],
          binding: { surfaces: ['telegram'], purposes: ['telegram-bot'], targets: ['telegram'] },
          createdAt: 1,
          updatedAt: 1,
        };
      }),
      list: vi.fn(async () => []),
      resolve: vi.fn(async () => ({ token: secrets.get('secret://telegram') ?? '' })),
      remove: vi.fn(async () => true),
    };
    let updateCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/getMe')) return telegramResponse({ id: 7, username: 'tomni_bot' });
      if (value.endsWith('/sendMessage')) return telegramResponse({ message_id: 2 });
      if (value.endsWith('/getUpdates')) {
        updateCalls += 1;
        if (updateCalls === 1) {
          return telegramResponse([
            {
              update_id: 10,
              message: { chat: { id: 99 }, from: { id: 42, first_name: 'Ada' }, text: '/start' },
            },
          ]);
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      throw new Error(`Unexpected Telegram request: ${value}`);
    });
    const pairingRequested = vi.fn();
    const userAuthorized = vi.fn();
    const service = new TelegramChannelService({
      statePath: path.join(directory, 'telegram.json'),
      vault,
      conversations: {
        list: vi.fn(async () => ({ items: [], total: 0, has_more: false })),
      } as never,
      events: { pairingRequested, userAuthorized, statusChanged: vi.fn() },
      fetchImpl: fetchImpl as typeof fetch,
      readSettings: vi.fn(async () => ({})),
    });

    await expect(service.test(TOKEN)).resolves.toEqual({ success: true, bot_username: 'tomni_bot' });
    await service.enable(TOKEN);
    await vi.waitFor(() => expect(pairingRequested).toHaveBeenCalledOnce());
    const pairings = await service.pendingPairings();
    expect(pairings[0]).toMatchObject({ platformUserId: '42', display_name: 'Ada' });
    expect(await readFile(path.join(directory, 'telegram.json'), 'utf8')).not.toContain(TOKEN);

    await service.approve(pairings[0].code);
    expect(userAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ platformUserId: '42', platformType: 'telegram' })
    );
    expect(await service.authorizedUsers()).toHaveLength(1);
    await service.disable();
  });

  it('fails closed when Telegram rejects the token', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-telegram-'));
    const service = new TelegramChannelService({
      statePath: path.join(directory, 'telegram.json'),
      vault: {} as SecretVault,
      conversations: {} as never,
      events: { pairingRequested: vi.fn(), userAuthorized: vi.fn(), statusChanged: vi.fn() },
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 })
      ),
      readSettings: vi.fn(async () => ({})),
    });
    await expect(service.test('bad')).resolves.toEqual({ success: false, error: 'Unauthorized' });
    await expect(service.status()).resolves.toMatchObject({ enabled: false, hasToken: false });
  });
});
