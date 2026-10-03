import { describe, expect, it, vi } from 'vitest';
import {
  assertProviderDiscoveryDestination,
  registerProviderDiscoveryBridge,
} from '@/process/services/security/providerDiscovery/providerDiscoveryBridge';

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

const registeredBridge = (options?: {
  trusted?: boolean;
  authenticated?: boolean;
  provider?: { id: string; api_key: string; base_url: string };
}) => {
  const handlers = new Map<string, Handler>();
  const get = vi.fn().mockResolvedValue(options?.provider);
  const fetchModels = vi.fn().mockResolvedValue(['gpt-5.6']);
  const accountSession = {
    requireOnlineSession: vi.fn(() => {
      if (options?.authenticated === false) throw new Error('account required');
      return { accountId: 'account-1' };
    }),
  };
  registerProviderDiscoveryBridge({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as Handler),
      removeHandler: vi.fn(),
    },
    accountSession: accountSession as never,
    providerStore: { get },
    verifySender: () => options?.trusted !== false,
    fetchModels,
  });
  const handler = handlers.get('provider-discovery.fetch-models');
  if (!handler) throw new Error('provider discovery handler was not registered');
  return { handler, get, fetchModels, accountSession };
};

describe('native provider discovery bridge', () => {
  it('denies untrusted, pre-authenticated, and malformed requests before provider access or egress', async () => {
    const untrusted = registeredBridge({ trusted: false });
    await expect(untrusted.handler({}, { providerId: 'provider-1' })).resolves.toEqual({
      ok: false,
      code: 'PROVIDER_DISCOVERY_SENDER_UNTRUSTED',
    });
    expect(untrusted.get).not.toHaveBeenCalled();
    expect(untrusted.fetchModels).not.toHaveBeenCalled();

    const preauth = registeredBridge({ authenticated: false });
    await expect(preauth.handler({}, { providerId: 'provider-1' })).resolves.toEqual({
      ok: false,
      code: 'PROVIDER_DISCOVERY_ACCOUNT_REQUIRED',
    });
    expect(preauth.get).not.toHaveBeenCalled();
    expect(preauth.fetchModels).not.toHaveBeenCalled();

    const malformed = registeredBridge();
    await expect(malformed.handler({}, { providerId: 'provider-1', api_key: 'renderer-secret' })).resolves.toEqual({
      ok: false,
      code: 'PROVIDER_DISCOVERY_REQUEST_INVALID',
    });
    expect(malformed.get).not.toHaveBeenCalled();
    expect(malformed.fetchModels).not.toHaveBeenCalled();
  });

  it('accepts only an opaque provider identifier and never returns the stored credential', async () => {
    const bridge = registeredBridge({
      provider: { id: 'provider-1', api_key: 'stored-secret-must-not-leak', base_url: 'https://api.example.test/v1' },
    });
    const result = await bridge.handler({}, { providerId: 'provider-1' });
    expect(result).toEqual({ ok: true, models: ['gpt-5.6'] });
    expect(bridge.fetchModels).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-1' }));
    expect(JSON.stringify(result)).not.toContain('stored-secret-must-not-leak');
  });

  it('rejects credentialed URLs, private/DNS-rebound destinations, and non-loopback HTTP before egress', async () => {
    await expect(assertProviderDiscoveryDestination('https://user:secret@api.example.test/v1')).rejects.toThrow(
      'PROVIDER_DISCOVERY_DESTINATION_REJECTED'
    );
    await expect(assertProviderDiscoveryDestination('http://10.0.0.9/v1')).rejects.toThrow(
      'PROVIDER_DISCOVERY_DESTINATION_REJECTED'
    );
    await expect(
      assertProviderDiscoveryDestination('https://api.example.test/v1', async () => ['127.0.0.1'])
    ).rejects.toThrow('PROVIDER_DISCOVERY_DESTINATION_REJECTED');
    await expect(
      assertProviderDiscoveryDestination('https://api.example.test/v1', async () => ['203.0.113.10'])
    ).resolves.toMatchObject({
      url: expect.any(URL),
      addresses: ['203.0.113.10'],
    });
    await expect(assertProviderDiscoveryDestination('http://127.0.0.1:11434/v1')).resolves.toMatchObject({
      addresses: ['127.0.0.1'],
    });
  });
});
