import { describe, expect, it, vi } from 'vitest';
import type { LoadedExtensionRecord } from '@process/integrations/browserExtensions/store';
import { createBrowserExtensionControl } from '@process/integrations/browserExtensions/wiring/agentControl';
import type { ConnectionView } from '@process/integrations/connections/core/registry';

const LOADED_ID = 'abcdefghijklmnopabcdefghijklmnop';

const extensionView = (packageId: string, overrides: { id?: string; enabled?: boolean; lastError?: string } = {}) =>
  ({
    connection: {
      kind: 'extension',
      id: overrides.id ?? 'ext-main',
      title: `${packageId} title`,
      format: 'chrome-mv3',
      root: 'source/extension',
      version: '2.0.0',
      permissions: ['storage', 'tabs'],
      hostPermissions: ['<all_urls>'],
      unsupported: [],
    },
    key: `extension:${overrides.id ?? 'ext-main'}`,
    state: {
      packageId,
      packageVersion: '1.0.0',
      connectionKey: `extension:${overrides.id ?? 'ext-main'}`,
      enabled: overrides.enabled ?? true,
      status: overrides.enabled === false ? 'off' : 'on',
      ...(overrides.lastError === undefined ? {} : { lastError: overrides.lastError }),
    },
  }) as unknown as ConnectionView;

const mcpView = (packageId: string) =>
  ({
    connection: { kind: 'mcp', id: 'server', title: 'A server' },
    key: 'mcp:server',
    state: { packageId, packageVersion: '1.0.0', connectionKey: 'mcp:server', enabled: true, status: 'on' },
  }) as unknown as ConnectionView;

const loadedRecord = (packageId: string, connectionId: string): LoadedExtensionRecord => ({
  packageId,
  connectionId,
  extensionId: LOADED_ID,
  name: 'Blocker',
  version: '2.0.0',
});

describe('browser extension agent control', () => {
  it('lists only extension connections, joined with what the extension host has loaded', async () => {
    const control = createBrowserExtensionControl({
      listPackageIds: async () => ['com.example.blocker', 'com.example.tools'],
      viewsOf: async (packageId) =>
        packageId === 'com.example.blocker' ? [extensionView(packageId), mcpView(packageId)] : [mcpView(packageId)],
      loaded: async () => [loadedRecord('com.example.blocker', 'ext-main')],
      requestPopup: vi.fn(async () => ({ ok: true as const })),
    });
    const list = await control.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      extensionId: LOADED_ID,
      packageId: 'com.example.blocker',
      connectionId: 'ext-main',
      name: 'com.example.blocker title',
      version: '2.0.0',
      enabled: true,
      loaded: true,
      pinned: null,
      permissions: ['storage', 'tabs'],
      hostPermissions: ['<all_urls>'],
      lastError: null,
    });
  });

  it('reports an enabled extension that is not loaded, with its last error and no id', async () => {
    const control = createBrowserExtensionControl({
      listPackageIds: async () => ['com.example.blocker'],
      viewsOf: async () => [extensionView('com.example.blocker', { lastError: 'load failed' })],
      loaded: async () => [],
      requestPopup: vi.fn(async () => ({ ok: true as const })),
    });
    const [item] = await control.list();
    expect(item).toMatchObject({ extensionId: null, loaded: false, enabled: true, lastError: 'load failed' });
  });

  it('leaves out a package whose state cannot be read, instead of guessing', async () => {
    const control = createBrowserExtensionControl({
      listPackageIds: async () => ['broken', 'com.example.blocker'],
      viewsOf: async (packageId) => {
        if (packageId === 'broken') throw new Error('not installed');
        return [extensionView(packageId, { enabled: false })];
      },
      loaded: async () => [],
      requestPopup: vi.fn(async () => ({ ok: true as const })),
    });
    const list = await control.list();
    expect(list.map((item) => item.packageId)).toEqual(['com.example.blocker']);
    expect(list[0]?.enabled).toBe(false);
  });

  it('forwards popup requests with the extension id and tab', async () => {
    const requestPopup = vi.fn(async () => ({ ok: false as const, reason: 'no toolbar' }));
    const control = createBrowserExtensionControl({
      listPackageIds: async () => [],
      viewsOf: async () => [],
      loaded: async () => [],
      requestPopup,
    });
    expect(await control.openPopup(LOADED_ID, 'tab-1')).toEqual({ ok: false, reason: 'no toolbar' });
    expect(requestPopup).toHaveBeenCalledWith(LOADED_ID, 'tab-1');
  });

  it('reports the pin the person set in Main, and null when no pin state is available', async () => {
    const views = async () => [extensionView('com.example.blocker')];
    const base = {
      listPackageIds: async () => ['com.example.blocker'],
      viewsOf: views,
      loaded: async () => [loadedRecord('com.example.blocker', 'ext-main')],
      requestPopup: vi.fn(async () => ({ ok: true as const })),
    };
    const pinned = await createBrowserExtensionControl({ ...base, isPinned: async (id) => id === LOADED_ID }).list();
    expect(pinned[0]?.pinned).toBe(true);
    const unpinned = await createBrowserExtensionControl({ ...base, isPinned: async () => false }).list();
    expect(unpinned[0]?.pinned).toBe(false);
    const unknown = await createBrowserExtensionControl(base).list();
    expect(unknown[0]?.pinned).toBeNull();
  });
});
