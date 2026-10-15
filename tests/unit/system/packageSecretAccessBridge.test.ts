import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  createScopedSecretVault,
  createSecretVault,
  createSessionSecretVault,
  type SecretVaultCodec,
  type SecretVaultRepository,
  type StoredSecret,
} from '@process/agentRuntime/secretVault';
import {
  createPackageSecretAccess,
  type PackageSecretGrant,
} from '@process/resources/packageSecrets/packageSecretAccess';
import { registerPackageSecretAccessBridge } from '@process/resources/packageSecrets/packageSecretAccessBridge';
import { bindingForDestinations } from '@process/resources/sessionSecrets/destinations';
import { registerScopedSecretsBridge } from '@process/resources/sessionSecrets/sessionSecretsBridge';
import {
  PACKAGE_SECRETS_ACCESS_CHANNEL,
  PACKAGE_SECRETS_CHANNELS,
  type SecretSetInput,
} from '@/common/types/platform/sessionSecrets';

type Handler = Parameters<IpcMain['handle']>[1];

const codec: SecretVaultCodec = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^enc:/u, ''), 'base64').toString('utf8'),
};

const setup = () => {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  };
  const event = { sender: { id: 7 } } as unknown as IpcMainInvokeEvent;
  let records: StoredSecret[] = [];
  const repository: SecretVaultRepository = {
    list: async () => structuredClone(records),
    save: async (values) => {
      records = structuredClone(values);
    },
  };
  const store = createScopedSecretVault(createSecretVault(repository, codec), createSessionSecretVault());
  let grants: PackageSecretGrant[] = [];
  let ids = 0;
  const access = createPackageSecretAccess({
    vault: store,
    repository: {
      list: async () => structuredClone(grants),
      save: async (values) => {
        grants = structuredClone(values);
      },
    },
    createId: () => `req-${(ids += 1)}`,
  });
  const verifySender = vi.fn(() => true);
  const installed = new Set(['com.a', 'com.b']);
  const keychain = vi.fn(() => true);
  const confirm = vi.fn(async (_event: IpcMainInvokeEvent, _operation: 'remove' | 'reveal') => true);
  const confirmGrant = vi.fn(async (_event: IpcMainInvokeEvent, _detail: { packageId: string; label: string }) => true);
  const audit = vi.fn(async (_record: { subjectId: string; operation: string; status: string }) => undefined);
  const resolvePackage = async (id: string) =>
    installed.has(id)
      ? { scope: { kind: 'package' as const, packageId: id }, caller: { packageId: id }, requestKey: id }
      : undefined;
  registerScopedSecretsBridge({
    ipcMain,
    channels: PACKAGE_SECRETS_CHANNELS,
    idKey: 'packageId',
    includeAppSets: false,
    requiresKeychain: true,
    verifySender,
    resolve: resolvePackage,
    store,
    keychainAvailable: keychain,
    confirm,
    audit,
  });
  registerPackageSecretAccessBridge({
    ipcMain,
    verifySender,
    packageInstalled: async (id) => installed.has(id),
    access,
    confirmGrant,
    audit,
  });
  const call = async (channel: string, payload: unknown) => handlers.get(channel)!(event, payload);
  return { store, access, installed, grants: () => grants, verifySender, keychain, confirm, confirmGrant, audit, call };
};

const set = (overrides: Partial<SecretSetInput> = {}): SecretSetInput => ({
  label: 'Deploy token',
  destinations: ['process'],
  variables: [{ name: 'TOKEN', value: 'package-secret-value' }],
  ...overrides,
});

