import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  startGateway: vi.fn(),
  configureGateway: vi.fn(),
  stopGateway: vi.fn(),
  configureHost: vi.fn(),
}));

vi.mock('@process/studio/cloudflareTunnel', () => ({
  startTunnel: mocks.startTunnel,
  stopTunnel: mocks.stopTunnel,
}));
vi.mock('@process/services/remoteGateway/registry', () => ({
  startRegisteredTomniRemoteGateway: mocks.startGateway,
  configureRegisteredTomniRemoteGateway: mocks.configureGateway,
  stopRegisteredTomniRemoteGateway: mocks.stopGateway,
}));

describe('Telegram remote startup lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.startGateway.mockResolvedValue({
      localUrl: 'http://127.0.0.1:4100',
      configure: mocks.configureHost,
    });
  });

  it('reuses one tunnel while synchronizing native language state', async () => {
    mocks.startTunnel.mockResolvedValue({ ok: true, url: 'https://remote.trycloudflare.com' });
    const { startTelegramRemoteTunnel, syncTelegramRemoteLanguage } =
      await import('@process/startup/telegramRemoteStartup');
    await startTelegramRemoteTunnel('vi-VN');
    await startTelegramRemoteTunnel('en-US');
    mocks.configureGateway.mockReturnValue(true);

    await expect(syncTelegramRemoteLanguage('ja-JP')).resolves.toBe(true);
    expect(mocks.startTunnel).toHaveBeenCalledTimes(1);
    expect(mocks.configureHost).toHaveBeenLastCalledWith({
      publicUrl: 'https://remote.trycloudflare.com',
      language: 'en-US',
    });
    expect(mocks.configureGateway).toHaveBeenCalledWith({ language: 'ja-JP' });
  });

  it('allows tunnel startup to retry after a failed attempt', async () => {
    mocks.startTunnel
      .mockResolvedValueOnce({ ok: false, reason: 'timeout' })
      .mockResolvedValueOnce({ ok: true, url: 'https://retry.trycloudflare.com' });
    const { startTelegramRemoteTunnel } = await import('@process/startup/telegramRemoteStartup');

    await expect(startTelegramRemoteTunnel()).resolves.toEqual({ ok: false, reason: 'timeout' });
    await expect(startTelegramRemoteTunnel()).resolves.toEqual({
      ok: true,
      url: 'https://retry.trycloudflare.com',
    });
    expect(mocks.startTunnel).toHaveBeenCalledTimes(2);
  });
});
