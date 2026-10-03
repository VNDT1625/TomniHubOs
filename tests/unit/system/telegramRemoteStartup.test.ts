import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  startGateway: vi.fn(),
  configureGateway: vi.fn(),
  stopGateway: vi.fn(),
  configureHost: vi.fn(),
}));

vi.mock('@process/services/remoteGateway/cloudflareTunnel', () => ({
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
    await startTelegramRemoteTunnel('vi-VN', () => true);
    await startTelegramRemoteTunnel('en-US', () => true);
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

    await expect(startTelegramRemoteTunnel('en-US', () => true)).resolves.toEqual({ ok: false, reason: 'timeout' });
    await expect(startTelegramRemoteTunnel('en-US', () => true)).resolves.toEqual({
      ok: true,
      url: 'https://retry.trycloudflare.com',
    });
    expect(mocks.startTunnel).toHaveBeenCalledTimes(2);
  });

  it('does not create a gateway or spawn a public tunnel without Main authority', async () => {
    const { startTelegramRemoteTunnel } = await import('@process/startup/telegramRemoteStartup');
    const existingSecret = process.env.TOMNI_TELEGRAM_REMOTE_SECRET;

    await expect(startTelegramRemoteTunnel()).resolves.toEqual({ ok: false, reason: 'external-authority-required' });
    expect(mocks.startGateway).not.toHaveBeenCalled();
    expect(mocks.startTunnel).not.toHaveBeenCalled();
    expect(process.env.TOMNI_TELEGRAM_REMOTE_SECRET).toBe(existingSecret);
  });
});