describe("a Package App's own secret sets over IPC", () => {
  it("saves into the package scope and lists only that package's sets", async () => {
    const { call, store } = setup();
    await store.put(
      { label: 'Person key', kind: 'token', fields: ['TOKEN'], binding: bindingForDestinations(['process']) },
      { TOKEN: 'app-secret-value' }
    );

    const saved = await call(PACKAGE_SECRETS_CHANNELS.save, { packageId: 'com.a', set: set() });
    expect(saved).toMatchObject({ ok: true, data: { scope: 'package', label: 'Deploy token' } });
    await call(PACKAGE_SECRETS_CHANNELS.save, { packageId: 'com.b', set: set({ label: 'Other package' }) });

    const listed = (await call(PACKAGE_SECRETS_CHANNELS.list, { packageId: 'com.a' })) as {
      ok: true;
      data: { sets: Array<{ label: string }> };
    };
    expect(listed.data.sets.map((item) => item.label)).toEqual(['Deploy token']);
    expect(JSON.stringify(listed)).not.toMatch(/package-secret-value|app-secret-value/u);
  });

  it('refuses an unknown package, and a permanent save without the OS keychain', async () => {
    const { call, keychain } = setup();
    expect(await call(PACKAGE_SECRETS_CHANNELS.list, { packageId: 'com.gone' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    keychain.mockReturnValue(false);
    expect(await call(PACKAGE_SECRETS_CHANNELS.save, { packageId: 'com.a', set: set() })).toEqual({
      ok: false,
      error: 'KEYCHAIN_UNAVAILABLE',
    });
  });

  it("will not remove or reveal another package's set", async () => {
    const { call } = setup();
    const saved = (await call(PACKAGE_SECRETS_CHANNELS.save, { packageId: 'com.b', set: set() })) as {
      data: { handle: string };
    };
    expect(await call(PACKAGE_SECRETS_CHANNELS.remove, { packageId: 'com.a', handle: saved.data.handle })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(
      await call(PACKAGE_SECRETS_CHANNELS.reveal, { packageId: 'com.a', handle: saved.data.handle, field: 'TOKEN' })
    ).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});

describe("the person's control over a package's access to general app secrets", () => {
  const general = async (store: ReturnType<typeof setup>['store']) =>
    store.put(
      { label: 'GitHub token', kind: 'token', fields: ['TOKEN'], binding: bindingForDestinations(['process']) },
      { TOKEN: 'ghp-general-secret' }
    );

  it("turns a package's request into a grant only after a native approval", async () => {
    const { call, store, access, confirmGrant, audit } = setup();
    const github = await general(store);
    await access.requestAccess('com.a', { handle: github.handle, reason: 'Push the release' });

    const overview = (await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'overview', packageId: 'com.a' })) as {
      ok: true;
      data: { pending: Array<{ id: string; label: string; reason: string }> };
    };
    expect(overview.data.pending).toEqual([
      expect.objectContaining({ id: 'req-1', label: 'GitHub token', reason: 'Push the release' }),
    ]);
    expect(JSON.stringify(overview)).not.toContain('ghp-general-secret');

    confirmGrant.mockResolvedValueOnce(false);
    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'approve', packageId: 'com.a', requestId: 'req-1' })
    ).toEqual({
      ok: false,
      error: 'CANCELLED',
    });
    await expect(
      access.resolve('com.a', {
        handle: github.handle,
        fields: ['TOKEN'],
        surface: 'secret-firewall',
        purpose: 'opaque-use',
      })
    ).rejects.toThrow();

    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'approve', packageId: 'com.a', requestId: 'req-1' })
    ).toEqual({
      ok: true,
      data: true,
    });
    expect(confirmGrant).toHaveBeenLastCalledWith(expect.anything(), { packageId: 'com.a', label: 'GitHub token' });
    await expect(
      access.resolve('com.a', {
        handle: github.handle,
        fields: ['TOKEN'],
        surface: 'secret-firewall',
        purpose: 'opaque-use',
      })
    ).resolves.toEqual({ TOKEN: 'ghp-general-secret' });
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/GitHub|ghp-general|Push the release/u);
  });

  it('grants nothing when the package is uninstalled while the dialog is open', async () => {
    const { call, store, access, confirmGrant, installed, grants, audit } = setup();
    const github = await general(store);
    await access.requestAccess('com.a', { handle: github.handle, reason: 'Sync' });

    confirmGrant.mockImplementationOnce(async () => {
      installed.delete('com.a');
      return true;
    });
    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'approve', packageId: 'com.a', requestId: 'req-1' })
    ).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(grants()).toHaveLength(0);
    expect(audit).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'access-approve', status: 'completed' })
    );
  });

  it('records a receipt as failed when the request no longer exists', async () => {
    const { call, audit } = setup();
    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'deny', packageId: 'com.a', requestId: 'nope' })
    ).toEqual({
      ok: true,
      data: false,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'access-deny', status: 'failed' }));
  });

  it('lets the person grant directly, deny a request, and revoke a grant', async () => {
    const { call, store, access, grants } = setup();
    const github = await general(store);
    await access.requestAccess('com.b', { handle: github.handle, reason: 'Sync' });

    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'deny', packageId: 'com.b', requestId: 'req-1' })
    ).toEqual({
      ok: true,
      data: true,
    });
    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'grant', packageId: 'com.a', handle: github.handle })
    ).toEqual({
      ok: true,
      data: true,
    });
    expect(grants()).toHaveLength(1);
    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'revoke', packageId: 'com.a', handle: github.handle })
    ).toEqual({
      ok: true,
      data: true,
    });
    expect(grants()).toHaveLength(0);
  });

  it('rejects malformed input, strangers, uninstalled packages and sets that are not grantable', async () => {
    const { call, store, verifySender, confirmGrant } = setup();
    const company = await store.put(
      {
        label: 'Company only',
        kind: 'token',
        fields: ['TOKEN'],
        binding: bindingForDestinations(['process']),
        scope: { kind: 'company', companyId: 'acme' },
      },
      { TOKEN: 'company-secret' }
    );

    expect(await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'overview', packageId: 'com.a', extra: 1 })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'steal', packageId: 'com.a' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'overview', packageId: '../x' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'overview', packageId: 'com.gone' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(
      await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'grant', packageId: 'com.a', handle: company.handle })
    ).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(confirmGrant).not.toHaveBeenCalled();

    verifySender.mockReturnValue(false);
    expect(await call(PACKAGE_SECRETS_ACCESS_CHANNEL, { action: 'overview', packageId: 'com.a' })).toEqual({
      ok: false,
      error: 'DENIED',
    });
  });
});
