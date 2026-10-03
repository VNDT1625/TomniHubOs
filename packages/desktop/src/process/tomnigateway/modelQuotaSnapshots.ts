import { createHash } from 'node:crypto';
import type { DurableAgentEvent, DurableEventPayload, DurableEventStore } from '@process/services/agentChat/durability';

import type { TomniGatewayQuotaSnapshot } from './types';

export type ModelQuotaSnapshotRecord = Readonly<TomniGatewayQuotaSnapshot & { actorDigest: string }>;

export type ModelQuotaSnapshotStore = Readonly<{
  initialize: () => Promise<void>;
  save: (input: { actorId: string; snapshot: TomniGatewayQuotaSnapshot }) => Promise<void>;
  latest: (input: {
    actorId: string;
    consumerId: string;
    model?: string;
  }) => Promise<TomniGatewayQuotaSnapshot | undefined>;
}>;

const EVENT = 'model.quota.snapshot';
const MAX_ID = 160;

const bounded = (value: string, max = MAX_ID): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /\p{Cc}/u.test(trimmed)) throw new Error('MODEL_QUOTA_INVALID_METADATA');
  return trimmed;
};

const digest = (value: string): string => createHash('sha256').update(bounded(value), 'utf8').digest('hex');

const nonNegative = (value: unknown): number | undefined =>
  value === undefined
    ? undefined
    : Number.isSafeInteger(value) && (value as number) >= 0
      ? (value as number)
      : undefined;

const asRecord = (event: DurableAgentEvent): Record<string, unknown> | undefined => {
  if (event.kind !== 'custom' || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload))
    return undefined;
  return event.payload as Record<string, unknown>;
};

const parse = (event: DurableAgentEvent): ModelQuotaSnapshotRecord | undefined => {
  const payload = asRecord(event);
  if (payload?.event !== EVENT || typeof payload.actorDigest !== 'string' || typeof payload.consumerId !== 'string')
    return undefined;
  if (!['unknown', 'reported', 'stale'].includes(String(payload.status))) return undefined;
  if (!['unsupported', 'provider', 'cache'].includes(String(payload.source))) return undefined;
  if (!['tokens', 'requests', 'credits'].includes(String(payload.unit))) return undefined;
  const observedAt = nonNegative(payload.observedAt);
  if (observedAt === undefined) return undefined;
  const remaining = nonNegative(payload.remaining);
  const limit = nonNegative(payload.limit);
  const resetAt = nonNegative(payload.resetAt);
  const staleAfter = nonNegative(payload.staleAfter);
  try {
    return {
      actorDigest: bounded(payload.actorDigest, 64),
      consumerId: bounded(payload.consumerId),
      status: payload.status as TomniGatewayQuotaSnapshot['status'],
      source: payload.source as TomniGatewayQuotaSnapshot['source'],
      unit: payload.unit as TomniGatewayQuotaSnapshot['unit'],
      ...(typeof payload.model === 'string' ? { model: bounded(payload.model, 200) } : {}),
      ...(typeof payload.providerId === 'string' ? { providerId: bounded(payload.providerId) } : {}),
      observedAt,
      ...(resetAt === undefined ? {} : { resetAt }),
      ...(staleAfter === undefined ? {} : { staleAfter }),
      ...(remaining === undefined ? {} : { remaining }),
      ...(limit === undefined ? {} : { limit }),
    };
  } catch {
    return undefined;
  }
};

const payload = (record: ModelQuotaSnapshotRecord): DurableEventPayload =>
  ({
    event: EVENT,
    ...record,
  }) as unknown as DurableEventPayload;

export const createModelQuotaSnapshotStore = (store: DurableEventStore): ModelQuotaSnapshotStore => {
  const records = new Map<string, ModelQuotaSnapshotRecord>();
  let initialized = false;
  const initialize = async (): Promise<void> => {
    if (initialized) return;
    await store.initialize();
    for (const event of await store.query({ kinds: ['custom'], limit: 10_000 })) {
      const record = parse(event);
      if (record) {
        const key = `${record.actorDigest}:${record.consumerId}:${record.model ?? ''}`;
        const previous = records.get(key);
        if (!previous || record.observedAt >= previous.observedAt) records.set(key, record);
      }
    }
    initialized = true;
  };
  return {
    initialize,
    save: async ({ actorId, snapshot }) => {
      await initialize();
      const actorDigest = digest(actorId);
      const record: ModelQuotaSnapshotRecord = {
        ...snapshot,
        consumerId: bounded(snapshot.consumerId),
        actorDigest,
        observedAt:
          nonNegative(snapshot.observedAt) ??
          (() => {
            throw new Error('MODEL_QUOTA_INVALID_TIMESTAMP');
          })(),
      };
      if (record.status === 'unknown' && (record.remaining !== undefined || record.limit !== undefined))
        throw new Error('MODEL_QUOTA_INVALID_UNKNOWN_BALANCE');
      const key = `${actorDigest}:${record.consumerId}:${record.model ?? ''}`;
      const previous = records.get(key);
      if (previous && previous.observedAt > record.observedAt) return;
      await store.append({
        sessionId: `model-quota:${record.consumerId}`,
        kind: 'custom',
        visibility: 'private',
        payload: payload(record),
      });
      records.set(key, record);
    },
    latest: async ({ actorId, consumerId, model }) => {
      await initialize();
      const record = records.get(`${digest(actorId)}:${bounded(consumerId)}:${model ?? ''}`);
      if (!record) return undefined;
      const { actorDigest: _actorDigest, ...snapshot } = record;
      return { ...snapshot };
    },
  };
};
