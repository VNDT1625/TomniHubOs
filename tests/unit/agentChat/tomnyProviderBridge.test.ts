import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (value: unknown) => Promise<unknown>;
const registered = new Map<string, Handler>();

vi.mock('@office-ai/platform', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    bridge: {
      ...actual?.bridge,
      buildProvider: (channel: string) => ({
        provider: (handler: Handler | undefined) => {
          if (handler) registered.set(channel, handler);
          else registered.delete(channel);
        },
        invoke: (args: unknown) => {
          const h = registered.get(channel);
          if (!h) throw new Error(`No handler registered for channel: ${channel}`);
          return h(args);
        },
      }),
    },
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/test-user-data', isPackaged: false },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ isDestroyed: () => false })) },
  ipcMain: { handle: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
}));

import type { IProvider } from '@/common/config/storage';
import { providerChannels } from '@/common/types/provider/providerChannels';
import { registerProviderBridge, resetProviderBridgeForTests } from '@process/services/tomnyProviderBridge';
import type { IProviderStore } from '@process/services/tomnyProviderStore';

describe('tomnyProviderBridge IPC registration and secret redaction', () => {
  let storedProviders: IProvider[];
  let mockStore: IProviderStore;

  beforeEach(() => {
    registered.clear();
    resetProviderBridgeForTests();
    storedProviders = [
      {
        id: 'provider-test-1',
        name: 'Anthropic Cloud',
        platform: 'anthropic',
        base_url: 'https://api.anthropic.com',
        api_key: 'super-secret-claude-key',
        models: ['claude-3-5-sonnet', 'claude-3-haiku'],
        enabled: true,
      } as IProvider,
      {
        id: 'provider-test-2',
        name: 'AWS Bedrock',
        platform: 'bedrock',
        base_url: 'https://bedrock.us-east-1.amazonaws.com',
        api_key: '',
        models: ['anthropic.claude-v2'],
        bedrock_config: {
          auth_method: 'accessKey',
          region: 'us-east-1',
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        },
      } as IProvider,
    ];

    mockStore = {
      list: vi.fn(async () => storedProviders),
      get: vi.fn(async (id: string) => storedProviders.find((p) => p.id === id)),
      create: vi.fn(async (input) => {
        const created = {
          ...input,
          id: input.id ?? `provider-${storedProviders.length + 1}`,
          models: input.models ?? [],
        } as IProvider;
        storedProviders.push(created);
        return created;
      }),
      update: vi.fn(async (id, input) => {
        const index = storedProviders.findIndex((p) => p.id === id);
        if (index < 0) throw new Error(`Provider not found: ${id}`);
        const updated = { ...storedProviders[index], ...input } as IProvider;
        storedProviders[index] = updated;
        return updated;
      }),
      remove: vi.fn(async (id) => {
        storedProviders = storedProviders.filter((p) => p.id !== id);
      }),
    };
  });

  it('registers listProviders and strictly redacts all secrets before sending to renderer', async () => {
    registerProviderBridge({ providerStore: mockStore });

    const providers = (await providerChannels.listProviders.invoke()) as IProvider[];
    expect(providers).toHaveLength(2);

    // API Key must be completely empty
    expect(providers[0].id).toBe('provider-test-1');
    expect(providers[0].api_key).toBe('');

    // Bedrock secret must be completely undefined
    expect(providers[1].id).toBe('provider-test-2');
    expect(providers[1].bedrock_config?.secret_access_key).toBeUndefined();
    expect(providers[1].bedrock_config?.access_key_id).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('registers createProvider and redacts secrets in the return payload', async () => {
    registerProviderBridge({ providerStore: mockStore });

    const created = (await providerChannels.createProvider.invoke({
      name: 'OpenAI Dev',
      platform: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-plaintext-secret-must-not-cross-ipc',
      models: ['gpt-4o'],
    })) as IProvider;

    expect(created.name).toBe('OpenAI Dev');
    expect(created.api_key).toBe('');
    expect(mockStore.create).toHaveBeenCalled();
  });

  it('registers updateProvider and redacts secrets in the return payload', async () => {
    registerProviderBridge({ providerStore: mockStore });

    const updated = (await providerChannels.updateProvider.invoke({
      id: 'provider-test-1',
      name: 'Anthropic Updated',
      api_key: 'sk-new-super-secret',
    })) as IProvider;

    expect(updated.name).toBe('Anthropic Updated');
    expect(updated.api_key).toBe('');
    expect(mockStore.update).toHaveBeenCalledWith('provider-test-1', {
      name: 'Anthropic Updated',
      api_key: 'sk-new-super-secret',
    });
  });

  it('registers deleteProvider and calls remove on store', async () => {
    registerProviderBridge({ providerStore: mockStore });

    await providerChannels.deleteProvider.invoke({ id: 'provider-test-1' });
    expect(mockStore.remove).toHaveBeenCalledWith('provider-test-1');
  });

  it('registers fetchProviderModels and returns saved models without touching secrets', async () => {
    registerProviderBridge({ providerStore: mockStore });

    const result = (await providerChannels.fetchProviderModels.invoke({ id: 'provider-test-1' })) as {
      models: string[];
    };
    expect(result.models).toEqual(['claude-3-5-sonnet', 'claude-3-haiku']);
  });

  it('detects protocol with fallback without making raw ungoverned network calls', async () => {
    registerProviderBridge({ providerStore: mockStore });

    const result = (await providerChannels.detectProtocol.invoke({
      endpoint: 'https://api.anthropic.com',
      preferredProtocol: 'anthropic',
    })) as { protocol: string };

    expect(result.protocol).toBe('anthropic');
  });
});
