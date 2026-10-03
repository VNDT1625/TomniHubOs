/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFeedUrl = process.env.TOMNY_UPDATE_FEED_URL;

const importService = async (feedUrl: string | undefined, isPackaged = true) => {
  vi.resetModules();
  if (feedUrl === undefined) delete process.env.TOMNY_UPDATE_FEED_URL;
  else process.env.TOMNY_UPDATE_FEED_URL = feedUrl;

  const autoUpdater = {
    logger: null,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    channel: undefined as string | undefined,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  };
  const log = {
    transports: { file: { level: 'info' } },
    info: vi.fn(),
    error: vi.fn(),
  };

  vi.doMock('electron-updater', () => ({ autoUpdater }));
  vi.doMock('electron-log', () => ({ default: log }));
  vi.doMock('electron', () => ({
    app: {
      isPackaged,
      getVersion: vi.fn(() => '1.0.0'),
      getPath: vi.fn(() => '/tmp/tomny-test'),
    },
  }));

  await import('@process/services/autoUpdaterService');
  return { autoUpdater, log };
};

describe('autoUpdaterService update feed override', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    if (originalFeedUrl === undefined) delete process.env.TOMNY_UPDATE_FEED_URL;
    else process.env.TOMNY_UPDATE_FEED_URL = originalFeedUrl;
  });

  it('accepts the pinned HTTPS vendor feed in a packaged build', async () => {
    const { autoUpdater } = await importService('https://github.com/VNDT1625/OmniAgent/releases/download/latest');

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://github.com/VNDT1625/OmniAgent/releases/download/latest/',
    });
  });

  it.each([
    'http://github.com/VNDT1625/OmniAgent/releases/download/latest',
    'https://user:secret@github.com/VNDT1625/OmniAgent/releases/download/latest',
    'https://localhost/releases',
    'https://192.168.1.10/releases',
    'https://[::1]/releases',
    'https://updates.example.com/releases',
    'https://github.com:8443/VNDT1625/OmniAgent/releases/download/latest',
  ])('rejects unsafe packaged feed override %s', async (feedUrl) => {
    const { autoUpdater, log } = await importService(feedUrl);

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith('Invalid TOMNY_UPDATE_FEED_URL:', expect.any(Error));
  });

  it('keeps an explicit unpackaged development feed override', async () => {
    const { autoUpdater } = await importService('http://127.0.0.1:5077/releases', false);

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:5077/releases/',
    });
  });

  it('logs and ignores malformed feed URLs instead of crashing startup', async () => {
    const { autoUpdater, log } = await importService('file:///tmp/releases');

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith('Invalid TOMNY_UPDATE_FEED_URL:', expect.any(Error));
  });
});
