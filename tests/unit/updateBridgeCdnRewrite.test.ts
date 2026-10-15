/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  setAllowPrerelease: vi.fn(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
  },
  storage: {
    buildStorage: () => ({
      getSync: () => undefined,
      setSync: () => {},
      get: async () => undefined,
      set: async () => {},
    }),
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: {
      check: { provider: vi.fn() },
      download: { provider: vi.fn() },
      quitAndInstall: { provider: vi.fn() },
      status: { emit: vi.fn() },
    },
    update: { open: { on: vi.fn() } },
  },
}));

vi.mock('electron', () => ({ app: { getVersion: vi.fn(() => '1.0.0') } }));

vi.mock('@process/services/autoUpdaterService', () => ({
  autoUpdaterService: {
    checkForUpdates: mocks.checkForUpdates,
    downloadUpdate: mocks.downloadUpdate,
    quitAndInstall: mocks.quitAndInstall,
    setAllowPrerelease: mocks.setAllowPrerelease,
  },
}));

describe('signed native update bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers only native updater providers and exposes no manual download contract', async () => {
    vi.resetModules();
    const { ipcBridge } = await import('@/common');
    const { initUpdateBridge } = await import('@process/bridge/updateBridge');

    initUpdateBridge();

    expect(ipcBridge.autoUpdate.check.provider).toHaveBeenCalledTimes(1);
    expect(ipcBridge.autoUpdate.download.provider).toHaveBeenCalledTimes(1);
    expect(ipcBridge.autoUpdate.quitAndInstall.provider).toHaveBeenCalledTimes(1);
    expect((ipcBridge.update as unknown as Record<string, unknown>).check).toBeUndefined();
    expect((ipcBridge.update as unknown as Record<string, unknown>).download).toBeUndefined();
    expect((ipcBridge.update as unknown as Record<string, unknown>).downloadProgress).toBeUndefined();
  });

  it('uses electron-updater results without renderer-controlled repository or URL input', async () => {
    mocks.checkForUpdates.mockResolvedValue({
      success: true,
      updateInfo: { version: '1.1.0', releaseNotes: 'Signed release notes' },
    });
    vi.resetModules();
    const { ipcBridge } = await import('@/common');
    const { initUpdateBridge } = await import('@process/bridge/updateBridge');
    initUpdateBridge();
    const handler = vi.mocked(ipcBridge.autoUpdate.check.provider).mock.calls.at(-1)?.[0];
    if (!handler) throw new Error('native update handler not registered');

    await expect(handler({ includePrerelease: true })).resolves.toEqual({
      success: true,
      data: {
        currentVersion: '1.0.0',
        updateInfo: { version: '1.1.0', releaseNotes: 'Signed release notes', releaseDate: undefined },
      },
    });
    expect(mocks.setAllowPrerelease).toHaveBeenCalledWith(true);
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('propagates install failures to the renderer instead of hiding them', async () => {
    mocks.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('Update installer is not downloaded yet.');
    });
    vi.resetModules();
    const { ipcBridge } = await import('@/common');
    const { initUpdateBridge } = await import('@process/bridge/updateBridge');
    initUpdateBridge();
    const handler = vi.mocked(ipcBridge.autoUpdate.quitAndInstall.provider).mock.calls.at(-1)?.[0];
    if (!handler) throw new Error('installer handler not registered');

    await expect(handler()).rejects.toThrow('Update installer is not downloaded yet.');
  });
});
