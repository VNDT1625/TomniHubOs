import { describe, expect, it, vi } from 'vitest';
import { TOMNI_GATEWAY_APP_CLIENT_NAME, TOMNI_GATEWAY_PROVIDER_ID } from '@/common/router9';
import {
  autoStartAndSyncManagedRouter9Provider,
  syncManagedRouter9Provider,
} from '@process/router9/managedRouter9ProviderSync';
import type { IProviderStore } from '@process/services/tomnyProviderStore';

const makeStore = (existing = false): IProviderStore => ({
  list: vi.fn(async () => []),
  get: vi.fn(async () => (existing ? ({ id: TOMNI_GATEWAY_PROVIDER_ID } as never) : undefined)),
  create: vi.fn(async (provider) => provider as never),
  update: vi.fn(async (_id, provider) => provider as never),
  remove: vi.fn(async () => undefined),
});

describe('syncManagedRouter9Provider', () => {
  it('creates a dedicated Tomny provider without reusing an external CLI client', async () => {
    const managed = {
      start: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:20129/v1' })),
      ensureClient: vi.fn(async () => ({ id: 'app-client', key: 'sk-tomni-app' })),
      listModels: vi.fn(async () => [{ id: 'cx/gpt-5.6-luna' }, { id: 'kr/claude-sonnet' }]),
    };
    const store = makeStore();

    const result = await syncManagedRouter9Provider(managed as never, store);

    expect(managed.ensureClient).toHaveBeenCalledWith(TOMNI_GATEWAY_APP_CLIENT_NAME);
    expect(managed.listModels).toHaveBeenCalledWith('sk-tomni-app');
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TOMNI_GATEWAY_PROVIDER_ID,
        base_url: 'http://127.0.0.1:20129/v1',
        api_key: 'sk-tomni-app',
        models: ['cx/gpt-5.6-luna', 'kr/claude-sonnet'],
      })
    );
    expect(result.models).toHaveLength(2);
  });

  it('does not create a provider when persisted auto-start is disabled', async () => {
    const managed = {
      startIfEnabled: vi.fn(async () => ({ state: 'stopped', autoStart: false })),
      start: vi.fn(),
      ensureClient: vi.fn(),
      listModels: vi.fn(),
    };
    const store = makeStore();

    const result = await autoStartAndSyncManagedRouter9Provider(managed as never, store);

    expect(result.sync).toBeUndefined();
    expect(store.create).not.toHaveBeenCalled();
  });

  it('synchronizes Tomny after a persisted gateway finishes starting', async () => {
    const status = {
      state: 'running',
      autoStart: true,
      baseUrl: 'http://127.0.0.1:20129/v1',
    };
    const managed = {
      startIfEnabled: vi.fn(async () => status),
      start: vi.fn(async () => status),
      ensureClient: vi.fn(async () => ({ id: 'app-client', key: 'sk-auto-start' })),
      listModels: vi.fn(async () => [{ id: 'cx/gpt-5.6-luna' }]),
    };
    const store = makeStore();

    const result = await autoStartAndSyncManagedRouter9Provider(managed as never, store);

    expect(result.sync?.models).toEqual(['cx/gpt-5.6-luna']);
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'sk-auto-start' }));
  });

  it('updates the fixed provider record on later catalog refreshes', async () => {
    const managed = {
      start: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:20129/v1' })),
      ensureClient: vi.fn(async () => ({ id: 'app-client', key: 'sk-refreshed' })),
      listModels: vi.fn(async () => [{ id: 'new-model' }]),
    };
    const store = makeStore(true);

    await syncManagedRouter9Provider(managed as never, store);

    expect(store.create).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith(
      TOMNI_GATEWAY_PROVIDER_ID,
      expect.objectContaining({ api_key: 'sk-refreshed', models: ['new-model'] })
    );
  });
});
