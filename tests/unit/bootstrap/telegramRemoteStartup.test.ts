import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Telegram remote startup', () => {
  const oldTomniSecret = process.env.TOMNI_TELEGRAM_REMOTE_SECRET;
  const oldLegacySecret = process.env.TOMNY_TELEGRAM_REMOTE_SECRET;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.TOMNI_TELEGRAM_REMOTE_SECRET;
    delete process.env.TOMNY_TELEGRAM_REMOTE_SECRET;
    mocks.startGateway.mockResolvedValue({
      localUrl: 'http://127.0.0.1:45678',
      configure: mocks.configureHost,
    });
  });

  afterEach(() => {
    if (oldTomniSecret === undefined) delete process.env.TOMNI_TELEGRAM_REMOTE_SECRET;
    else process.env.TOMNI_TELEGRAM_REMOTE_SECRET = oldTomniSecret;
    if (oldLegacySecret === undefined) delete process.env.TOMNY_TELEGRAM_REMOTE_SECRET;
    else process.env.TOMNY_TELEGRAM_REMOTE_SECRET = oldLegacySecret;
  });

  it('creates one Tomny-owned 256-bit secret and reuses it', async () => {
    const { prepareTelegramRemoteSecret } = await import('@/process/startup/telegramRemoteStartup');
    const first = prepareTelegramRemoteSecret();
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepareTelegramRemoteSecret()).toBe(first);
    expect(process.env.TOMNI_TELEGRAM_REMOTE_SECRET).toBe(first);
  });

  it('targets the native gateway without a legacy port or /api call', async () => {
    mocks.startTunnel.mockResolvedValue({ ok: true, url: 'https://remote.trycloudflare.com' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { startTelegramRemoteTunnel } = await import('@/process/startup/telegramRemoteStartup');

    await expect(startTelegramRemoteTunnel('vi-VN', () => true)).resolves.toEqual({
      ok: true,
      url: 'https://remote.trycloudflare.com',
    });
    expect(mocks.startTunnel).toHaveBeenCalledWith('telegram-remote', 'http://127.0.0.1:45678');
    expect(mocks.startGateway).toHaveBeenCalledWith({
      secret: expect.stringMatching(/^[a-f0-9]{64}$/u),
      language: 'vi-VN',
    });
    expect(mocks.configureHost).toHaveBeenCalledWith({
      publicUrl: 'https://remote.trycloudflare.com',
      language: 'vi-VN',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the native gateway alive when cloudflared is unavailable', async () => {
    mocks.startTunnel.mockResolvedValue({ ok: false, reason: 'not-installed' });
    const { startTelegramRemoteTunnel } = await import('@/process/startup/telegramRemoteStartup');
    await expect(startTelegramRemoteTunnel('en-US', () => true)).resolves.toEqual({
      ok: false,
      reason: 'not-installed',
    });
    expect(mocks.startGateway).toHaveBeenCalledOnce();
  });
});
