import { createHash } from 'node:crypto';
import type { DurableAgentEvent, DurableEventPayload, DurableEventStore } from '@process/services/agentChat/durability';

export type ModelUsageSource = 'reported' | 'estimated' | 'unavailable';

export type ModelRequestUsage = Readonly<{
  promptCount?: number;
  completionCount?: number;
  totalCount?: number;
  cachedCount?: number;
  reasoningCount?: number;
  source: ModelUsageSource;
}>;

export type ModelRequestStatus = 'started' | 'completed' | 'failed' | 'cancelled';

export type ModelRequestRecord = Readonly<{
  requestId: string;
  sessionId: string;
  consumerId: string;
  actorDigest: string;
  /** Provider catalog identity; never a credential. */
  providerId: string;
  model: string;
  status: Exclude<ModelRequestStatus, 'started'>;
  receiptId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  usage: ModelRequestUsage;
  termination: 'completed' | 'error' | 'cancelled';
  errorCode?: string;
}>;

export type ModelRequestHistory = Readonly<{
  initialize: () => Promise<void>;
  begin: (
    input: Readonly<{
      requestId: string;
      sessionId: string;
      consumerId: string;
      actorId: string;
      model: string;
      startedAt: number;
    }>
  ) => Promise<void>;
  complete: (
    input: Readonly<{
      requestId: string;
      sessionId: string;
      consumerId: string;
      actorId: string;
      model: string;
      providerId?: string;
      status: Exclude<ModelRequestStatus, 'started'>;
      receiptId: string;
      startedAt: number;
      finishedAt: number;
      usage: ModelRequestUsage;
      errorCode?: string;
    }>
  ) => Promise<void>;
  list: (
    query?: Readonly<{
      actorId?: string;
      consumerId?: string;
      sessionId?: string;
      providerId?: string;
      model?: string;
      status?: Exclude<ModelRequestStatus, 'started'>;
      from?: number;
      to?: number;
    }>
  ) => Promise<readonly ModelRequestRecord[]>;
}>;

const EVENT_STARTED = 'model.request.started';
const EVENT_TERMINAL = 'model.request.terminal';
const MAX_ID = 160;
const MAX_MODEL = 200;
const MAX_ERROR = 120;
const MAX_RECORDS = 10_000;

const bounded = (value: string, max: number): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /\p{Cc}/u.test(trimmed)) throw new Error('MODEL_HISTORY_INVALID_METADATA');
  return trimmed;
};

const actorDigest = (actorId: string): string =>
  createHash('sha256').update(bounded(actorId, MAX_ID), 'utf8').digest('hex');

const safeTimestamp = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('MODEL_HISTORY_INVALID_TIMESTAMP');
  return value;
};

const safeCount = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const normalizeUsage = (usage: ModelRequestUsage): ModelRequestUsage => {
  const source = usage.source;
  if (!['reported', 'estimated', 'unavailable'].includes(source)) throw new Error('MODEL_HISTORY_INVALID_USAGE');
  const promptCount = safeCount(usage.promptCount);
  const completionCount = safeCount(usage.completionCount);
  const totalCount = safeCount(usage.totalCount);
  const cachedCount = safeCount(usage.cachedCount);
  const reasoningCount = safeCount(usage.reasoningCount);
  if (
    source === 'unavailable' &&
    (promptCount !== undefined ||
      completionCount !== undefined ||
      totalCount !== undefined ||
      cachedCount !== undefined ||
      reasoningCount !== undefined)
  ) {
    throw new Error('MODEL_HISTORY_INVALID_USAGE');
  }
  return {
    source,
    ...(promptCount === undefined ? {} : { promptCount }),
    ...(completionCount === undefined ? {} : { completionCount }),
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(cachedCount === undefined ? {} : { cachedCount }),
    ...(reasoningCount === undefined ? {} : { reasoningCount }),
  };
};

const asRecord = (event: DurableAgentEvent): Record<string, unknown> | undefined => {
  if (event.kind !== 'custom' || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload))
    return undefined;
  return event.payload as Record<string, unknown>;
};

const parseUsage = (value: unknown): ModelRequestUsage | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  if (typeof usage.source !== 'string') return undefined;
  return normalizeUsage({
    source: usage.source as ModelUsageSource,
    ...(typeof usage.promptCount === 'number' ? { promptCount: usage.promptCount } : {}),
    ...(typeof usage.completionCount === 'number' ? { completionCount: usage.completionCount } : {}),
    ...(typeof usage.totalCount === 'number' ? { totalCount: usage.totalCount } : {}),
    ...(typeof usage.cachedCount === 'number' ? { cachedCount: usage.cachedCount } : {}),
    ...(typeof usage.reasoningCount === 'number' ? { reasoningCount: usage.reasoningCount } : {}),
  });
};

