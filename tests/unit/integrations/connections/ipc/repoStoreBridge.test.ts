import { describe, expect, it, vi } from 'vitest';
import { REPO_STORE_CHANNELS } from '@/common/types/platform/repoStore';
import { registerRepoStoreBridge } from '@process/integrations/connections/ipc/repoStoreBridge';

const setup = () => {
  const handlers = new Map<string, (event: unknown, data: unknown) => Promise<unknown>>();
  const sender = { send: vi.fn() };
  const event = { sender };
  const pick = vi.fn().mockResolvedValue('C:/test-folder');
  const build = vi.fn(
    async (
      source: string,
      workspace: string | undefined,
      publish: (value: { text: string; progress: number; completed: boolean }) => void
    ) => {
      publish({ text: 'Inspecting source', progress: 45, completed: false });
      return { ok: true, artifactPath: 'MAIN_GENERATED_ARTIFACT', text: 'Signed safely' };
    }
  );
  const install = vi.fn().mockResolvedValue({ packageId: 'user.local.demo', version: '1.0.0' });
  const selectExtensionFile = vi.fn().mockResolvedValue('C:/downloads/ext.zip');
  const installExtensionFile = vi.fn().mockResolvedValue({ packageId: 'user.ext', version: '1.0.0' });
  const installChromeWebStore = vi.fn().mockResolvedValue({ packageId: 'user.cws', version: '2.0.0' });
  const chromeWebStoreEnabled = vi.fn(() => true);
  const checkUpdate = vi
    .fn()
    .mockResolvedValue({ status: 'update-available', installedCommit: 'a'.repeat(40), remoteCommit: 'b'.repeat(40) });
  const dispose = registerRepoStoreBridge({
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, data: unknown) => Promise<unknown>) => {
        handlers.set(channel, fn);
      },
      removeHandler: (channel: string) => {
        handlers.delete(channel);
      },
    } as never,
    verifySender: (candidate) => candidate === event,
    selectFolder: pick,
    build,
    install,
    checkUpdate,
    selectExtensionFile,
    installExtensionFile,
    installChromeWebStore,
    chromeWebStoreEnabled,
  });
  const invoke = (request: unknown, from = event): Promise<unknown> =>
    handlers.get(REPO_STORE_CHANNELS.import)!(from, request);
  const invokeCheck = (request: unknown, from = event): Promise<unknown> =>
    handlers.get(REPO_STORE_CHANNELS.checkUpdate)!(from, request);
  return {
    event,
    sender,
    pick,
    build,
    install,
    checkUpdate,
    selectExtensionFile,
    installExtensionFile,
    installChromeWebStore,
    chromeWebStoreEnabled,
    invoke,
    invokeCheck,
    handlers,
    dispose,
  };
};
const requestId = '991711e3-bdd8-4af9-a454-18239e3ea001';

