import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';

import type { Dirent } from 'node:fs';
import { dirname, join } from 'node:path';

import type { PackageIdentity } from '@/common/packages';

const STORE_VERSION = 1 as const;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_PROGRESS_EVENTS = 128;
const MAX_REFERENCE_COUNT = 64;
const MAX_RECORD_BYTES = 64 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/;
const INTEGRITY = /^sha256-[a-f0-9]{64}$/;

export type SurfaceAiObservationErrorCode =
  | 'SURFACE_AI_OBSERVATION_ROOT_INVALID'
  | 'SURFACE_AI_OBSERVATION_INPUT_INVALID'
  | 'SURFACE_AI_OBSERVATION_ALREADY_EXISTS'
  | 'SURFACE_AI_OBSERVATION_REPLAY'
  | 'SURFACE_AI_OBSERVATION_TERMINAL'
  | 'SURFACE_AI_OBSERVATION_CORRUPT'
  | 'SURFACE_AI_OBSERVATION_UNAVAILABLE';

export class SurfaceAiObservationError extends Error {
  public constructor(readonly code: SurfaceAiObservationErrorCode) {
    super(code);
    this.name = 'SurfaceAiObservationError';
  }
}

/**
 * Deliberately excludes an instruction, lease, secret, runtime owner, and raw
 * package output. A bounded account identifier is persisted solely to bind a
 * terminal recovery query to its authenticated owner; it cannot reconstruct
 * sensitive invocation inputs.
 */
export type SurfaceAiObservationIdentity = Readonly<{
  accountId: string;
  runId: string;
  invocationId: string;
  operationId: string;
  surface: PackageIdentity;
  artifactIntegrity: string;
}>;

export type SurfaceAiProgressObservation = Readonly<{
  sequence: number;
  phase: string;
  completed: number;
  total: number;
  observedAt: number;
}>;

export type SurfaceAiArtifactObservation = Readonly<{
  sequence: number;
  artifactRefs: readonly string[];
  evidenceRefs: readonly string[];
  observedAt: number;
}>;

/** A restart is never permission to replay a package operation. */
export type SurfaceAiCancellationObservation = Readonly<{
  sequence: number;
  reason: 'restart-recovery';
  observedAt: number;
}>;

export type SurfaceAiObservationSnapshot = Readonly<{
  kind: 'surface-ai-observation.v1';
  version: typeof STORE_VERSION;
  observationKey: string;
  identity: SurfaceAiObservationIdentity;
  state: 'active' | 'completed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  lastSequence: number;
  progress: readonly SurfaceAiProgressObservation[];
  result?: SurfaceAiArtifactObservation;
  cancellation?: SurfaceAiCancellationObservation;
}>;

export type SurfaceAiObservationStore = Readonly<{
  open: (identity: SurfaceAiObservationIdentity) => Promise<SurfaceAiObservationSnapshot>;
  recordProgress: (
    identity: SurfaceAiObservationIdentity,
    progress: Readonly<{ sequence: number; phase: string; completed: number; total: number }>
  ) => Promise<SurfaceAiObservationSnapshot>;
  recordResult: (
    identity: SurfaceAiObservationIdentity,
    result: Readonly<{ sequence: number; artifactRefs: readonly string[]; evidenceRefs: readonly string[] }>
  ) => Promise<SurfaceAiObservationSnapshot>;
  read: (identity: SurfaceAiObservationIdentity) => Promise<SurfaceAiObservationSnapshot | undefined>;
  /** Redacted active records only; intended exclusively for Main restart recovery. */
  listActive: () => Promise<readonly SurfaceAiObservationSnapshot[]>;
  /** Main-only terminal recovery query, scoped to one authenticated account. */
  listRestartCancelledForAccount: (accountId: string) => Promise<readonly SurfaceAiObservationSnapshot[]>;
  /** Terminalizes an orphaned record without resuming its package operation. */
  cancelForRestart: (identity: SurfaceAiObservationIdentity) => Promise<SurfaceAiObservationSnapshot | undefined>;
}>;

