import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { createHash } from 'node:crypto';

export type ModelReplaySample = Readonly<{
  schemaVersion: 1;
  sampleId: string;
  requestId: string;
  sessionId: string;
  consumerId: string;
  model: string;
  capturedAt: number;
  expiresAt: number;
  input: unknown;
  output: string;
  toolContext?: unknown;
  filterVersion?: string;
}>;

type StoredModelReplaySample = Readonly<ModelReplaySample & { actorDigest: string }>;

export type ModelReplayCodec = Readonly<{
  isAvailable: () => boolean;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
}>;

export type ModelReplayStore = Readonly<{
  initialize: () => Promise<void>;
  configure: (input: { enabled: boolean; ttlMs?: number; maxBytes?: number }) => Promise<void>;
  capture: (input: {
    actorId: string;
    requestId: string;
    sessionId: string;
    consumerId: string;
    model: string;
    capturedAt: number;
    input: unknown;
    output: string;
    toolContext?: unknown;
    filterVersion?: string;
  }) => Promise<string | undefined>;
  preview: (actorId: string) => Promise<{ enabled: boolean; count: number; bytes: number; oldestExpiresAt?: number }>;
  exportSamples: (actorId: string) => Promise<readonly ModelReplaySample[]>;
  delete: (actorId: string, sampleId?: string) => Promise<number>;
  cleanup: (now?: number) => Promise<number>;
}>;

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_ID = 160;
const MAX_MODEL = 200;
const MAX_STRING = 32 * 1024;
const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|secret|token|api[_-]?key)/iu;
const SENSITIVE_TEXT = [
  /\b(?:sk|rk|pk)-[a-z0-9_-]{12,}\b/giu,
  /\bBearer\s+[a-z0-9._~+/-]+=*\b/giu,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/giu,
];
const actorDigest = (value: string): string =>
  createHash('sha256').update(bounded(value, MAX_ID), 'utf8').digest('hex');

const bounded = (value: string, max: number): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /\p{Cc}/u.test(trimmed)) throw new Error('MODEL_REPLAY_INVALID_METADATA');
  return trimmed;
};

