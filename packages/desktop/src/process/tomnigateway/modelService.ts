import { randomUUID } from 'node:crypto';
import type { ChatMessageInput } from '@process/services/agentChat/types';
import type { ProviderExecutionBroker } from '@process/services/security/providerExecution/providerExecutionBroker';

import type { ModelRequestHistory, ModelRequestUsage } from './modelRequestHistory';
import type { ModelQuotaSnapshotStore } from './modelQuotaSnapshots';
import type { ModelReplayStore } from './modelReplayStore';

import type { TomniGatewayModelService, TomniGatewayQuotaSnapshot } from './types';

export type TomniGatewayModelConsumer = Readonly<{ consumerId: string; allowedModels?: readonly string[] }>;

const estimateTokens = (value: unknown): number => Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);

const usageFrom = (
  messages: readonly unknown[],
  content: string,
  result: { usage?: Record<string, number> }
): ModelRequestUsage => {
  const promptCount = result.usage?.prompt_tokens;
  const completionCount = result.usage?.completion_tokens;
  const totalCount = result.usage?.total_tokens;
  const cachedCount = result.usage?.cached_tokens;
  const reasoningCount = result.usage?.reasoning_tokens;
  if (
    promptCount !== undefined ||
    completionCount !== undefined ||
    totalCount !== undefined ||
    cachedCount !== undefined ||
    reasoningCount !== undefined
  ) {
    return {
      source: 'reported',
      ...(promptCount === undefined ? {} : { promptCount }),
      ...(completionCount === undefined ? {} : { completionCount }),
      ...(totalCount === undefined ? {} : { totalCount }),
      ...(cachedCount === undefined ? {} : { cachedCount }),
      ...(reasoningCount === undefined ? {} : { reasoningCount }),
    };
  }
  const estimatedPrompt = estimateTokens(messages);
  const estimatedCompletion = estimateTokens(content);
  return {
    source: 'estimated',
    promptCount: estimatedPrompt,
    completionCount: estimatedCompletion,
    totalCount: estimatedPrompt + estimatedCompletion,
  };
};

const errorCode = (error: unknown, signal: AbortSignal): string => {
  if (signal.aborted) return 'MODEL_REQUEST_CANCELLED';
  return error instanceof Error && /^[A-Z0-9_]{3,120}$/u.test(error.message) ? error.message : 'MODEL_EXECUTION_FAILED';
};

/** Adapts the Main-only provider broker to isolated HTTP model ingress. */
export const createBrokerBackedTomniModelService = (input: {
  broker: ProviderExecutionBroker;
  resolveCredential: (credential: string) => Promise<TomniGatewayModelConsumer | undefined>;
  getConsumer: (consumerId: string) => Promise<TomniGatewayModelConsumer | undefined>;
  history: ModelRequestHistory;
  replay?: ModelReplayStore;
  quotaSnapshots?: ModelQuotaSnapshotStore;
  quotaAdapter?: (input: { consumerId: string; model?: string }) => Promise<TomniGatewayQuotaSnapshot | undefined>;
  actorId: () => string;
  now?: () => number;
  newId?: () => string;
}): TomniGatewayModelService => {
  const now = input.now ?? Date.now;
  const newId = input.newId ?? randomUUID;
  return {
    authorize: async ({ credential }) => {
      const consumer = await input.resolveCredential(credential);
      return consumer && consumer.consumerId.trim() ? { consumerId: consumer.consumerId } : undefined;
    },
    listRequestHistory: async (query = {}) => {
      const records = await input.history.list({ ...query, actorId: input.actorId() });
      return records.map((record) => Object.assign({}, record));
    },
    getQuota: async ({ consumerId, model }) => {
      const consumer = await input.getConsumer(consumerId);
      if (!consumer || consumer.consumerId !== consumerId) throw new Error('MODEL_CONSUMER_REVOKED');
      if (model !== undefined && consumer.allowedModels && !consumer.allowedModels.includes(model)) {
        throw new Error('MODEL_NOT_ALLOWED');
      }
      let fresh: TomniGatewayQuotaSnapshot | undefined;
      try {
        const candidate = await input.quotaAdapter?.({ consumerId, ...(model === undefined ? {} : { model }) });
        const matchesScope =
          candidate !== undefined &&
          candidate.consumerId === consumerId &&
          (model === undefined || candidate.model === model) &&
          !(candidate.status === 'unknown' && (candidate.remaining !== undefined || candidate.limit !== undefined));
        if (matchesScope) fresh = candidate;
      } catch {
        fresh = undefined;
      }
      if (fresh && input.quotaSnapshots) {
        await input.quotaSnapshots.save({ actorId: input.actorId(), snapshot: fresh });
      }
      const cached = fresh ?? (await input.quotaSnapshots?.latest({ actorId: input.actorId(), consumerId, model }));
      if (cached) {
        return cached.staleAfter !== undefined && cached.staleAfter < now()
          ? { ...cached, status: 'stale', source: 'cache' }
          : cached;
      }
      return {
        status: 'unknown',
        source: 'unsupported',
        unit: 'tokens',
        consumerId,
        observedAt: now(),
        ...(model === undefined ? {} : { model }),
      };
    },
    ...(input.replay
      ? {
          replayPreview: async () => await input.replay.preview(input.actorId()),
          replayExport: async () => await input.replay.exportSamples(input.actorId()),
          deleteReplay: async (sampleId?: string) => await input.replay.delete(input.actorId(), sampleId),
        }
      : {}),
    chatCompletions: async ({ consumerId, model, messages, signal, requestId, sessionId }) => {
      const consumer = await input.getConsumer(consumerId);
      if (!consumer || consumer.consumerId !== consumerId) throw new Error('MODEL_CONSUMER_REVOKED');
      if (consumer.allowedModels && !consumer.allowedModels.includes(model)) throw new Error('MODEL_NOT_ALLOWED');
      const startedAt = now();
      const durableRequestId = requestId ?? `model-request-${newId()}`;
      const durableSessionId = sessionId ?? `model-consumer-${consumerId}`;
      const receiptId = `model-receipt-${newId()}`;
      const actorId = input.actorId();
      await input.history.begin({
        requestId: durableRequestId,
        sessionId: durableSessionId,
        consumerId,
        actorId,
        model,
        startedAt,
      });
      try {
        const result = await input.broker.execute({ model, messages: messages as ChatMessageInput[], signal });
        const usage = usageFrom(messages, result.content, result);
        await input.history.complete({
          requestId: durableRequestId,
          sessionId: durableSessionId,
          consumerId,
          actorId,
          model,
          providerId: result.providerId,
          status: 'completed',
          receiptId,
          startedAt,
          finishedAt: now(),
          usage,
        });
        if (input.replay) {
          await input.replay
            .capture({
              actorId,
              requestId: durableRequestId,
              sessionId: durableSessionId,
              consumerId,
              model,
              capturedAt: startedAt,
              input: messages,
              output: result.content,
            })
            .catch((): undefined => undefined);
        }
        return { model, content: result.content, usage: result.usage, receiptId, requestId: durableRequestId };
      } catch (error) {
        const code = errorCode(error, signal);
        await input.history.complete({
          requestId: durableRequestId,
          sessionId: durableSessionId,
          consumerId,
          actorId,
          model,
          providerId: 'unknown-provider',
          status: signal.aborted ? 'cancelled' : 'failed',
          receiptId,
          startedAt,
          finishedAt: now(),
          usage: { source: 'unavailable' },
          errorCode: code,
        });
        throw error;
      }
    },
  };
};
