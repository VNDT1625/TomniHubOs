import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createSecretRequestStore } from '@process/agentRuntime/agentMesh/mcp/secret-context/requests';
import {
  createScopedSecretVault,
  createSecretVault,
  createSessionSecretVault,
  type SecretVaultCodec,
  type SecretVaultRepository,
  type StoredSecret,
} from '@process/agentRuntime/secretVault';
import { registerScopedSecretsBridge } from '@process/resources/sessionSecrets/sessionSecretsBridge';
import { bindingForDestinations } from '@process/resources/sessionSecrets/destinations';
import {
  COMPANY_SECRETS_CHANNELS,
  SESSION_SECRETS_CHANNELS,
  type SecretSetInput,
} from '@/common/types/platform/sessionSecrets';

type Handler = Parameters<IpcMain['handle']>[1];

const codec: SecretVaultCodec = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/u, ''), 'base64').toString('utf8'),
};
const memoryRepository = (): SecretVaultRepository & { records: StoredSecret[] } => {
  const repository = {
    records: [] as StoredSecret[],
    list: async () => structuredClone(repository.records),
    save: async (values: StoredSecret[]) => {
      repository.records = structuredClone(values);
    },
  };
  return repository;
};

const setup = (kind: 'session' | 'company' = 'session') => {
  const handlers = new Map<string, Handler>();
  const event = { sender: { id: 5 } } as unknown as IpcMainInvokeEvent;
  const repository = memoryRepository();
  const store = createScopedSecretVault(createSecretVault(repository, codec), createSessionSecretVault());
  const requests = createSecretRequestStore();
  const verifySender = vi.fn(() => true);
  const resolve = vi.fn(async (id: string) =>
    id === 'missing'
      ? undefined
      : kind === 'session'
        ? {
            scope: { kind: 'session' as const, sessionId: `core-${id}` },
            caller: { sessionId: `core-${id}` },
            requestKey: `core-${id}`,
          }
        : { scope: { kind: 'company' as const, companyId: id }, caller: { companyId: id }, requestKey: id }
  );
  const keychainAvailable = vi.fn(() => true);
  const confirm = vi.fn(async (_event: IpcMainInvokeEvent, _operation: 'remove' | 'reveal') => true);
  const audit = vi.fn(async (_record: { operation: string; status: string }) => undefined);
  const dispose = registerScopedSecretsBridge({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    },
    channels: kind === 'session' ? SESSION_SECRETS_CHANNELS : COMPANY_SECRETS_CHANNELS,
    idKey: kind === 'session' ? 'sessionId' : 'companyId',
    includeAppSets: kind === 'session',
    requiresKeychain: kind === 'company',
    verifySender,
    resolve,
    store,
    requests: kind === 'session' ? requests : undefined,
    keychainAvailable,
    confirm,
    audit,
  });
  const key = kind === 'session' ? 'sessionId' : 'companyId';
  const call = (operation: keyof typeof SESSION_SECRETS_CHANNELS, payload: Record<string, unknown>, id = 'c1') => {
    const channels = kind === 'session' ? SESSION_SECRETS_CHANNELS : COMPANY_SECRETS_CHANNELS;
    const handler = handlers.get(channels[operation]);
    if (!handler) throw new Error('Missing IPC handler');
    return Promise.resolve(handler(event, { [key]: id, ...payload }));
  };
  return {
    call,
    handlers,
    store,
    repository,
    requests,
    verifySender,
    resolve,
    keychainAvailable,
    confirm,
    audit,
    dispose,
  };
};

const login: SecretSetInput = {
  label: 'GitHub login',
  note: 'Release job',
  destinations: ['terminal', 'process'],
  variables: [
    { name: 'USERNAME', value: 'octocat' },
    { name: 'PASSWORD', value: 'hunter2-secret' },
  ],
};
const savedHandle = async (fixture: ReturnType<typeof setup>, set: SecretSetInput = login, id = 'c1') =>
  ((await fixture.call('save', { set }, id)) as { ok: true; data: { handle: string } }).data.handle;