describe('native RepoStore import bridge T2.7', () => {
  it('rejects a forged sender, arbitrary local paths and remote URLs outside the allowed host', async () => {
    const setupState = setup();
    expect(await setupState.invoke({ requestId, kind: 'folder', url: 'C:/private' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await setupState.invoke({ requestId, kind: 'github', url: 'https://evil.example.com/a/b' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(
      await setupState.invoke(
        { requestId, kind: 'github', url: 'https://github.com/a/b' },
        { sender: setupState.sender }
      )
    ).toEqual({ ok: false, error: 'DENIED' });
    expect(setupState.build).not.toHaveBeenCalled();
    setupState.dispose();
  });
  it('builds only a validated HTTPS GitHub URL and installs only Main-produced artifact', async () => {
    const state = setup();
    expect(await state.invoke({ requestId, kind: 'github', url: 'https://github.com/acme/demo' })).toEqual({
      ok: true,
      packageId: 'user.local.demo',
      version: '1.0.0',
      report: 'Signed safely',
    });
    expect(state.build).toHaveBeenCalledWith('https://github.com/acme/demo', undefined, expect.any(Function));
    expect(state.install).toHaveBeenCalledWith('MAIN_GENERATED_ARTIFACT');
    expect(state.sender.send).toHaveBeenCalledWith(
      REPO_STORE_CHANNELS.progress,
      expect.objectContaining({ requestId, phase: 'building', progress: 45 })
    );
    expect(state.sender.send).toHaveBeenCalledWith(
      REPO_STORE_CHANNELS.progress,
      expect.objectContaining({ requestId, phase: 'finished', progress: 100 })
    );
    state.dispose();
  });
  it('cancels a native folder selection without packaging and does not accept paths from IPC', async () => {
    const state = setup();
    state.pick.mockResolvedValueOnce(undefined);
    expect(await state.invoke({ requestId, kind: 'folder' })).toEqual({ ok: false, error: 'CANCELLED' });
    expect(state.build).not.toHaveBeenCalled();
    expect(await state.invoke({ requestId, kind: 'folder' })).toMatchObject({ ok: true });
    expect(state.build).toHaveBeenCalledWith('.', 'C:/test-folder', expect.any(Function));
    state.dispose();
    expect(state.handlers.size).toBe(0);
  });
  it('serializes concurrent import requests', async () => {
    const state = setup();
    let finish!: (value: { ok: boolean; artifactPath: string; text: string }) => void;
    state.build.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = state.invoke({ requestId, kind: 'github', url: 'https://github.com/acme/demo' });
    await vi.waitFor(() => expect(state.build).toHaveBeenCalledTimes(1));
    expect(await state.invoke({ requestId, kind: 'github', url: 'https://github.com/acme/demo' })).toEqual({
      ok: false,
      error: 'BUSY',
    });
    finish({ ok: true, artifactPath: 'MAIN_GENERATED_ARTIFACT', text: 'Signed safely' });
    expect(await first).toMatchObject({ ok: true });
    state.dispose();
  });
});

describe('native RepoStore extension sources (S3)', () => {
  const CWS_ID = 'abcdefghijklmnopabcdefghijklmnop';
  const CWS_DETAIL = 'https://chromewebstore.google.com/detail/demo/' + CWS_ID;
  it('installs a picked .zip or .crx through Main and reports the packaging stages', async () => {
    const state = setup();
    expect(await state.invoke({ requestId, kind: 'extension-file' })).toEqual({
      ok: true,
      packageId: 'user.ext',
      version: '1.0.0',
      report: '',
    });
    expect(state.selectExtensionFile).toHaveBeenCalledTimes(1);
    expect(state.installExtensionFile).toHaveBeenCalledWith('C:/downloads/ext.zip', expect.any(Function));
    state.dispose();
  });
  it('returns CANCELLED when the file dialog is dismissed and never installs', async () => {
    const state = setup();
    state.selectExtensionFile.mockResolvedValueOnce(undefined);
    expect(await state.invoke({ requestId, kind: 'extension-file' })).toEqual({ ok: false, error: 'CANCELLED' });
    expect(state.installExtensionFile).not.toHaveBeenCalled();
    state.dispose();
  });
  it('refuses the Web Store while its switch is off, before any download', async () => {
    const state = setup();
    state.chromeWebStoreEnabled.mockReturnValueOnce(false);
    expect(await state.invoke({ requestId, kind: 'chrome-web-store', url: CWS_ID })).toEqual({
      ok: false,
      error: 'DISABLED',
    });
    expect(state.installChromeWebStore).not.toHaveBeenCalled();
    state.dispose();
  });
  it('accepts only a Web Store id or detail URL and passes the valid input to Main', async () => {
    const state = setup();
    expect(await state.invoke({ requestId, kind: 'chrome-web-store', url: 'https://example.com/x' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(
      await state.invoke({
        requestId,
        kind: 'chrome-web-store',
        url: CWS_DETAIL,
      })
    ).toMatchObject({ ok: true, packageId: 'user.cws' });
    expect(state.installChromeWebStore).toHaveBeenCalledWith(CWS_DETAIL, expect.any(Function));
    state.dispose();
  });
  it('keeps the schema strict: a URL on file sources and a missing URL on Web Store are refused', async () => {
    const state = setup();
    expect(await state.invoke({ requestId, kind: 'extension-file', url: 'C:/x.zip' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(await state.invoke({ requestId, kind: 'chrome-web-store' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(state.installExtensionFile).not.toHaveBeenCalled();
    state.dispose();
  });
});

describe('native RepoStore update check (S1, read-only)', () => {
  it('returns the status for a validated installed package id and never builds or installs', async () => {
    const state = setup();
    expect(await state.invokeCheck({ packageId: 'acme.demo' })).toEqual({
      ok: true,
      status: 'update-available',
      installedCommit: 'a'.repeat(40),
      remoteCommit: 'b'.repeat(40),
    });
    expect(state.checkUpdate).toHaveBeenCalledWith('acme.demo');
    expect(state.build).not.toHaveBeenCalled();
    expect(state.install).not.toHaveBeenCalled();
    state.dispose();
  });
  it('refuses forged senders, extra fields and malformed package ids before asking Main', async () => {
    const state = setup();
    expect(await state.invokeCheck({ packageId: 'acme.demo' }, { sender: state.sender })).toEqual({
      ok: false,
      error: 'DENIED',
    });
    expect(await state.invokeCheck({ packageId: '../../etc' })).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(await state.invokeCheck({ packageId: 'acme.demo', path: 'C:/x' })).toEqual({
      ok: false,
      error: 'INVALID_REQUEST',
    });
    expect(state.checkUpdate).not.toHaveBeenCalled();
    state.dispose();
  });
  it('maps only the stable codes to the renderer and reports anything else as FAILED', async () => {
    const state = setup();
    state.checkUpdate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'NOT_LOCAL_BUILT' }));
    expect(await state.invokeCheck({ packageId: 'acme.demo' })).toEqual({ ok: false, error: 'NOT_LOCAL_BUILT' });
    state.checkUpdate.mockRejectedValueOnce(new Error('C:/secret/path leaked in message'));
    expect(await state.invokeCheck({ packageId: 'acme.demo' })).toEqual({ ok: false, error: 'FAILED' });
    state.checkUpdate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'SOMETHING_ELSE' }));
    expect(await state.invokeCheck({ packageId: 'acme.demo' })).toEqual({ ok: false, error: 'FAILED' });
    state.dispose();
  });
});
