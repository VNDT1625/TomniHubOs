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
    const [{ initUpdateBridge }, { ipcBridge }] = await Promise.all([
      import('@process/bridge/updateBridge'),
      import('@/common'),
    ]);

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
    const [{ initUpdateBridge }, { ipcBridge }] = await Promise.all([
      import('@process/bridge/updateBridge'),
      import('@/common'),
    ]);
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
});