const appSet = (fixture: ReturnType<typeof setup>, label = 'App set') =>
  fixture.store.put(
    { label, kind: 'credential', fields: ['TOKEN'], binding: bindingForDestinations(['process']) },
    { TOKEN: 'app-token' }
  );

describe('scoped secrets bridge', () => {
  it('denies an untrusted sender on every channel before resolving anything', async () => {
    const fixture = setup();
    fixture.verifySender.mockReturnValue(false);
    for (const operation of Object.keys(SESSION_SECRETS_CHANNELS) as Array<keyof typeof SESSION_SECRETS_CHANNELS>) {
      expect(await fixture.call(operation, {})).toEqual({ ok: false, error: 'DENIED' });
    }
    expect(fixture.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['list', { extra: true }],
    ['save', { set: { ...login, destinations: [] } }],
    ['save', { set: { ...login, destinations: ['browser'] } }],
    ['save', { set: { ...login, destinations: ['browser'], hosts: ['https://example.com/login'] } }],
    ['save', { set: { ...login, destinations: ['email'] } }],
    ['save', { set: { ...login, variables: [] } }],
    [
      'save',
      {
        set: {
          ...login,
          variables: [
            { name: 'A', value: '1' },
            { name: 'A', value: '2' },
          ],
        },
      },
    ],
    ['save', { set: { ...login, variables: [{ name: '1bad', value: 'x' }] } }],
    ['save', { set: { ...login, variables: [{ name: 'OK', value: '' }] } }],
    ['save', { set: { ...login, variables: [{ name: 'OK', value: 'x'.repeat(8193) }] } }],
    ['save', { set: { ...login, label: '' } }],
    ['save', { set: { ...login, extra: 1 } }],
    ['save', {}],
    ['remove', {}],
    ['reveal', { handle: 'secret://x' }],
    ['dismissRequest', {}],
  ] as const)('rejects malformed %s payloads', async (operation, payload) => {
    const fixture = setup();
    expect(await fixture.call(operation, payload as Record<string, unknown>)).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(fixture.repository.records).toEqual([]);
  });

  it('reports an unknown conversation as NOT_FOUND', async () => {
    const fixture = setup();
    expect(await fixture.call('list', {}, 'missing')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  describe('saving', () => {
    it('keeps a temporary set in RAM, never on disk, and needs no keychain', async () => {
      const fixture = setup();
      fixture.keychainAvailable.mockReturnValue(false);
      const result = await fixture.call('save', { set: login });

      expect(result).toMatchObject({
        ok: true,
        data: {
          label: 'GitHub login',
          fields: ['USERNAME', 'PASSWORD'],
          scope: 'session',
          destinations: ['terminal', 'process'],
        },
      });
      expect(fixture.repository.records).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('hunter2-secret');
    });

    it('binds a web form to its exact hostnames', async () => {
      const fixture = setup();
      const result = await fixture.call('save', {
        set: { ...login, destinations: ['browser'], hosts: ['Admin.Example.com'] },
      });
      expect(result).toMatchObject({ ok: true, data: { destinations: ['browser'], hosts: ['admin.example.com'] } });
    });

    it('fails closed without a keychain for a permanent scope and stores nothing', async () => {
      const fixture = setup('company');
      fixture.keychainAvailable.mockReturnValue(false);
      expect(await fixture.call('save', { set: login }, 'acme')).toEqual({ ok: false, error: 'KEYCHAIN_UNAVAILABLE' });
      expect(fixture.repository.records).toEqual([]);
    });

    it('stores a company set permanently and encrypted', async () => {
      const fixture = setup('company');
      const result = await fixture.call('save', { set: login }, 'acme');
      expect(result).toMatchObject({ ok: true, data: { scope: 'company' } });
      expect(fixture.repository.records).toHaveLength(1);
      expect(fixture.repository.records[0]?.encryptedPayload).not.toContain('hunter2-secret');
    });

    it('replaces the values of a set of this scope only', async () => {
      const fixture = setup();
      const handle = await savedHandle(fixture);
      const replaced = await fixture.call('save', {
        set: {
          ...login,
          handle,
          variables: [
            { name: 'USERNAME', value: 'new' },
            { name: 'PASSWORD', value: 'newer' },
          ],
        },
      });
      expect(replaced).toMatchObject({ ok: true, data: { handle } });
      expect(await fixture.call('reveal', { handle, field: 'PASSWORD' })).toEqual({ ok: true, data: 'newer' });
    });

    it("refuses to replace another conversation's set or an app set", async () => {
      const fixture = setup();
      const other = await savedHandle(fixture, login, 'c2');
      const app = (await appSet(fixture)).handle;
      for (const handle of [other, app]) {
        expect(await fixture.call('save', { set: { ...login, handle } })).toEqual({ ok: false, error: 'NOT_FOUND' });
      }
    });

    it('dismisses the agent request that a saved set fulfils', async () => {
      const fixture = setup();
      const request = fixture.requests.add('core-c1', {
        label: 'Payments sandbox',
        note: 'Needed for checkout test',
        fields: ['PAYMENTS_API_KEY'],
        destinations: ['process'],
      });
      expect(((await fixture.call('list', {})) as { data: { requests: unknown[] } }).data.requests).toHaveLength(1);
      await fixture.call('save', {
        set: { ...login, requestId: request.id, variables: [{ name: 'PAYMENTS_API_KEY', value: 'sk-test' }] },
      });
      expect(((await fixture.call('list', {})) as { data: { requests: unknown[] } }).data.requests).toEqual([]);
    });
  });

  describe('listing', () => {
    it('shows this conversation, app sets read-only, and nothing else', async () => {
      const fixture = setup();
      await savedHandle(fixture, { ...login, label: 'Mine' }, 'c1');
      await savedHandle(fixture, { ...login, label: "Someone else's" }, 'c2');
      await appSet(fixture, 'Shared app set');
      await fixture.store.put(
        {
          label: 'Telegram bot',
          kind: 'token',
          fields: ['TOKEN'],
          binding: { surfaces: ['telegram'], purposes: ['telegram-bot'], targets: ['telegram'] },
        },
        { TOKEN: 'bot-token' }
      );
      await fixture.store.put(
        {
          label: 'Company only',
          kind: 'credential',
          fields: ['TOKEN'],
          binding: bindingForDestinations(['process']),
          scope: { kind: 'company', companyId: 'acme' },
        },
        { TOKEN: 'company-token' }
      );

      const listing = (await fixture.call('list', {})) as {
        ok: true;
        data: { sets: Array<{ label: string; scope: string }>; keychainAvailable: boolean };
      };
      expect(listing.data.sets.map((set) => [set.label, set.scope]).toSorted()).toEqual([
        ['Mine', 'session'],
        ['Shared app set', 'app'],
      ]);
      expect(listing.data.keychainAvailable).toBe(true);
      expect(JSON.stringify(listing)).not.toMatch(/hunter2|app-token|bot-token|company-token|encrypted/iu);
    });

    it('lists only this conversation requests', async () => {
      const fixture = setup();
      fixture.requests.add('core-c1', { label: 'Mine', note: 'n', fields: ['A'], destinations: ['terminal'] });
      fixture.requests.add('core-c2', { label: 'Other', note: 'n', fields: ['B'], destinations: ['terminal'] });
      const listing = (await fixture.call('list', {})) as { data: { requests: Array<{ label: string }> } };
      expect(listing.data.requests.map((request) => request.label)).toEqual(['Mine']);
    });

    it('keeps companies apart and shows no app sets or requests', async () => {
      const fixture = setup('company');
      await savedHandle(fixture, { ...login, label: 'Acme login' }, 'acme');
      await savedHandle(fixture, { ...login, label: 'Globex login' }, 'globex');
      await appSet(fixture);
      const listing = (await fixture.call('list', {}, 'acme')) as {
        data: { sets: Array<{ label: string }>; requests: unknown[] };
      };
      expect(listing.data.sets.map((set) => set.label)).toEqual(['Acme login']);
      expect(listing.data.requests).toEqual([]);
    });
  });

  describe('removing', () => {
    it('removes a set of this scope only after native approval', async () => {
      const fixture = setup();
      const handle = await savedHandle(fixture);
      fixture.confirm.mockResolvedValueOnce(false);
      expect(await fixture.call('remove', { handle })).toEqual({ ok: false, error: 'CANCELLED' });
      expect(await fixture.call('remove', { handle })).toEqual({ ok: true, data: true });
      expect(fixture.confirm).toHaveBeenLastCalledWith(expect.anything(), 'remove');
      expect(fixture.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'remove', status: 'completed' }));
      expect(((await fixture.call('list', {})) as { data: { sets: unknown[] } }).data.sets).toEqual([]);
    });

    it("never removes an app set or another conversation's set", async () => {
      const fixture = setup();
      const other = await savedHandle(fixture, login, 'c2');
      const app = (await appSet(fixture)).handle;
      for (const handle of [other, app]) {
        expect(await fixture.call('remove', { handle })).toEqual({ ok: false, error: 'NOT_FOUND' });
      }
      expect(fixture.confirm).not.toHaveBeenCalled();
    });
  });

  describe('revealing', () => {
    it('needs native approval, returns the value once and records a content-free receipt', async () => {
      const fixture = setup();
      const handle = await savedHandle(fixture);
      expect(await fixture.call('reveal', { handle, field: 'PASSWORD' })).toEqual({ ok: true, data: 'hunter2-secret' });
      expect(fixture.confirm).toHaveBeenLastCalledWith(expect.anything(), 'reveal');
      expect(fixture.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'reveal', status: 'completed' }));
      expect(JSON.stringify(fixture.audit.mock.calls)).not.toMatch(/hunter2|PASSWORD|GitHub/iu);
    });

    it('does nothing when the person cancels, and refuses an unknown field or a foreign set', async () => {
      const fixture = setup();
      const handle = await savedHandle(fixture);
      const other = await savedHandle(fixture, login, 'c2');
      fixture.confirm.mockResolvedValueOnce(false);
      expect(await fixture.call('reveal', { handle, field: 'PASSWORD' })).toEqual({ ok: false, error: 'CANCELLED' });
      expect(await fixture.call('reveal', { handle, field: 'MISSING' })).toEqual({ ok: false, error: 'NOT_FOUND' });
      expect(await fixture.call('reveal', { handle: other, field: 'PASSWORD' })).toEqual({
        ok: false,
        error: 'NOT_FOUND',
      });
    });

    it('resolves the owner route only for the scope that owns the set', async () => {
      const fixture = setup();
      const handle = await savedHandle(fixture);
      await expect(
        fixture.store.resolve({
          handle,
          fields: ['PASSWORD'],
          surface: 'owner',
          purpose: 'reveal',
          caller: { sessionId: 'core-c1' },
        })
      ).resolves.toEqual({ PASSWORD: 'hunter2-secret' });
      await expect(
        fixture.store.resolve({
          handle,
          fields: ['PASSWORD'],
          surface: 'owner',
          purpose: 'reveal',
          caller: { sessionId: 'core-c2' },
        })
      ).rejects.toThrow(/scope/iu);
    });
  });

  it('dismisses an agent request', async () => {
    const fixture = setup();
    const request = fixture.requests.add('core-c1', {
      label: 'X',
      note: 'n',
      fields: ['A'],
      destinations: ['process'],
    });
    expect(await fixture.call('dismissRequest', { requestId: request.id })).toEqual({ ok: true, data: true });
    expect(await fixture.call('dismissRequest', { requestId: request.id })).toEqual({ ok: true, data: false });
  });

  it('collapses a vault failure into a generic error that carries no value', async () => {
    const fixture = setup();
    vi.spyOn(fixture.store, 'put').mockRejectedValueOnce(new Error('disk full while writing hunter2-secret'));
    const result = await fixture.call('save', { set: login });
    expect(result).toEqual({ ok: false, error: 'IO_ERROR' });
    expect(JSON.stringify(result)).not.toContain('hunter2-secret');
  });

  it('removes its handlers on dispose', () => {
    const fixture = setup();
    fixture.dispose();
    expect(fixture.handlers.size).toBe(0);
  });
});
