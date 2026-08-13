import type { ManagedRouter9UsageStats } from './router9BridgeClient';

export type Router9ConsumerUsage = {
  consumer: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cost: number;
  lastUsed?: string;
};

/** Aggregate 9Router's per-key/per-model buckets into one row per Tomny/CLI consumer. */
export const usageByConsumer = (stats: ManagedRouter9UsageStats | null): Router9ConsumerUsage[] => {
  const grouped = new Map<string, Router9ConsumerUsage>();
  for (const bucket of Object.values(stats?.byApiKey ?? {})) {
    const consumer = bucket.keyName?.trim() || bucket.apiKeyMasked?.trim() || 'Local (No API Key)';
    const current = grouped.get(consumer) ?? {
      consumer,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cost: 0,
    };
    current.requests += bucket.requests ?? 0;
    current.promptTokens += bucket.promptTokens ?? 0;
    current.completionTokens += bucket.completionTokens ?? 0;
    current.cachedTokens += bucket.cachedTokens ?? 0;
    current.cost += bucket.cost ?? 0;
    if (bucket.lastUsed && (!current.lastUsed || bucket.lastUsed > current.lastUsed))
      current.lastUsed = bucket.lastUsed;
    grouped.set(consumer, current);
  }
  return [...grouped.values()].toSorted(
    (left, right) => right.promptTokens + right.completionTokens - left.promptTokens - left.completionTokens
  );
};
