import { createBrokerBackedTomniModelService, createModelRequestHistory } from '@process/tomnigateway';
import { MemoryDurableEventStore } from '@process/services/agentChat/durability';
import { describe, expect, it, vi } from 'vitest';

describe('broker-backed Tomny model service', () => {
  it('resolves opaque consumers and records a terminal receipt', async () => {
    const broker = { execute: vi.fn(async () => ({ content: 'answer', evidenceRef: 'receipt-1' })) } as never;
    const consumers = new Map([
      ['credential-1', { consumerId: 'consumer-1', allowedModels: ['model-1'] }],
      ['consumer-1', { consumerId: 'consumer-1', allowedModels: ['model-1'] }],
    ]);
    const history = createModelRequestHistory(new MemoryDurableEventStore());
    const service = createBrokerBackedTomniModelService({
      broker,
      resolveCredential: async (credential) => consumers.get(credential),
      getConsumer: async (consumerId) => consumers.get(consumerId),
      history,
      actorId: () => 'account-1',
    });

    expect(await service.authorize({ credential: 'credential-1', path: '/v1/chat/completions' })).toEqual({
      consumerId: 'consumer-1',
    });
    await expect(
      service.chatCompletions({
        consumerId: 'consumer-1',
        model: 'model-1',
        messages: [{ role: 'user', content: 'hello' }],
        signal: new AbortController().signal,
        requestId: 'request-1',
        sessionId: 'session-1',
      })
    ).resolves.toMatchObject({ model: 'model-1', content: 'answer', receiptId: expect.any(String) });
    expect((await history.list({ actorId: 'account-1' }))[0]).toMatchObject({
      requestId: 'request-1',
      status: 'completed',
      usage: { source: 'estimated' },
    });

    consumers.delete('consumer-1');
    await expect(
      service.chatCompletions({
        consumerId: 'consumer-1',
        model: 'model-1',
        messages: [],
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('MODEL_CONSUMER_REVOKED');
  });

  it('persists provider-reported token usage without replacing it with an estimate', async () => {
    const history = createModelRequestHistory(new MemoryDurableEventStore());
    const service = createBrokerBackedTomniModelService({
      broker: {
        execute: vi.fn(async () => ({
          content: 'answer',
          evidenceRef: 'receipt-2',
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        })),
      } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1' }),
      getConsumer: async () => ({ consumerId: 'consumer-1' }),
      history,
      actorId: () => 'account-1',
    });

    await service.chatCompletions({
      consumerId: 'consumer-1',
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
      requestId: 'request-reported',
      sessionId: 'session-1',
    });
    await expect(history.list({ actorId: 'account-1' })).resolves.toEqual([
      expect.objectContaining({
        requestId: 'request-reported',
        usage: { source: 'reported', promptCount: 12, completionCount: 7, totalCount: 19 },
      }),
    ]);
  });

  it('persists reported cache and reasoning token counts', async () => {
    const history = createModelRequestHistory(new MemoryDurableEventStore());
    const service = createBrokerBackedTomniModelService({
      broker: {
        execute: vi.fn(async () => ({
          content: 'answer',
          evidenceRef: 'receipt-nested-usage',
          usage: {
            prompt_tokens: 20,
            completion_tokens: 9,
            total_tokens: 29,
            cached_tokens: 6,
            reasoning_tokens: 4,
          },
        })),
      } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1' }),
      getConsumer: async () => ({ consumerId: 'consumer-1' }),
      history,
      actorId: () => 'account-1',
    });

    await service.chatCompletions({
      consumerId: 'consumer-1',
      model: 'model-1',
      messages: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
      requestId: 'request-nested-usage',
      sessionId: 'session-1',
    });

    await expect(history.list({ actorId: 'account-1' })).resolves.toEqual([
      expect.objectContaining({
        requestId: 'request-nested-usage',
        usage: {
          source: 'reported',
          promptCount: 20,
          completionCount: 9,
          totalCount: 29,
          cachedCount: 6,
          reasoningCount: 4,
        },
      }),
    ]);
  });

  it('enforces the consumer model allowlist before provider execution', async () => {
    const broker = { execute: vi.fn() } as never;
    const service = createBrokerBackedTomniModelService({
      broker,
      resolveCredential: async () => ({ consumerId: 'consumer-1', allowedModels: ['allowed'] }),
      getConsumer: async () => ({ consumerId: 'consumer-1', allowedModels: ['allowed'] }),
      history: createModelRequestHistory(new MemoryDurableEventStore()),
      actorId: () => 'account-1',
    });
    await expect(
      service.chatCompletions({
        consumerId: 'consumer-1',
        model: 'blocked',
        messages: [],
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('MODEL_NOT_ALLOWED');
    expect(broker.execute).not.toHaveBeenCalled();
  });

  it('returns provider-reported credit quota and caches it for later reads', async () => {
    const quotaAdapter = vi.fn(async () => ({
      status: 'reported' as const,
      source: 'provider' as const,
      unit: 'credits' as const,
      consumerId: 'consumer-1',
      providerId: 'provider-1',
      observedAt: 10,
      remaining: 42,
      limit: 100,
    }));
    const service = createBrokerBackedTomniModelService({
      broker: { execute: vi.fn() } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1' }),
      getConsumer: async () => ({ consumerId: 'consumer-1' }),
      history: createModelRequestHistory(new MemoryDurableEventStore()),
      quotaAdapter,
      actorId: () => 'account-1',
    });
    await expect(service.getQuota?.({ consumerId: 'consumer-1' })).resolves.toEqual({
      status: 'reported',
      source: 'provider',
      unit: 'credits',
      consumerId: 'consumer-1',
      providerId: 'provider-1',
      observedAt: 10,
      remaining: 42,
      limit: 100,
    });
    expect(quotaAdapter).toHaveBeenCalledWith({ consumerId: 'consumer-1' });
  });

  it('does not accept quota snapshots outside the requested consumer/model scope', async () => {
    const quotaAdapter = vi.fn(async () => ({
      status: 'reported' as const,
      source: 'provider' as const,
      unit: 'credits' as const,
      consumerId: 'other-consumer',
      model: 'other-model',
      observedAt: 10,
      remaining: 99,
      limit: 100,
    }));
    const service = createBrokerBackedTomniModelService({
      broker: { execute: vi.fn() } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1', allowedModels: ['model-1'] }),
      getConsumer: async () => ({ consumerId: 'consumer-1', allowedModels: ['model-1'] }),
      history: createModelRequestHistory(new MemoryDurableEventStore()),
      quotaAdapter,
      actorId: () => 'account-1',
    });

    await expect(service.getQuota?.({ consumerId: 'consumer-1', model: 'model-1' })).resolves.toMatchObject({
      status: 'unknown',
      source: 'unsupported',
      consumerId: 'consumer-1',
      model: 'model-1',
    });
  });

  it('denies quota reads for a model outside the consumer allowlist', async () => {
    const quotaAdapter = vi.fn();
    const service = createBrokerBackedTomniModelService({
      broker: { execute: vi.fn() } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1', allowedModels: ['model-1'] }),
      getConsumer: async () => ({ consumerId: 'consumer-1', allowedModels: ['model-1'] }),
      history: createModelRequestHistory(new MemoryDurableEventStore()),
      quotaAdapter,
      actorId: () => 'account-1',
    });

    await expect(service.getQuota?.({ consumerId: 'consumer-1', model: 'blocked-model' })).rejects.toThrow(
      'MODEL_NOT_ALLOWED'
    );
    expect(quotaAdapter).not.toHaveBeenCalled();
  });

  it('rejects quota reads for a revoked consumer', async () => {
    const service = createBrokerBackedTomniModelService({
      broker: { execute: vi.fn() } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1' }),
      getConsumer: async () => undefined,
      history: createModelRequestHistory(new MemoryDurableEventStore()),
      quotaAdapter: vi.fn(),
      actorId: () => 'account-1',
    });
    await expect(service.getQuota?.({ consumerId: 'consumer-1' })).rejects.toThrow('MODEL_CONSUMER_REVOKED');
  });

  it('records cancellation with unknown final usage', async () => {
    const controller = new AbortController();
    const history = createModelRequestHistory(new MemoryDurableEventStore());
    const service = createBrokerBackedTomniModelService({
      broker: {
        execute: vi.fn(async ({ signal }: { signal: AbortSignal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
          throw new Error('PROVIDER_EXECUTION_ABORTED');
        }),
      } as never,
      resolveCredential: async () => ({ consumerId: 'consumer-1' }),
      getConsumer: async () => ({ consumerId: 'consumer-1' }),
      history,
      actorId: () => 'account-1',
    });
    const pending = service.chatCompletions({
      consumerId: 'consumer-1',
      model: 'model-1',
      messages: [],
      signal: controller.signal,
      requestId: 'request-cancel',
      sessionId: 'session-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(history.list({ status: 'cancelled' })).resolves.toEqual([
      expect.objectContaining({
        requestId: 'request-cancel',
        usage: { source: 'unavailable' },
        termination: 'cancelled',
      }),
    ]);
  });
});