export type SurfaceAiObservationStoreOptions = Readonly<{
  /** Main-owned directory, normally under userData. It is never renderer-controlled. */
  rootPath: string;
  now?: () => number;
}>;

const error = (code: SurfaceAiObservationErrorCode): SurfaceAiObservationError => new SurfaceAiObservationError(code);

const requireIdentifier = (value: unknown): string => {
  if (typeof value !== 'string') throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');
  const normalized = value.trim();
  if (normalized.length > MAX_IDENTIFIER_LENGTH || !IDENTIFIER.test(normalized)) {
    throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');
  }
  return normalized;
};

const requireTimestamp = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
  }
  return value;
};

const requireSequence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');
  }
  return value;
};

const requireReferenceList = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_COUNT) {
    throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');
  }
  const references = value.map(requireIdentifier);
  if (new Set(references).size !== references.length) throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');
  return Object.freeze(references);
};

const normalizeIdentity = (value: SurfaceAiObservationIdentity): SurfaceAiObservationIdentity => {
  const packageId = requireIdentifier(value.surface?.packageId);
  const packageVersion = requireIdentifier(value.surface?.packageVersion);
  const publisherId = requireIdentifier(value.surface?.publisherId);
  const artifactIntegrity = typeof value.artifactIntegrity === 'string' ? value.artifactIntegrity : '';
  if (!INTEGRITY.test(artifactIntegrity)) throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');

  return Object.freeze({
    accountId: requireIdentifier(value.accountId),
    runId: requireIdentifier(value.runId),
    invocationId: requireIdentifier(value.invocationId),
    operationId: requireIdentifier(value.operationId),
    surface: Object.freeze({ packageId, packageVersion, publisherId }),
    artifactIntegrity,
  });
};

const observationKeyFor = (identity: SurfaceAiObservationIdentity): string =>
  `sha256-${createHash('sha256')
    .update(
      [
        identity.accountId,
        identity.runId,
        identity.invocationId,
        identity.operationId,
        identity.surface.packageId,
        identity.surface.packageVersion,
        identity.surface.publisherId,
        identity.artifactIntegrity,
      ].join('\u0000')
    )
    .digest('hex')}`;

const sameIdentity = (left: SurfaceAiObservationIdentity, right: SurfaceAiObservationIdentity): boolean =>
  left.accountId === right.accountId &&
  left.runId === right.runId &&
  left.invocationId === right.invocationId &&
  left.operationId === right.operationId &&
  left.surface.packageId === right.surface.packageId &&
  left.surface.packageVersion === right.surface.packageVersion &&
  left.surface.publisherId === right.surface.publisherId &&
  left.artifactIntegrity === right.artifactIntegrity;