const parseRecord = (event: DurableAgentEvent): ModelRequestRecord | undefined => {
  const payload = asRecord(event);
  if (payload?.event !== EVENT_TERMINAL) return undefined;
  const required = [
    'requestId',
    'sessionId',
    'consumerId',
    'actorDigest',

    'model',
    'status',
    'receiptId',
    'startedAt',
    'finishedAt',
    'durationMs',
    'termination',
  ];
  if (
    required.some((key) => typeof payload[key] !== 'string' && !['startedAt', 'finishedAt', 'durationMs'].includes(key))
  )
    return undefined;
  if (!['completed', 'failed', 'cancelled'].includes(payload.status as string)) return undefined;
  if (!['completed', 'error', 'cancelled'].includes(payload.termination as string)) return undefined;
  const usage = parseUsage(payload.usage);
  if (
    !usage ||
    typeof payload.startedAt !== 'number' ||
    typeof payload.finishedAt !== 'number' ||
    typeof payload.durationMs !== 'number'
  )
    return undefined;
  try {
    return {
      requestId: bounded(payload.requestId as string, MAX_ID),
      sessionId: bounded(payload.sessionId as string, MAX_ID),
      consumerId: bounded(payload.consumerId as string, MAX_ID),
      actorDigest: bounded(payload.actorDigest as string, 64),
      providerId: bounded(typeof payload.providerId === 'string' ? payload.providerId : 'unknown-provider', MAX_ID),
      status: payload.status as ModelRequestRecord['status'],
      model: bounded(payload.model as string, MAX_MODEL),
      receiptId: bounded(payload.receiptId as string, MAX_ID),
      startedAt: safeTimestamp(payload.startedAt),
      finishedAt: safeTimestamp(payload.finishedAt),
      durationMs: safeTimestamp(payload.durationMs),
      usage,
      termination: payload.termination as ModelRequestRecord['termination'],
      ...(typeof payload.errorCode === 'string' ? { errorCode: bounded(payload.errorCode, MAX_ERROR) } : {}),
    };
  } catch {
    return undefined;
  }
};

const toPayload = (event: string, input: Record<string, unknown>): DurableEventPayload =>
  ({ event, ...input }) as unknown as DurableEventPayload;

export const createModelRequestHistory = (store: DurableEventStore): ModelRequestHistory => {
  const starts = new Set<string>();
  const terminals = new Map<string, ModelRequestRecord>();
  let initialized = false;
  const initialize = async (): Promise<void> => {
    if (initialized) return;
    await store.initialize();
    const events = await store.query({ kinds: ['custom'], limit: MAX_RECORDS });
    for (const event of events) {
      const payload = asRecord(event);
      if (payload?.event === EVENT_STARTED && typeof payload.requestId === 'string') starts.add(payload.requestId);
      const record = parseRecord(event);
      if (record) terminals.set(record.requestId, record);
    }
    initialized = true;
  };
  return {
    initialize,
    begin: async (input) => {
      await initialize();
      const requestId = bounded(input.requestId, MAX_ID);
      if (starts.has(requestId) || terminals.has(requestId)) return;
      const eventPayload = toPayload(EVENT_STARTED, {
        requestId,
        sessionId: bounded(input.sessionId, MAX_ID),
        consumerId: bounded(input.consumerId, MAX_ID),
        actorDigest: actorDigest(input.actorId),
        model: bounded(input.model, MAX_MODEL),
        startedAt: safeTimestamp(input.startedAt),
      });
      await store.append({
        sessionId: bounded(input.sessionId, MAX_ID),
        requestId,
        kind: 'custom',
        visibility: 'private',
        payload: eventPayload,
      });
      starts.add(requestId);
    },
    complete: async (input) => {
      await initialize();
      const requestId = bounded(input.requestId, MAX_ID);
      if (terminals.has(requestId)) return;
      const startedAt = safeTimestamp(input.startedAt);
      const finishedAt = safeTimestamp(input.finishedAt);
      if (finishedAt < startedAt) throw new Error('MODEL_HISTORY_INVALID_TIMESTAMP');
      const status = input.status;
      const termination = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'error';
      const record: ModelRequestRecord = {
        requestId,
        sessionId: bounded(input.sessionId, MAX_ID),
        consumerId: bounded(input.consumerId, MAX_ID),
        actorDigest: actorDigest(input.actorId),
        model: bounded(input.model, MAX_MODEL),
        providerId: bounded(input.providerId ?? 'unknown-provider', MAX_ID),
        status,
        receiptId: bounded(input.receiptId, MAX_ID),
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        usage: normalizeUsage(input.usage),
        termination,
        ...(input.errorCode === undefined ? {} : { errorCode: bounded(input.errorCode, MAX_ERROR) }),
      };
      await store.append({
        sessionId: record.sessionId,
        requestId,
        kind: 'custom',
        visibility: 'private',
        payload: toPayload(EVENT_TERMINAL, record as unknown as Record<string, unknown>),
      });
      terminals.set(requestId, record);
    },
    list: async (query = {}) => {
      await initialize();
      const expectedActor = query.actorId === undefined ? undefined : actorDigest(query.actorId);
      return [...terminals.values()]
        .filter(
          (record) =>
            (expectedActor === undefined || record.actorDigest === expectedActor) &&
            (query.consumerId === undefined || record.consumerId === query.consumerId) &&
            (query.sessionId === undefined || record.sessionId === query.sessionId) &&
            (query.model === undefined || record.model === query.model) &&
            (query.providerId === undefined || record.providerId === query.providerId) &&
            (query.from === undefined || record.finishedAt >= query.from) &&
            (query.to === undefined || record.finishedAt <= query.to)
        )
        .map((record) => Object.assign({}, record, { usage: Object.assign({}, record.usage) }));
    },
  };
};
