import { describe, expect, it, vi } from 'vitest';
import { createExtensionStripActions } from '@process/integrations/connections/ipc/extensionStripActions';
import type { ExtensionUserState } from '@process/integrations/browserExtensions/state/userState';
import type { StripRecord } from '@/common/integrations/extensions/stripItems';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const record = (extensionId: string, packageId: string, extra: Partial<StripRecord> = {}): StripRecord => ({
  extensionId,
  packageId,
  connectionId: 'c',
  name: 'Ext',
  siteAccess: ['<all_urls>'],
  optionalSiteAccess: [],
  ...extra,
});

const fakeState = () => ({
  setPinned: vi.fn(async () => undefined),
  setMode: vi.fn(async () => undefined),
  allowOrigin: vi.fn(async () => 'saved' as const),
  forget: vi.fn(async () => undefined),
  isPinned: vi.fn(() => false),
  configOf: vi.fn(() => ({ mode: 'on-click' as const, sites: [], sessionSites: [] })),
  initialize: vi.fn(async () => undefined),
});

const setup = (
  options: {
    records?: StripRecord[];
    origin?: string;
    extensionPackage?: boolean;
    confirm?: boolean;
    uninstall?: () => Promise<void>;
  } = {}
) => {
  const state = fakeState();
  const applySiteAccess = vi.fn(async () => undefined);
  const uninstallPackage = vi.fn(options.uninstall ?? (async () => undefined));
  const actions = createExtensionStripActions({
    records: async () => options.records ?? [record(ID_A, 'pkg.one'), record(ID_B, 'pkg.two')],
    userState: async () => state as unknown as ExtensionUserState,
    activeOrigin: () => options.origin,
    applySiteAccess,
    isExtensionPackage: async () => options.extensionPackage ?? true,
    confirmUninstall: async () => options.confirm ?? true,
    uninstallPackage,
  });
  return { actions, state, applySiteAccess, uninstallPackage };
};

describe('extension strip actions', () => {
  it('reports a failed reload as IO_ERROR, and the choice stays saved', async () => {
    const state = fakeState();
    const actions = createExtensionStripActions({
      records: async () => [record(ID_A, 'pkg.one')],
      userState: async () => state as unknown as ExtensionUserState,
      activeOrigin: () => undefined,
      applySiteAccess: async () => {
        throw new Error('reload failed');
      },
      isExtensionPackage: async () => true,
      confirmUninstall: async () => true,
      uninstallPackage: async () => undefined,
    });
    expect(await actions.setSiteAccess(ID_A, 'all-sites')).toEqual({ ok: false, error: 'IO_ERROR' });
    expect(state.setMode).toHaveBeenCalledWith(ID_A, 'all-sites');
  });
  it('refuses an id that is not loaded, and changes nothing', async () => {
    const { actions, state, applySiteAccess } = setup({ records: [] });
    expect(await actions.setPinned(ID_A, true)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await actions.setSiteAccess(ID_A, 'on-site')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(state.setPinned).not.toHaveBeenCalled();
    expect(state.setMode).not.toHaveBeenCalled();
    expect(applySiteAccess).not.toHaveBeenCalled();
  });

  it('saves a pin and a site access choice, then applies the choice to the loaded extension', async () => {
    const { actions, state, applySiteAccess } = setup();
    expect(await actions.setPinned(ID_A, true)).toEqual({ ok: true });
    expect(state.setPinned).toHaveBeenCalledWith(ID_A, true);
    expect(await actions.setSiteAccess(ID_A, 'on-site')).toEqual({ ok: true });
    expect(state.setMode).toHaveBeenCalledWith(ID_A, 'on-site');
    expect(applySiteAccess).toHaveBeenCalledWith(ID_A, { mode: 'on-click', sites: [], sessionSites: [] });
  });

  it('allows the active site only when the manifest covers it, and takes the origin from Main alone', async () => {
    const narrow = [record(ID_A, 'pkg.one', { siteAccess: ['https://news.test/*'] })];
    // The active tab is on a site the manifest does not cover: refused, nothing saved.
    const outside = setup({ records: narrow, origin: 'https://bank.test' });
    expect(await outside.actions.allowSite(ID_A)).toEqual({ ok: false, error: 'NOT_ALLOWED' });
    expect(outside.state.allowOrigin).not.toHaveBeenCalled();

    const covered = setup({ records: narrow, origin: 'https://news.test' });
    expect(await covered.actions.allowSite(ID_A)).toEqual({ ok: true });
    expect(covered.state.allowOrigin).toHaveBeenCalledWith(ID_A, 'https://news.test', ['https://news.test/*']);

    const noTab = setup({ records: narrow, origin: undefined });
    expect(await noTab.actions.allowSite(ID_A)).toEqual({ ok: false, error: 'NO_ACTIVE_SITE' });
  });

  it('removes a package only after a confirmation, only when it holds an extension, and forgets its extensions', async () => {
    const notExtension = setup({ extensionPackage: false });
    expect(await notExtension.actions.uninstall('pkg.one')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(notExtension.uninstallPackage).not.toHaveBeenCalled();

    const cancelled = setup({ confirm: false });
    expect(await cancelled.actions.uninstall('pkg.one')).toEqual({ ok: false, error: 'CANCELLED' });
    expect(cancelled.uninstallPackage).not.toHaveBeenCalled();

    const done = setup({ records: [record(ID_A, 'pkg.one'), record(ID_B, 'pkg.two')] });
    expect(await done.actions.uninstall('pkg.one')).toEqual({ ok: true });
    expect(done.uninstallPackage).toHaveBeenCalledWith('pkg.one');
    expect(done.state.forget).toHaveBeenCalledTimes(1);
    expect(done.state.forget).toHaveBeenCalledWith(ID_A);
  });

  it('reports a failed removal as IO_ERROR and keeps the saved choices', async () => {
    const failing = setup({
      uninstall: async () => {
        throw new Error('locked');
      },
    });
    expect(await failing.actions.uninstall('pkg.one')).toEqual({ ok: false, error: 'IO_ERROR' });
    expect(failing.state.forget).not.toHaveBeenCalled();
  });
});
