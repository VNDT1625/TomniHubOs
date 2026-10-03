import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerTomniModelConsumerBridge,
  TOMNI_MODEL_CONSUMER_CHANNELS,
  type TomniGatewayModelConsumerRegistry,
} from '@process/tomnigateway/modelConsumerBridge';

type Provider = (value?: unknown) => Promise<unknown>;
const registered = new Map<string, Provider>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: Provider) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
  },
}));

const provider = (channel: string): Provider => {
  const handler = registered.get(channel);
  if (!handler) throw new Error(`Missing provider ${channel}`);
  return handler;
};

describe('Tomni model consumer bridge', () => {
  beforeEach(() => registered.clear());

  it('fails closed before registry access when the account guard rejects', async () => {
    const issue = vi.fn();
    const requireAuthenticatedAccount = vi.fn(() => {
      throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    });
    registerTomniModelConsumerBridge(
      { issue, list: vi.fn(), revoke: vi.fn() } as unknown as TomniGatewayModelConsumerRegistry,
      { requireAuthenticatedAccount }
    );

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.issue)({ label: 'CLI', allowedModels: ['model-1'], ttlMs: 60_000 })
    ).resolves.toEqual({ ok: false, error: 'ACCOUNT_SESSION_ONLINE_REQUIRED' });
    expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(issue).not.toHaveBeenCalled();
  });

  it('rejects malformed issue and revoke payloads before touching the registry', async () => {
    const registry = {
      issue: vi.fn(),
      list: vi.fn(),
      revoke: vi.fn(),
    } as unknown as TomniGatewayModelConsumerRegistry;
    registerTomniModelConsumerBridge(registry);

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.issue)({ label: 'CLI', allowedModels: [], ttlMs: 'bad' })
    ).resolves.toEqual({
      ok: false,
      error: 'MODEL_CONSUMER_INVALID_ISSUE',
    });
    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.revoke)({ consumerId: '' })).resolves.toEqual({
      ok: false,
      error: 'MODEL_CONSUMER_INVALID_REVOKE',
    });
    expect(registry.issue).not.toHaveBeenCalled();
    expect(registry.revoke).not.toHaveBeenCalled();
  });

  it('forwards valid issue/list/revoke calls and preserves the credential only in issue response', async () => {
    const issue = vi.fn(async () => ({ consumerId: 'consumer-1', credential: 'opaque-secret', expiresAt: 'future' }));
    const list = vi.fn(async () => [
      {
        consumerId: 'consumer-1',
        label: 'CLI',
        allowedModels: ['model-1'],
        createdAt: 'now',
        expiresAt: 'future',
      },
    ]);
    const revoke = vi.fn(async () => true);
    registerTomniModelConsumerBridge({ issue, list, revoke });

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.issue)({ label: 'CLI', allowedModels: ['model-1'], ttlMs: 60_000 })
    ).resolves.toEqual({
      ok: true,
      data: { consumerId: 'consumer-1', credential: 'opaque-secret', expiresAt: 'future' },
    });
    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.list)()).resolves.toEqual({ ok: true, data: await list() });
    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.revoke)({ consumerId: 'consumer-1' })).resolves.toEqual({
      ok: true,
      data: true,
    });
    expect(issue).toHaveBeenCalledWith({ label: 'CLI', allowedModels: ['model-1'], ttlMs: 60_000 });
    expect(revoke).toHaveBeenCalledWith('consumer-1');
  });

  it('denies apply for revoked consumers and model allowlist violations', async () => {
    const resolveCredential = vi.fn(async (credential: string) =>
      credential === 'revoked-secret' ? undefined : { consumerId: 'consumer-1', allowedModels: ['model-allowed'] }
    );
    registerTomniModelConsumerBridge({
      issue: vi.fn(),
      list: vi.fn(),
      revoke: vi.fn(),
      resolveCredential,
    } as unknown as TomniGatewayModelConsumerRegistry);

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.apply)({
        consumerId: 'consumer-1',
        credential: 'revoked-secret',
        targetId: 'codex',
        endpoint: { baseUrl: 'http://127.0.0.1:20129/v1', apiKey: 'revoked-secret', model: 'model-allowed' },
      })
    ).resolves.toEqual({ ok: false, error: 'MODEL_CONSUMER_REVOKED_OR_MODEL_DENIED' });
    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.apply)({
        consumerId: 'consumer-1',
        credential: 'active-secret',
        targetId: 'codex',
        endpoint: { baseUrl: 'http://127.0.0.1:20129/v1', apiKey: 'active-secret', model: 'model-denied' },
      })
    ).resolves.toEqual({ ok: false, error: 'MODEL_CONSUMER_REVOKED_OR_MODEL_DENIED' });
  });
  it('rejects non-loopback gateway endpoints before registry access', async () => {
    const resolveCredential = vi.fn(async () => ({ consumerId: 'consumer-1', allowedModels: ['model-1'] }));
    registerTomniModelConsumerBridge({
      issue: vi.fn(),
      list: vi.fn(),
      revoke: vi.fn(),
      resolveCredential,
    } as unknown as TomniGatewayModelConsumerRegistry);

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.apply)({
        consumerId: 'consumer-1',
        credential: 'active-secret',
        targetId: 'codex',
        endpoint: { baseUrl: 'https://evil.example/v1', apiKey: 'active-secret', model: 'model-1' },
      })
    ).resolves.toEqual({ ok: false, error: 'MODEL_CONSUMER_INVALID_APPLY' });
    expect(resolveCredential).not.toHaveBeenCalled();
  });
  it('forwards authenticated credential rotation and never returns the old credential', async () => {
    const rotate = vi.fn(async () => ({ consumerId: 'consumer-1', credential: 'new-secret', expiresAt: 'future' }));
    registerTomniModelConsumerBridge(
      { issue: vi.fn(), list: vi.fn(), revoke: vi.fn(), rotate } as unknown as TomniGatewayModelConsumerRegistry,
      { requireAuthenticatedAccount: vi.fn() }
    );
    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.rotate)({ consumerId: 'consumer-1', ttlMs: 60_000 })
    ).resolves.toEqual({
      ok: true,
      data: { consumerId: 'consumer-1', credential: 'new-secret', expiresAt: 'future' },
    });
    expect(rotate).toHaveBeenCalledWith({ consumerId: 'consumer-1', ttlMs: 60_000 });
    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.rotate)({ consumerId: 'consumer-1', ttlMs: 'bad' })
    ).resolves.toEqual({
      ok: false,
      error: 'MODEL_CONSUMER_INVALID_ROTATE',
    });
  });

  it('delegates approved configuration writes without importing the runtime lifecycle', async () => {
    const applyConfiguration = vi.fn(async (request) => ({ targetId: request.targetId, files: [], notes: [] }));
    registerTomniModelConsumerBridge(
      {
        issue: vi.fn(),
        list: vi.fn(),
        revoke: vi.fn(),
        resolveCredential: vi.fn(async () => ({ consumerId: 'consumer-1', allowedModels: ['model-1'] })),
      } as unknown as TomniGatewayModelConsumerRegistry,
      {
        getApprovedGatewayBaseUrl: () => 'http://127.0.0.1:20401/v1',
        applyConfiguration,
      }
    );

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.apply)({
        consumerId: 'consumer-1',
        credential: 'active-secret',
        targetId: 'codex',
        endpoint: { baseUrl: 'http://127.0.0.1:20401/v1', apiKey: 'active-secret', model: 'model-1' },
      })
    ).resolves.toEqual({ ok: true, data: { targetId: 'codex', files: [], notes: [] } });
    expect(applyConfiguration).toHaveBeenCalledOnce();
  });

  it('rejects replay deletion payloads with unknown keys', async () => {
    const deleteReplay = vi.fn(async () => 1);
    registerTomniModelConsumerBridge(
      { issue: vi.fn(), list: vi.fn(), revoke: vi.fn() } as unknown as TomniGatewayModelConsumerRegistry,
      { modelService: { deleteReplay } as unknown as import('@process/tomnigateway/types').TomniGatewayModelService }
    );

    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.deleteReplay)({ unexpected: true })).resolves.toEqual({
      ok: false,
      error: 'MODEL_CONSUMER_REPLAY_UNAVAILABLE',
    });
    expect(deleteReplay).not.toHaveBeenCalled();
  });

  it('returns the Main-owned gateway endpoint through the authenticated channel', async () => {
    const requireAuthenticatedAccount = vi.fn();
    registerTomniModelConsumerBridge(
      { issue: vi.fn(), list: vi.fn(), revoke: vi.fn() } as unknown as TomniGatewayModelConsumerRegistry,
      { requireAuthenticatedAccount, getApprovedGatewayBaseUrl: () => 'http://127.0.0.1:20401/v1' }
    );

    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.gatewayEndpoint)()).resolves.toEqual({
      ok: true,
      data: { baseUrl: 'http://127.0.0.1:20401/v1' },
    });
    expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
  });

  it('rejects a loopback endpoint that does not match the Main-owned gateway endpoint', async () => {
    const resolveCredential = vi.fn();
    registerTomniModelConsumerBridge(
      {
        issue: vi.fn(),
        list: vi.fn(),
        revoke: vi.fn(),
        resolveCredential,
      } as unknown as TomniGatewayModelConsumerRegistry,
      { getApprovedGatewayBaseUrl: () => 'http://127.0.0.1:20401/v1' }
    );

    await expect(
      provider(TOMNI_MODEL_CONSUMER_CHANNELS.apply)({
        consumerId: 'consumer-1',
        credential: 'active-secret',
        targetId: 'codex',
        endpoint: { baseUrl: 'http://127.0.0.1:20402/v1', apiKey: 'active-secret', model: 'model-1' },
      })
    ).resolves.toEqual({ ok: false, error: 'MODEL_CONSUMER_INVALID_APPLY' });
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it('exports and deletes replay samples only through authenticated service calls', async () => {
    const requireAuthenticatedAccount = vi.fn();
    const replayExport = vi.fn(async () => [{ sampleId: 'sample-1', output: 'redacted' }]);
    const deleteReplay = vi.fn(async (_sampleId?: string) => 1);
    registerTomniModelConsumerBridge(
      { issue: vi.fn(), list: vi.fn(), revoke: vi.fn() } as unknown as TomniGatewayModelConsumerRegistry,
      {
        requireAuthenticatedAccount,
        modelService: {
          replayExport,
          deleteReplay,
        } as unknown as import('@process/tomnigateway/types').TomniGatewayModelService,
      }
    );

    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.replayExport)()).resolves.toEqual({
      ok: true,
      data: [{ sampleId: 'sample-1', output: 'redacted' }],
    });
    await expect(provider(TOMNI_MODEL_CONSUMER_CHANNELS.deleteReplay)({ sampleId: 'sample-1' })).resolves.toEqual({
      ok: true,
      data: 1,
    });
    expect(replayExport).toHaveBeenCalledOnce();
    expect(deleteReplay).toHaveBeenCalledWith('sample-1');
    expect(requireAuthenticatedAccount).toHaveBeenCalledTimes(2);
  });

  it('exposes history, quota, and replay preview through the authenticated bridge', async () => {
    const modelService = {
      listRequestHistory: vi.fn(async () => [{ requestId: 'request-1', status: 'completed' }]),
      getQuota: vi.fn(async () => ({
        status: 'unknown',
        source: 'unsupported',
        unit: 'tokens',
        consumerId: 'consumer-1',
        observedAt: 1,
      })),
      replayPreview: vi.fn(async () => ({ enabled: false, count: 0, bytes: 0 })),
    } as unknown as import('@process/tomnigateway/types').TomniGatewayModelService;
    registerTomniModelConsumerBridge(
      { issue: vi.fn(), list: vi.fn(), revoke: vi.fn() } as unknown as TomniGatewayModelConsumerRegistry,
      { modelService }
    );
    await expect(provider('tomni-model-consumer.history')({ consumerId: 'consumer-1' })).resolves.toEqual({
      ok: true,
      data: [{ requestId: 'request-1', status: 'completed' }],
    });
    await expect(provider('tomni-model-consumer.quota')({ consumerId: 'consumer-1' })).resolves.toMatchObject({
      ok: true,
    });
    await expect(provider('tomni-model-consumer.replay-preview')()).resolves.toEqual({
      ok: true,
      data: { enabled: false, count: 0, bytes: 0 },
    });
  });
});