const cloneSnapshot = (snapshot: SurfaceAiObservationSnapshot): SurfaceAiObservationSnapshot =>
  Object.freeze({
    ...snapshot,
    identity: Object.freeze({
      ...snapshot.identity,
      surface: Object.freeze({ ...snapshot.identity.surface }),
    }),
    progress: Object.freeze(snapshot.progress.map((progress) => Object.freeze({ ...progress }))),
    ...(snapshot.result === undefined
      ? {}
      : {
          result: Object.freeze({
            ...snapshot.result,
            artifactRefs: Object.freeze([...snapshot.result.artifactRefs]),
            evidenceRefs: Object.freeze([...snapshot.result.evidenceRefs]),
          }),
        }),
    ...(snapshot.cancellation === undefined ? {} : { cancellation: Object.freeze({ ...snapshot.cancellation }) }),
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const corrupt = (): never => {
  throw error('SURFACE_AI_OBSERVATION_CORRUPT');
};

const parseSnapshot = (value: unknown): SurfaceAiObservationSnapshot => {
  if (!isRecord(value) || value.kind !== 'surface-ai-observation.v1' || value.version !== STORE_VERSION) corrupt();

  try {
    const raw = value as Record<string, unknown>;
    const identity = normalizeIdentity(raw.identity as SurfaceAiObservationIdentity);
    const observationKey = requireIdentifier(raw.observationKey);
    if (observationKey !== observationKeyFor(identity)) corrupt();
    const state: SurfaceAiObservationSnapshot['state'] =
      raw.state === 'active' || raw.state === 'completed' || raw.state === 'cancelled' ? raw.state : corrupt();
    const createdAt = requireTimestamp(raw.createdAt);
    const rawProgress = raw.progress;
    if (!Array.isArray(rawProgress) || rawProgress.length > MAX_PROGRESS_EVENTS) corrupt();
    const progress = rawProgress as readonly unknown[];

    let expectedSequence = 1;
    let previousTimestamp = createdAt;
    const parsedProgress: SurfaceAiProgressObservation[] = progress.map((entry: unknown) => {
      if (!isRecord(entry)) corrupt();
      const rawEntry = entry as Record<string, unknown>;
      const sequence = requireSequence(rawEntry.sequence);
      const phase = requireIdentifier(rawEntry.phase);
      const completed = requireTimestamp(rawEntry.completed);
      const total = requireTimestamp(rawEntry.total);
      const observedAt = requireTimestamp(rawEntry.observedAt);
      if (sequence !== expectedSequence++ || completed > total || observedAt < previousTimestamp) corrupt();
      previousTimestamp = observedAt;
      return Object.freeze({ sequence, phase, completed, total, observedAt });
    });

    let result: SurfaceAiArtifactObservation | undefined;
    const rawResult = raw.result;
    if (rawResult !== undefined) {
      if (!isRecord(rawResult)) corrupt();
      const resultRecord = rawResult as Record<string, unknown>;
      const sequence = requireSequence(resultRecord.sequence);
      const observedAt = requireTimestamp(resultRecord.observedAt);
      if (sequence !== expectedSequence || observedAt < previousTimestamp) corrupt();
      result = Object.freeze({
        sequence,
        artifactRefs: requireReferenceList(resultRecord.artifactRefs),
        evidenceRefs: requireReferenceList(resultRecord.evidenceRefs),
        observedAt,
      });
      previousTimestamp = observedAt;
    }
    let cancellation: SurfaceAiCancellationObservation | undefined;
    const rawCancellation = raw.cancellation;
    if (rawCancellation !== undefined) {
      if (!isRecord(rawCancellation) || result !== undefined) corrupt();
      const cancellationRecord = rawCancellation as Record<string, unknown>;
      const sequence = requireSequence(cancellationRecord.sequence);
      const observedAt = requireTimestamp(cancellationRecord.observedAt);
      if (
        sequence !== expectedSequence ||
        cancellationRecord.reason !== 'restart-recovery' ||
        observedAt < previousTimestamp
      ) {
        corrupt();
      }
      cancellation = Object.freeze({ sequence, reason: 'restart-recovery', observedAt });
      previousTimestamp = observedAt;
    }
    const lastSequence = typeof raw.lastSequence === 'number' ? raw.lastSequence : Number.NaN;
    const expectedLastSequence = result?.sequence ?? cancellation?.sequence ?? parsedProgress.at(-1)?.sequence ?? 0;
    if (
      lastSequence !== expectedLastSequence ||
      (state === 'completed') !== (result !== undefined) ||
      (state === 'cancelled') !== (cancellation !== undefined) ||
      (state === 'active' && (result !== undefined || cancellation !== undefined))
    ) {
      corrupt();
    }
    const updatedAt = requireTimestamp(raw.updatedAt);
    if (updatedAt < previousTimestamp) corrupt();

    return Object.freeze({
      kind: 'surface-ai-observation.v1',
      version: STORE_VERSION,
      observationKey,
      identity,
      state,
      createdAt,
      updatedAt,
      lastSequence,
      progress: Object.freeze(parsedProgress),
      ...(result === undefined ? {} : { result }),
      ...(cancellation === undefined ? {} : { cancellation }),
    });
  } catch (caught) {
    if (caught instanceof SurfaceAiObservationError && caught.code === 'SURFACE_AI_OBSERVATION_CORRUPT') throw caught;
    corrupt();
  }
};

const serializeSnapshot = (snapshot: SurfaceAiObservationSnapshot): string => {
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
  return `${serialized}\n`;
};

/**
 * Main-only durable C4 observation store. It persists solely bounded progress
 * and opaque artifact/evidence identifiers. Strict monotonically increasing
 * sequences make retries and stale package messages fail closed after restart.
 */
export const createSurfaceAiObservationStore = (
  options: SurfaceAiObservationStoreOptions
): SurfaceAiObservationStore => {
  const rootPath = options.rootPath.trim();
  if (!rootPath) throw error('SURFACE_AI_OBSERVATION_ROOT_INVALID');
  const now = options.now ?? Date.now;
  let queue: Promise<void> = Promise.resolve();

  const pathFor = (identity: SurfaceAiObservationIdentity): string =>
    join(rootPath, `${observationKeyFor(identity)}.json`);

  const serial = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.then(
      (): void => undefined,
      (): void => undefined
    );
    return await next;
  };

  const load = async (identity: SurfaceAiObservationIdentity): Promise<SurfaceAiObservationSnapshot | undefined> => {
    try {
      const content = await readFile(pathFor(identity), 'utf8');
      const parsed = parseSnapshot(JSON.parse(content) as unknown);
      if (!sameIdentity(parsed.identity, identity)) corrupt();
      return parsed;
    } catch (caught) {
      if (
        caught &&
        typeof caught === 'object' &&
        'code' in caught &&
        (caught as { code?: unknown }).code === 'ENOENT'
      ) {
        return undefined;
      }
      if (caught instanceof SurfaceAiObservationError) throw caught;
      throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
    }
  };

  const persist = async (snapshot: SurfaceAiObservationSnapshot): Promise<SurfaceAiObservationSnapshot> => {
    const filePath = pathFor(snapshot.identity);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(temporaryPath, serializeSnapshot(snapshot), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, filePath);
      return cloneSnapshot(snapshot);
    } catch {
      throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
    }
  };

  const observedAt = (previous: number): number => Math.max(previous, requireTimestamp(now()));

  const listActive = async (): Promise<readonly SurfaceAiObservationSnapshot[]> =>
    await serial(async () => {
      let entries: readonly Dirent[];
      try {
        entries = await readdir(rootPath, { withFileTypes: true });
      } catch (caught) {
        if (
          caught &&
          typeof caught === 'object' &&
          'code' in caught &&
          (caught as { code?: unknown }).code === 'ENOENT'
        ) {
          return Object.freeze([]);
        }
        throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
      }

      const active: SurfaceAiObservationSnapshot[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const filePath = join(rootPath, entry.name);
          const snapshot = parseSnapshot(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
          if (filePath !== pathFor(snapshot.identity)) corrupt();
          if (snapshot.state === 'active') active.push(cloneSnapshot(snapshot));
        } catch (caught) {
          if (caught instanceof SurfaceAiObservationError) throw caught;
          throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
        }
      }
      return Object.freeze(active.sort((left, right) => left.observationKey.localeCompare(right.observationKey)));
    });

  const listRestartCancelledForAccount = async (
    rawAccountId: string
  ): Promise<readonly SurfaceAiObservationSnapshot[]> => {
    const accountId = requireIdentifier(rawAccountId);
    return await serial(async () => {
      let entries: readonly Dirent[];
      try {
        entries = await readdir(rootPath, { withFileTypes: true });
      } catch (caught) {
        if (
          caught &&
          typeof caught === 'object' &&
          'code' in caught &&
          (caught as { code?: unknown }).code === 'ENOENT'
        ) {
          return Object.freeze([]);
        }
        throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
      }

      const recovered: SurfaceAiObservationSnapshot[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
          const filePath = join(rootPath, entry.name);
          const snapshot = parseSnapshot(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
          if (filePath !== pathFor(snapshot.identity)) corrupt();
          if (
            snapshot.identity.accountId === accountId &&
            snapshot.state === 'cancelled' &&
            snapshot.cancellation?.reason === 'restart-recovery'
          ) {
            recovered.push(cloneSnapshot(snapshot));
          }
        } catch (caught) {
          if (caught instanceof SurfaceAiObservationError) throw caught;
          throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
        }
      }
      return Object.freeze(recovered.sort((left, right) => left.observationKey.localeCompare(right.observationKey)));
    });
  };

  return Object.freeze({
    open: async (rawIdentity) =>
      await serial(async () => {
        const identity = normalizeIdentity(rawIdentity);
        if ((await load(identity)) !== undefined) throw error('SURFACE_AI_OBSERVATION_ALREADY_EXISTS');
        const timestamp = observedAt(0);
        return await persist(
          Object.freeze({
            kind: 'surface-ai-observation.v1',
            version: STORE_VERSION,
            observationKey: observationKeyFor(identity),
            identity,
            state: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
            lastSequence: 0,
            progress: Object.freeze([]),
          })
        );
      }),
    recordProgress: async (rawIdentity, input) =>
      await serial(async () => {
        const identity = normalizeIdentity(rawIdentity);
        const snapshot = await load(identity);
        if (snapshot === undefined) throw error('SURFACE_AI_OBSERVATION_REPLAY');
        if (snapshot.state !== 'active') throw error('SURFACE_AI_OBSERVATION_TERMINAL');
        const sequence = requireSequence(input.sequence);
        if (sequence !== snapshot.lastSequence + 1) throw error('SURFACE_AI_OBSERVATION_REPLAY');
        if (snapshot.progress.length >= MAX_PROGRESS_EVENTS) throw error('SURFACE_AI_OBSERVATION_UNAVAILABLE');
        const completed = requireTimestamp(input.completed);
        const total = requireTimestamp(input.total);
        if (completed > total) throw error('SURFACE_AI_OBSERVATION_INPUT_INVALID');
        const timestamp = observedAt(snapshot.updatedAt);
        const progress = Object.freeze([
          ...snapshot.progress,
          Object.freeze({ sequence, phase: requireIdentifier(input.phase), completed, total, observedAt: timestamp }),
        ]);
        return await persist(Object.freeze({ ...snapshot, updatedAt: timestamp, lastSequence: sequence, progress }));
      }),
    recordResult: async (rawIdentity, input) =>
      await serial(async () => {
        const identity = normalizeIdentity(rawIdentity);
        const snapshot = await load(identity);
        if (snapshot === undefined) throw error('SURFACE_AI_OBSERVATION_REPLAY');
        if (snapshot.state !== 'active') throw error('SURFACE_AI_OBSERVATION_TERMINAL');
        const sequence = requireSequence(input.sequence);
        if (sequence !== snapshot.lastSequence + 1) throw error('SURFACE_AI_OBSERVATION_REPLAY');
        const timestamp = observedAt(snapshot.updatedAt);
        const result = Object.freeze({
          sequence,
          artifactRefs: requireReferenceList(input.artifactRefs),
          evidenceRefs: requireReferenceList(input.evidenceRefs),
          observedAt: timestamp,
        });
        return await persist(
          Object.freeze({ ...snapshot, state: 'completed', updatedAt: timestamp, lastSequence: sequence, result })
        );
      }),
    read: async (rawIdentity) =>
      await serial(async () => {
        const identity = normalizeIdentity(rawIdentity);
        const snapshot = await load(identity);
        return snapshot === undefined ? undefined : cloneSnapshot(snapshot);
      }),
    listActive,
    listRestartCancelledForAccount,
    cancelForRestart: async (rawIdentity) =>
      await serial(async () => {
        const identity = normalizeIdentity(rawIdentity);
        const snapshot = await load(identity);
        if (snapshot === undefined || snapshot.state !== 'active') return undefined;
        const timestamp = observedAt(snapshot.updatedAt);
        const cancellation = Object.freeze({
          sequence: snapshot.lastSequence + 1,
          reason: 'restart-recovery' as const,
          observedAt: timestamp,
        });
        return await persist(
          Object.freeze({
            ...snapshot,
            state: 'cancelled' as const,
            updatedAt: timestamp,
            lastSequence: cancellation.sequence,
            cancellation,
          })
        );
      }),
  });
};