const redactText = (value: string): string => {
  const limited = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}[TRUNCATED]` : value;
  return SENSITIVE_TEXT.reduce((result, pattern) => result.replace(pattern, '[REDACTED]'), limited);
};

const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1)])
    );
  }
  return '[UNSUPPORTED]';
};

const clone = <T>(value: T): T => structuredClone(value);
const defaultCodec: ModelReplayCodec = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
  decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
};

const parseSamples = (value: unknown): StoredModelReplaySample[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): StoredModelReplaySample[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Partial<ModelReplaySample> & { actorDigest?: unknown };
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.sampleId !== 'string' ||
      typeof candidate.requestId !== 'string' ||
      typeof candidate.sessionId !== 'string' ||
      typeof candidate.consumerId !== 'string' ||
      typeof candidate.model !== 'string' ||
      !Number.isSafeInteger(candidate.capturedAt) ||
      !Number.isSafeInteger(candidate.expiresAt) ||
      typeof candidate.output !== 'string'
    )
      return [];
    try {
      return [
        {
          schemaVersion: 1,
          actorDigest: bounded(typeof candidate.actorDigest === 'string' ? candidate.actorDigest : '', 64),
          sampleId: bounded(candidate.sampleId, MAX_ID),
          requestId: bounded(candidate.requestId, MAX_ID),
          sessionId: bounded(candidate.sessionId, MAX_ID),
          consumerId: bounded(candidate.consumerId, MAX_ID),
          model: bounded(candidate.model, MAX_MODEL),
          capturedAt: candidate.capturedAt,
          expiresAt: candidate.expiresAt,
          input: redact(candidate.input),
          output: redactText(candidate.output),
          ...(candidate.toolContext === undefined ? {} : { toolContext: redact(candidate.toolContext) }),
          ...(typeof candidate.filterVersion === 'string'
            ? { filterVersion: bounded(candidate.filterVersion, MAX_ID) }
            : {}),
        },
      ];
    } catch {
      return [];
    }
  });
};

const parseStored = (
  value: unknown
): { samples: StoredModelReplaySample[]; enabled?: boolean; ttlMs?: number; maxBytes?: number } => {
  if (Array.isArray(value)) return { samples: parseSamples(value) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MODEL_REPLAY_STORAGE_INVALID');
  const record = value as {
    schemaVersion?: unknown;
    samples?: unknown;
    enabled?: unknown;
    ttlMs?: unknown;
    maxBytes?: unknown;
  };
  if (record.schemaVersion !== 1) throw new Error('MODEL_REPLAY_STORAGE_INVALID');
  if (
    typeof record.enabled !== 'boolean' ||
    !Number.isSafeInteger(record.ttlMs) ||
    (record.ttlMs as number) < 1 ||
    !Number.isSafeInteger(record.maxBytes) ||
    (record.maxBytes as number) < 1
  )
    throw new Error('MODEL_REPLAY_STORAGE_INVALID');
  return {
    samples: parseSamples(record.samples),
    enabled: record.enabled,
    ttlMs: record.ttlMs as number,
    maxBytes: record.maxBytes as number,
  };
};

export const createModelReplayStore = (input: {
  filePath: string;
  codec?: ModelReplayCodec;
  now?: () => number;
}): ModelReplayStore => {
  const codec = input.codec ?? defaultCodec;
  const now = input.now ?? Date.now;
  let enabled = false;
  let ttlMs = DEFAULT_TTL_MS;
  let maxBytes = DEFAULT_MAX_BYTES;
  let samples: StoredModelReplaySample[] = [];
  let initialized = false;

  const persist = async (): Promise<void> => {
    if (!codec.isAvailable()) throw new Error('MODEL_REPLAY_STORAGE_UNAVAILABLE');
    await mkdir(path.dirname(input.filePath), { recursive: true });
    const encrypted = codec.encrypt(JSON.stringify({ schemaVersion: 1, enabled, ttlMs, maxBytes, samples }));
    const temporaryPath = `${input.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600, flush: true });
    await rename(temporaryPath, input.filePath);
  };

  const cleanupExpired = async (at: number): Promise<number> => {
    const before = samples.length;
    samples = samples.filter((sample) => sample.expiresAt > at);
    if (samples.length !== before) await persist();
    return before - samples.length;
  };

  const initialize = async (): Promise<void> => {
    if (initialized) return;
    initialized = true;
    let encrypted: string;
    try {
      encrypted = await readFile(input.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!codec.isAvailable()) throw new Error('MODEL_REPLAY_STORAGE_UNAVAILABLE');
    try {
      const stored = parseStored(JSON.parse(codec.decrypt(encrypted)) as unknown);
      samples = stored.samples.filter((sample) => sample.expiresAt > now());
      if (stored.enabled !== undefined) enabled = stored.enabled;
      if (stored.ttlMs !== undefined) ttlMs = stored.ttlMs;
      if (stored.maxBytes !== undefined) maxBytes = stored.maxBytes;
    } catch {
      throw new Error('MODEL_REPLAY_STORAGE_INVALID');
    }
  };

  return {
    initialize,
    configure: async (configuration) => {
      await initialize();
      if (configuration.ttlMs !== undefined && (!Number.isSafeInteger(configuration.ttlMs) || configuration.ttlMs < 1))
        throw new Error('MODEL_REPLAY_INVALID_TTL');
      if (
        configuration.maxBytes !== undefined &&
        (!Number.isSafeInteger(configuration.maxBytes) || configuration.maxBytes < 1)
      )
        throw new Error('MODEL_REPLAY_INVALID_SIZE');
      enabled = configuration.enabled;
      if (configuration.ttlMs !== undefined) ttlMs = configuration.ttlMs;
      if (configuration.maxBytes !== undefined) maxBytes = configuration.maxBytes;
      await cleanupExpired(now());
      await persist();
    },
    capture: async (captureInput) => {
      await initialize();
      if (!enabled) return undefined;
      if (!Number.isSafeInteger(captureInput.capturedAt) || captureInput.capturedAt < 0)
        throw new Error('MODEL_REPLAY_INVALID_TIMESTAMP');
      const sample: ModelReplaySample = {
        schemaVersion: 1,
        sampleId: `model-replay-${randomUUID()}`,
        requestId: bounded(captureInput.requestId, MAX_ID),
        sessionId: bounded(captureInput.sessionId, MAX_ID),
        consumerId: bounded(captureInput.consumerId, MAX_ID),
        model: bounded(captureInput.model, MAX_MODEL),
        capturedAt: captureInput.capturedAt,
        expiresAt: captureInput.capturedAt + ttlMs,
        input: redact(captureInput.input),
        output: redactText(captureInput.output),
        ...(captureInput.toolContext === undefined ? {} : { toolContext: redact(captureInput.toolContext) }),
        ...(captureInput.filterVersion === undefined
          ? {}
          : { filterVersion: bounded(captureInput.filterVersion, MAX_ID) }),
      };
      const storedSample: StoredModelReplaySample = { ...sample, actorDigest: actorDigest(captureInput.actorId) };
      const candidate = [...samples, storedSample];
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > maxBytes) throw new Error('MODEL_REPLAY_SIZE_LIMIT');
      samples = candidate;
      await persist();
      return sample.sampleId;
    },
    preview: async (actorId) => {
      await initialize();
      const visible = samples.filter((sample) => sample.actorDigest === actorDigest(actorId));
      const bytes = Buffer.byteLength(JSON.stringify(visible), 'utf8');
      return {
        enabled,
        count: visible.length,
        bytes,
        ...(visible.length === 0 ? {} : { oldestExpiresAt: Math.min(...visible.map((sample) => sample.expiresAt)) }),
      };
    },
    exportSamples: async (actorId) => {
      await initialize();
      return samples
        .filter((sample) => sample.actorDigest === actorDigest(actorId))
        .map(({ actorDigest: _actorDigest, ...sample }) => clone(sample));
    },
    delete: async (actorId, sampleId) => {
      await initialize();
      const before = samples.length;
      const digest = actorDigest(actorId);
      samples =
        sampleId === undefined
          ? samples.filter((sample) => sample.actorDigest !== digest)
          : samples.filter((sample) => sample.actorDigest !== digest || sample.sampleId !== bounded(sampleId, MAX_ID));
      if (samples.length !== before) await persist();
      return before - samples.length;
    },
    cleanup: async (at = now()) => {
      await initialize();
      return await cleanupExpired(at);
    },
  };
};
