import { describe, expect, it, vi } from 'vitest';
import { registerExtensionStripBridge } from '@process/integrations/connections/ipc/extensionStripBridge';
import type { ExtensionStripActions } from '@process/integrations/connections/ipc/extensionStripActions';
import { EXTENSION_STRIP_CHANNELS } from '@/common/integrations/extensions/stripContract';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;

const actions = (): ExtensionStripActions => ({
  setPinned: vi.fn(async () => ({ ok: true as const })),
  setSiteAccess: vi.fn(async () => ({ ok: true as const })),
  allowSite: vi.fn(async () => ({ ok: true as const })),
  uninstall: vi.fn(async () => ({ ok: true as const })),
});

const setup = (
  options: {
    allowed?: boolean;
    records?: () => Promise<unknown>;
    actions?: ExtensionStripActions;
  } = {}
) => {
  const handlers = new Map<string, Handler>();
  const removed: string[] = [];
  const activeOrigin = vi.fn((_tabId?: string) => 'https://news.test');
  const stripActions = options.actions ?? actions();
  const ipcMain = {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => removed.push(channel),
  };
  const dispose = registerExtensionStripBridge({
    ipcMain: ipcMain as never,
    verifySender: () => options.allowed ?? true,
    records: (options.records ??
      (async () => [{ extensionId: ID_A, packageId: 'pkg', connectionId: 'c', name: 'Alpha' }])) as never,
    userState: async () =>
      ({
        isPinned: () => false,
        configOf: () => ({ mode: 'all-sites', sites: [], sessionSites: [] }),
      }) as never,
    activeOrigin,
    actions: stripActions,
  });
  const call = (channel: string, raw: unknown): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler({}, raw);
  };
  return { call, dispose, removed, activeOrigin, stripActions };
};

describe('registerExtensionStripBridge', () => {
  it('lists the loaded extensions for an empty request, with the active tab read by Main', async () => {
    const { call, activeOrigin } = setup();
    const result = await call(EXTENSION_STRIP_CHANNELS.list, {});
    expect(result).toMatchObject({
      ok: true,
      data: [{ id: ID_A, packageId: 'pkg', connectionId: 'c', name: 'Alpha', needsAccess: false, pinned: false }],
    });
    expect(activeOrigin).toHaveBeenCalledWith(undefined);
  });

  it('ignores an origin the renderer sends: the request is refused and Main reads its own tab', async () => {
    const { call, activeOrigin } = setup();
    expect(await call(EXTENSION_STRIP_CHANNELS.list, { activeOrigin: 'https://bank.test' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(activeOrigin).not.toHaveBeenCalled();
  });

  it('accepts a tab id for the list as a lookup key only, and refuses any other field or a non-object', async () => {
    const { call, activeOrigin } = setup();
    expect((await call(EXTENSION_STRIP_CHANNELS.list, { tabId: '42' })) as { ok: boolean }).toMatchObject({ ok: true });
    expect(activeOrigin).toHaveBeenLastCalledWith('42');
    expect(await call(EXTENSION_STRIP_CHANNELS.list, { tabId: 'https://news.test' })).toMatchObject({ ok: true });
    expect(await call(EXTENSION_STRIP_CHANNELS.list, { path: '/etc' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.list, 'not an object')).toEqual({ ok: false, error: 'INVALID_REQUEST' });
  });

  it('denies every channel to a sender that is not the window', async () => {
    const { call } = setup({ allowed: false });
    expect(await call(EXTENSION_STRIP_CHANNELS.list, {})).toEqual({ ok: false, error: 'DENIED' });
    expect(await call(EXTENSION_STRIP_CHANNELS.setPinned, { id: ID_A, pinned: true })).toEqual({
      ok: false,
      error: 'DENIED',
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.uninstall, { packageId: 'pkg' })).toEqual({
      ok: false,
      error: 'DENIED',
    });
  });

  it('validates the ids and choices of each action before calling it', async () => {
    const { call, stripActions } = setup();
    expect(await call(EXTENSION_STRIP_CHANNELS.setPinned, { id: 'not-an-id', pinned: true })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.setPinned, { id: ID_A, pinned: 'yes' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.setSiteAccess, { id: ID_A, mode: 'everywhere' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.setSiteAccess, { id: ID_A, mode: 'on-site', origin: 'x' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.uninstall, { packageId: '../../etc' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(stripActions.setPinned).not.toHaveBeenCalled();
    expect(stripActions.setSiteAccess).not.toHaveBeenCalled();
    expect(stripActions.uninstall).not.toHaveBeenCalled();
  });

  it('passes a valid choice to the action and returns its result', async () => {
    const { call, stripActions } = setup();
    expect(await call(EXTENSION_STRIP_CHANNELS.setSiteAccess, { id: ID_A, mode: 'on-site' })).toEqual({ ok: true });
    expect(stripActions.setSiteAccess).toHaveBeenCalledWith(ID_A, 'on-site');
    expect(await call(EXTENSION_STRIP_CHANNELS.allowSite, { id: ID_A })).toEqual({ ok: true });
    expect(stripActions.allowSite).toHaveBeenCalledWith(ID_A);
  });

  it('reports a read failure as IO_ERROR without throwing', async () => {
    const { call } = setup({
      records: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await call(EXTENSION_STRIP_CHANNELS.list, {})).toEqual({ ok: false, error: 'IO_ERROR' });
  });

  it('removes every handler when disposed', () => {
    const { dispose, removed } = setup();
    dispose();
    expect(removed.toSorted()).toEqual(Object.values(EXTENSION_STRIP_CHANNELS).toSorted());
  });
});
