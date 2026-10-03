/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const INDEX_FILE_NAME = 'publisher-artifact-staging.v1.json';
const ARTIFACT_DIRECTORY_NAME = 'artifacts';
const UPLOAD_DIRECTORY_NAME = 'uploads';
const UPLOAD_SESSION_INDEX_FILE_NAME = 'publisher-artifact-upload-sessions.v1.json';
const DISCARD_JOURNAL_FILE_NAME = 'publisher-artifact-discard.v1.json';
const DEFAULT_MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_STREAMED_ARTIFACT_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_SESSION_INACTIVITY_MS = 15 * 60 * 1000;
const UPLOAD_SESSION_MAX_LIFETIME_MS = 60 * 60 * 1000;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MIN_INDEX_BYTES = 1_024;
const MAX_ARTIFACTS = 10_000;
const MAX_UPLOAD_SESSIONS = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const SHA256_FINGERPRINT = /^sha256-[a-f0-9]{64}$/;

export type PublisherArtifactStageInput = Readonly<{
  publisherId: string;
  subjectId: string;
  artifactId: string;
  bytes: Uint8Array;
  idempotencyKey: string;
}>;

export type PublisherArtifactReadInput = Readonly<{
  publisherId: string;
  subjectId: string;
  artifactId: string;
}>;

/** Main-owned request to begin a bounded local byte stream. */
export type PublisherArtifactUploadSessionInput = Readonly<{
  publisherId: string;
  subjectId: string;
  artifactId: string;
  idempotencyKey: string;
  declaredByteLength: number;
}>;

export type PublisherArtifactUploadChunkInput = Readonly<{
  publisherId: string;
  subjectId: string;
  sessionId: string;
  offset: number;
  bytes: Uint8Array;
  chunkFingerprint: string;
}>;

export type PublisherArtifactUploadSealInput = Readonly<{
  publisherId: string;
  subjectId: string;
  sessionId: string;
  artifactFingerprint: string;
}>;

export type PublisherArtifactUploadCancelInput = Readonly<{
  publisherId: string;
  subjectId: string;
  sessionId: string;
}>;

/**
 * Main-only cleanup request for a stream that was sealed but never became a
 * durable submission. The raw archive fingerprint prevents an ID-only delete.
 */
export type PublisherArtifactDiscardSealedInput = Readonly<{
  publisherId: string;
  subjectId: string;
  artifactId: string;
  artifactFingerprint: string;
  reason: 'verification-failed' | 'submission-creation-failed';
}>;

export type StagedPublisherArtifact = Readonly<{
  schemaVersion: 1;
  publisherId: string;
  subjectId: string;
  artifactId: string;
  idempotencyKey: string;
  artifactFingerprint: string;
  byteLength: number;
}>;

export type PublisherArtifactUploadSession = Readonly<{
  schemaVersion: 1;
  sessionId: string;
  publisherId: string;
  subjectId: string;
  artifactId: string;
  idempotencyKey: string;
  declaredByteLength: number;
  receivedByteLength: number;
  expiresAt: number;
  state: 'active' | 'sealed';
  artifactFingerprint: string | null;
}>;

export type PublisherArtifactStagingStoreOptions = Readonly<{
  /** Absolute Main-owned directory. No artifact path or URL is ever caller supplied. */
  rootDir: string;
  maxArtifactBytes?: number;
  maxIndexBytes?: number;
  /** Main-only time source used by deterministic recovery tests. */
  now?: () => number;
  /**
   * Main-owned durable-submission lookup. Cleanup is unavailable without this
   * dependency so a caller cannot discard an artifact that may be reviewable.
   */
  isArtifactReferenced?: (artifact: StagedPublisherArtifact) => boolean | Promise<boolean>;
}>;

export type PublisherArtifactStagingStoreErrorCode =
  | 'PUBLISHER_ARTIFACT_STAGING_INVALID'
  | 'PUBLISHER_ARTIFACT_STAGING_CONFLICT'
  | 'PUBLISHER_ARTIFACT_STAGING_CORRUPT'
  | 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND'
  | 'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE';

/** Stable Main-process errors; never expose a local filename or operating-system error. */
export class PublisherArtifactStagingStoreError extends Error {
  public constructor(
    public readonly code: PublisherArtifactStagingStoreErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PublisherArtifactStagingStoreError';
  }
}

type ArtifactDocument = Readonly<{
  schemaVersion: 1;
  artifacts: StagedPublisherArtifact[];
  digest: string;
}>;

type UploadSessionDocument = Readonly<{
  schemaVersion: 1;
  sessions: UploadSessionRecord[];
  digest: string;
}>;

type UploadSessionRecord = Readonly<{
  schemaVersion: 1;
  sessionId: string;
  publisherId: string;
  subjectId: string;
  artifactId: string;
  idempotencyKey: string;
  declaredByteLength: number;
  receivedByteLength: number;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  maxExpiresAt: number;
  state: 'active' | 'sealed';
  artifactFingerprint: string | null;
}>;

type DiscardJournal = Readonly<{
  schemaVersion: 1;
  artifact: StagedPublisherArtifact;
  removeBlob: boolean;
  digest: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

const digest = (value: unknown): string => `sha256-${createHash('sha256').update(canonicalize(value)).digest('hex')}`;

const artifactFingerprint = (bytes: Uint8Array): string => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;

const assertExactKeys = (value: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new PublisherArtifactStagingStoreError('PUBLISHER_ARTIFACT_STAGING_INVALID', `${label} is invalid.`);
  }
  return value;
};

const assertIdentifier = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new PublisherArtifactStagingStoreError('PUBLISHER_ARTIFACT_STAGING_INVALID', `${label} is invalid.`);
  }
  return value;
};

const assertBoundedPositiveInteger = (value: unknown, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1 || value > maximum) {
    throw new PublisherArtifactStagingStoreError('PUBLISHER_ARTIFACT_STAGING_INVALID', `${label} is invalid.`);
  }
  return value;
};

const documentPayload = (artifacts: readonly StagedPublisherArtifact[]) => ({ schemaVersion: 1 as const, artifacts });

const parseStoredArtifact = (value: unknown, maxArtifactBytes: number): StagedPublisherArtifact => {
  const candidate = assertExactKeys(
    value,
    ['schemaVersion', 'publisherId', 'subjectId', 'artifactId', 'idempotencyKey', 'artifactFingerprint', 'byteLength'],
    'Staged artifact record'
  );
  if (candidate.schemaVersion !== 1) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Staged artifact schema is invalid.'
    );
  }
  const publisherId = assertIdentifier(candidate.publisherId, 'Staged artifact publisher id');
  const subjectId = assertIdentifier(candidate.subjectId, 'Staged artifact subject id');
  const artifactId = assertIdentifier(candidate.artifactId, 'Staged artifact id');
  const idempotencyKey = assertIdentifier(candidate.idempotencyKey, 'Staged artifact idempotency key');
  if (typeof candidate.artifactFingerprint !== 'string' || !SHA256_FINGERPRINT.test(candidate.artifactFingerprint)) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Staged artifact fingerprint is invalid.'
    );
  }
  const byteLength = assertBoundedPositiveInteger(
    candidate.byteLength,
    maxArtifactBytes,
    'Staged artifact byte length'
  );
  return {
    schemaVersion: 1,
    publisherId,
    subjectId,
    artifactId,
    idempotencyKey,
    artifactFingerprint: candidate.artifactFingerprint,
    byteLength,
  };
};

const parseDocument = (value: unknown, maxArtifactBytes: number): ArtifactDocument => {
  const candidate = assertExactKeys(value, ['schemaVersion', 'artifacts', 'digest'], 'Staged artifact index');
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.artifacts) || typeof candidate.digest !== 'string') {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Staged artifact index is invalid.'
    );
  }
  if (candidate.artifacts.length > MAX_ARTIFACTS) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Staged artifact index exceeds its record limit.'
    );
  }
  const artifacts = candidate.artifacts.map((artifact) => parseStoredArtifact(artifact, maxArtifactBytes));
  const artifactIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const artifact of artifacts) {
    if (artifactIds.has(artifact.artifactId) || idempotencyKeys.has(artifact.idempotencyKey)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Staged artifact index contains duplicate immutable identities.'
      );
    }
    artifactIds.add(artifact.artifactId);
    idempotencyKeys.add(artifact.idempotencyKey);
  }
  if (!SHA256_FINGERPRINT.test(candidate.digest) || candidate.digest !== digest(documentPayload(artifacts))) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Staged artifact index digest is invalid.'
    );
  }
  return { schemaVersion: 1, artifacts, digest: candidate.digest };
};

const discardJournalPayload = (artifact: StagedPublisherArtifact, removeBlob: boolean) => ({
  schemaVersion: 1 as const,
  artifact,
  removeBlob,
});

const parseDiscardJournal = (value: unknown, maxArtifactBytes: number): DiscardJournal => {
  const candidate = assertExactKeys(value, ['schemaVersion', 'artifact', 'removeBlob', 'digest'], 'Discard journal');
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.removeBlob !== 'boolean' ||
    typeof candidate.digest !== 'string'
  ) {
    throw new PublisherArtifactStagingStoreError('PUBLISHER_ARTIFACT_STAGING_CORRUPT', 'Discard journal is invalid.');
  }
  const artifact = parseStoredArtifact(candidate.artifact, maxArtifactBytes);
  if (
    !SHA256_FINGERPRINT.test(candidate.digest) ||
    candidate.digest !== digest(discardJournalPayload(artifact, candidate.removeBlob))
  ) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
      'Discard journal evidence is invalid.'
    );
  }
  return { schemaVersion: 1, artifact, removeBlob: candidate.removeBlob, digest: candidate.digest };
};

const assertBoundedNonNegativeInteger = (value: unknown, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || value > maximum) {
    throw new PublisherArtifactStagingStoreError('PUBLISHER_ARTIFACT_STAGING_INVALID', `${label} is invalid.`);
  }
  return value;
};

const uploadSessionPayload = (sessions: readonly UploadSessionRecord[]) => ({ schemaVersion: 1 as const, sessions });

const toUploadSession = (record: UploadSessionRecord): PublisherArtifactUploadSession => ({
  schemaVersion: 1,
  sessionId: record.sessionId,
  publisherId: record.publisherId,
  subjectId: record.subjectId,
  artifactId: record.artifactId,
  idempotencyKey: record.idempotencyKey,
  declaredByteLength: record.declaredByteLength,
  receivedByteLength: record.receivedByteLength,
  expiresAt: record.expiresAt,
  state: record.state,
  artifactFingerprint: record.artifactFingerprint,
});

const parseUploadSessionRecord = (value: unknown, maxArtifactBytes: number): UploadSessionRecord => {
  const candidate = assertExactKeys(
    value,
    [
      'schemaVersion',
      'sessionId',
      'publisherId',
      'subjectId',
      'artifactId',
      'idempotencyKey',
      'declaredByteLength',
      'receivedByteLength',
      'createdAt',
      'lastActivityAt',
      'expiresAt',
      'maxExpiresAt',
      'state',
      'artifactFingerprint',
    ],
    'Publisher artifact upload session'
  );
  if (candidate.schemaVersion !== 1 || (candidate.state !== 'active' && candidate.state !== 'sealed')) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Publisher artifact upload session is invalid.'
    );
  }
  const declaredByteLength = assertBoundedPositiveInteger(
    candidate.declaredByteLength,
    Math.min(maxArtifactBytes, MAX_STREAMED_ARTIFACT_BYTES),
    'Publisher artifact upload session byte length'
  );
  const receivedByteLength = assertBoundedNonNegativeInteger(
    candidate.receivedByteLength,
    declaredByteLength,
    'Publisher artifact upload session received byte length'
  );
  const createdAt = assertBoundedNonNegativeInteger(
    candidate.createdAt,
    Number.MAX_SAFE_INTEGER,
    'Upload session creation time'
  );
  const lastActivityAt = assertBoundedNonNegativeInteger(
    candidate.lastActivityAt,
    Number.MAX_SAFE_INTEGER,
    'Upload session activity time'
  );
  const expiresAt = assertBoundedNonNegativeInteger(
    candidate.expiresAt,
    Number.MAX_SAFE_INTEGER,
    'Upload session expiry time'
  );
  const maxExpiresAt = assertBoundedNonNegativeInteger(
    candidate.maxExpiresAt,
    Number.MAX_SAFE_INTEGER,
    'Upload session maximum expiry time'
  );
  if (
    lastActivityAt < createdAt ||
    expiresAt < lastActivityAt ||
    maxExpiresAt < expiresAt ||
    maxExpiresAt - createdAt > UPLOAD_SESSION_MAX_LIFETIME_MS
  ) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Publisher artifact upload session lifetime is invalid.'
    );
  }
  let artifactEvidence: string | null;
  if (candidate.state === 'active') {
    if (candidate.artifactFingerprint !== null) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact upload session evidence is invalid.'
      );
    }
    artifactEvidence = null;
  } else {
    if (
      typeof candidate.artifactFingerprint !== 'string' ||
      !SHA256_FINGERPRINT.test(candidate.artifactFingerprint) ||
      receivedByteLength !== declaredByteLength
    ) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact upload session evidence is invalid.'
      );
    }
    artifactEvidence = candidate.artifactFingerprint;
  }
  return {
    schemaVersion: 1,
    sessionId: assertIdentifier(candidate.sessionId, 'Upload session id'),
    publisherId: assertIdentifier(candidate.publisherId, 'Upload session publisher id'),
    subjectId: assertIdentifier(candidate.subjectId, 'Upload session subject id'),
    artifactId: assertIdentifier(candidate.artifactId, 'Upload session artifact id'),
    idempotencyKey: assertIdentifier(candidate.idempotencyKey, 'Upload session idempotency key'),
    declaredByteLength,
    receivedByteLength,
    createdAt,
    lastActivityAt,
    expiresAt,
    maxExpiresAt,
    state: candidate.state,
    artifactFingerprint: artifactEvidence,
  };
};

const parseUploadSessionDocument = (value: unknown, maxArtifactBytes: number): UploadSessionDocument => {
  const candidate = assertExactKeys(
    value,
    ['schemaVersion', 'sessions', 'digest'],
    'Publisher artifact upload sessions'
  );
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.sessions) || typeof candidate.digest !== 'string') {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Publisher artifact upload sessions are invalid.'
    );
  }
  if (candidate.sessions.length > MAX_UPLOAD_SESSIONS) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Publisher artifact upload session limit is exceeded.'
    );
  }
  const sessions = candidate.sessions.map((session) => parseUploadSessionRecord(session, maxArtifactBytes));
  const sessionIds = new Set<string>();
  for (const session of sessions) {
    if (sessionIds.has(session.sessionId)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact upload sessions contain duplicate identities.'
      );
    }
    sessionIds.add(session.sessionId);
  }
  if (!SHA256_FINGERPRINT.test(candidate.digest) || candidate.digest !== digest(uploadSessionPayload(sessions))) {
    throw new PublisherArtifactStagingStoreError(
      'PUBLISHER_ARTIFACT_STAGING_INVALID',
      'Publisher artifact upload session digest is invalid.'
    );
  }
  return { schemaVersion: 1, sessions, digest: candidate.digest };
};

const sameArtifact = (left: StagedPublisherArtifact, right: StagedPublisherArtifact): boolean =>
  left.publisherId === right.publisherId &&
  left.subjectId === right.subjectId &&
  left.artifactId === right.artifactId &&
  left.idempotencyKey === right.idempotencyKey &&
  left.artifactFingerprint === right.artifactFingerprint &&
  left.byteLength === right.byteLength;

const assertAbsoluteRoot = (rootDir: string): string => {
  if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) {
    throw new Error('Publisher artifact staging root must be an absolute path.');
  }
  return path.resolve(rootDir);
};

const assertSizeLimit = (value: number | undefined, fallback: number, maximum: number, label: string): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) throw new Error(`${label} is invalid.`);
  return resolved;
};

/**
 * Main-only byte staging for publisher artifacts. The durable index binds one
 * supplied artifact ID and idempotency key to exactly one principal and hash.
 * This is intentionally neither an upload IPC boundary nor a verifier/publisher.
 */
export class PublisherArtifactStagingStore {
  private readonly rootDir: string;
  private readonly maxArtifactBytes: number;
  private readonly maxIndexBytes: number;
  private readonly now: () => number;
  private readonly isArtifactReferenced:
    | ((artifact: StagedPublisherArtifact) => boolean | Promise<boolean>)
    | undefined;
  private pending: Promise<void> = Promise.resolve();

  public constructor(options: PublisherArtifactStagingStoreOptions) {
    this.rootDir = assertAbsoluteRoot(options.rootDir);
    this.maxArtifactBytes = assertSizeLimit(
      options.maxArtifactBytes,
      DEFAULT_MAX_ARTIFACT_BYTES,
      MAX_ARTIFACT_BYTES,
      'Publisher artifact staging byte limit'
    );
    this.maxIndexBytes = assertSizeLimit(
      options.maxIndexBytes,
      DEFAULT_MAX_INDEX_BYTES,
      MAX_INDEX_BYTES,
      'Publisher artifact staging index limit'
    );
    if (this.maxIndexBytes < MIN_INDEX_BYTES) throw new Error('Publisher artifact staging index limit is invalid.');
    this.now = options.now ?? Date.now;
    this.isArtifactReferenced = options.isArtifactReferenced;
  }

  public stage(input: PublisherArtifactStageInput): Promise<StagedPublisherArtifact> {
    return this.serialize(async () => {
      const request = this.parseStageInput(input);
      const layout = await this.ensureLayout();
      const document = await this.readDocument(layout);
      const fingerprint = artifactFingerprint(request.bytes);
      const staged: StagedPublisherArtifact = {
        schemaVersion: 1,
        publisherId: request.publisherId,
        subjectId: request.subjectId,
        artifactId: request.artifactId,
        idempotencyKey: request.idempotencyKey,
        artifactFingerprint: fingerprint,
        byteLength: request.bytes.byteLength,
      };
      const replay = document.artifacts.find((artifact) => artifact.idempotencyKey === request.idempotencyKey);
      if (replay !== undefined) {
        if (!sameArtifact(replay, staged)) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
            'Artifact idempotency key is already bound to different immutable evidence.'
          );
        }
        return clone(replay);
      }
      if (document.artifacts.some((artifact) => artifact.artifactId === request.artifactId)) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Artifact id is already bound to immutable publisher evidence.'
        );
      }
      await this.writeArtifact(layout, staged, request.bytes);
      await this.writeDocument(layout, [...document.artifacts, staged]);
      return clone(staged);
    });
  }

  public read(input: PublisherArtifactReadInput): Promise<Uint8Array> {
    return this.serialize(async () => {
      const request = this.parseReadInput(input);
      const layout = await this.ensureLayout();
      const document = await this.readDocument(layout);
      const artifact = document.artifacts.find((candidate) => candidate.artifactId === request.artifactId);
      if (
        artifact === undefined ||
        artifact.publisherId !== request.publisherId ||
        artifact.subjectId !== request.subjectId
      ) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
          'Staged artifact is not available.'
        );
      }
      return this.readArtifact(layout, artifact);
    });
  }

  /**
   * Begins or resumes a Main-owned local stream. The returned opaque ID must be
   * bound to the same publisher principal for every subsequent operation.
   */
  public beginUpload(input: PublisherArtifactUploadSessionInput): Promise<PublisherArtifactUploadSession> {
    return this.serialize(async () => {
      const request = this.parseBeginUploadInput(input);
      const now = this.readNow();
      const layout = await this.ensureLayout();
      const sessions = await this.readUploadSessions(layout);
      const activeSessions = await this.pruneExpiredUploadSessions(layout, sessions, now);
      const matching = activeSessions.sessions.find(
        (session) =>
          session.publisherId === request.publisherId &&
          session.subjectId === request.subjectId &&
          session.artifactId === request.artifactId &&
          session.idempotencyKey === request.idempotencyKey
      );
      if (matching !== undefined) {
        if (matching.declaredByteLength !== request.declaredByteLength) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
            'Publisher artifact upload identity is already bound to different immutable evidence.'
          );
        }
        return clone(toUploadSession(matching));
      }
      if (
        activeSessions.sessions.some(
          (session) => session.artifactId === request.artifactId || session.idempotencyKey === request.idempotencyKey
        )
      ) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Publisher artifact upload identity is already in use.'
        );
      }
      const artifacts = await this.readDocument(layout);
      if (
        artifacts.artifacts.some(
          (artifact) => artifact.artifactId === request.artifactId || artifact.idempotencyKey === request.idempotencyKey
        )
      ) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Publisher artifact identity is already bound to immutable evidence.'
        );
      }
      if (activeSessions.sessions.length >= MAX_UPLOAD_SESSIONS) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
          'Publisher artifact upload capacity is unavailable.'
        );
      }
      const maxExpiresAt = now + UPLOAD_SESSION_MAX_LIFETIME_MS;
      const session: UploadSessionRecord = {
        schemaVersion: 1,
        sessionId: randomUUID(),
        publisherId: request.publisherId,
        subjectId: request.subjectId,
        artifactId: request.artifactId,
        idempotencyKey: request.idempotencyKey,
        declaredByteLength: request.declaredByteLength,
        receivedByteLength: 0,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: Math.min(now + UPLOAD_SESSION_INACTIVITY_MS, maxExpiresAt),
        maxExpiresAt,
        state: 'active',
        artifactFingerprint: null,
      };
      await this.writeAtomically(this.uploadPartPath(layout, session.sessionId), new Uint8Array());
      await this.writeUploadSessions(layout, [...activeSessions.sessions, session]);
      return clone(toUploadSession(session));
    });
  }

  /** Appends one integrity-checked ordered chunk, or idempotently replays an already durable chunk. */
  public appendUploadChunk(input: PublisherArtifactUploadChunkInput): Promise<PublisherArtifactUploadSession> {
    return this.serialize(async () => {
      const request = this.parseUploadChunkInput(input);
      const now = this.readNow();
      const layout = await this.ensureLayout();
      const document = await this.pruneExpiredUploadSessions(layout, await this.readUploadSessions(layout), now);
      const session = this.requireOwnedUploadSession(document, request);
      if (session.state !== 'active') {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Publisher artifact upload is already sealed.'
        );
      }
      if (
        request.offset > session.receivedByteLength ||
        request.offset + request.bytes.byteLength > session.declaredByteLength
      ) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_INVALID',
          'Publisher artifact upload chunk order is invalid.'
        );
      }
      const partPath = this.uploadPartPath(layout, session.sessionId);
      if (request.offset < session.receivedByteLength) {
        if (request.offset + request.bytes.byteLength > session.receivedByteLength) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_INVALID',
            'Publisher artifact upload chunk order is invalid.'
          );
        }
        const persisted = await this.readUploadRange(partPath, request.offset, request.bytes.byteLength);
        if (artifactFingerprint(persisted) !== request.chunkFingerprint) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
            'Publisher artifact upload chunk evidence conflicts with durable bytes.'
          );
        }
      } else {
        await this.appendUploadBytes(partPath, session.receivedByteLength, request.bytes, request.chunkFingerprint);
      }
      const updated = this.touchUploadSession(
        {
          ...session,
          receivedByteLength: Math.max(session.receivedByteLength, request.offset + request.bytes.byteLength),
        },
        now
      );
      await this.writeUploadSessions(layout, this.replaceUploadSession(document.sessions, updated));
      return clone(toUploadSession(updated));
    });
  }

  /** Seals a complete stream only after its exact SHA-256 is bound to the durable artifact index. */
  public sealUpload(input: PublisherArtifactUploadSealInput): Promise<StagedPublisherArtifact> {
    return this.serialize(async () => {
      const request = this.parseUploadSealInput(input);
      const now = this.readNow();
      const layout = await this.ensureLayout();
      const sessions = await this.pruneExpiredUploadSessions(layout, await this.readUploadSessions(layout), now);
      const session = this.requireOwnedUploadSession(sessions, request);
      if (session.state === 'sealed') {
        if (session.artifactFingerprint !== request.artifactFingerprint) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
            'Publisher artifact upload seal conflicts with immutable evidence.'
          );
        }
        return this.readSealedArtifact(layout, session);
      }
      if (session.receivedByteLength !== session.declaredByteLength) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_INVALID',
          'Publisher artifact upload is incomplete.'
        );
      }
      const partPath = this.uploadPartPath(layout, session.sessionId);
      const actualFingerprint = await this.fingerprintUploadPart(partPath, session.declaredByteLength);
      if (actualFingerprint !== request.artifactFingerprint) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Publisher artifact upload seal conflicts with durable bytes.'
        );
      }
      await this.persistUploadPart(layout, session, actualFingerprint);
      const document = await this.readDocument(layout);
      const staged: StagedPublisherArtifact = {
        schemaVersion: 1,
        publisherId: session.publisherId,
        subjectId: session.subjectId,
        artifactId: session.artifactId,
        idempotencyKey: session.idempotencyKey,
        artifactFingerprint: actualFingerprint,
        byteLength: session.declaredByteLength,
      };
      const replay = document.artifacts.find((artifact) => artifact.idempotencyKey === staged.idempotencyKey);
      if (replay !== undefined) {
        if (!sameArtifact(replay, staged)) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
            'Artifact idempotency key is already bound to different immutable evidence.'
          );
        }
      } else {
        if (document.artifacts.some((artifact) => artifact.artifactId === staged.artifactId)) {
          throw new PublisherArtifactStagingStoreError(
            'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
            'Artifact id is already bound to immutable publisher evidence.'
          );
        }
        await this.writeDocument(layout, [...document.artifacts, staged]);
      }
      const sealed: UploadSessionRecord = {
        ...session,
        receivedByteLength: session.declaredByteLength,
        lastActivityAt: now,
        expiresAt: session.maxExpiresAt,
        state: 'sealed',
        artifactFingerprint: actualFingerprint,
      };
      await this.writeUploadSessions(layout, this.replaceUploadSession(sessions.sessions, sealed));
      return clone(replay ?? staged);
    });
  }

  /** Cancels only an active session owned by the requesting publisher principal. */
  public cancelUpload(input: PublisherArtifactUploadCancelInput): Promise<void> {
    return this.serialize(async () => {
      const request = this.parseUploadCancelInput(input);
      const layout = await this.ensureLayout();
      const document = await this.pruneExpiredUploadSessions(
        layout,
        await this.readUploadSessions(layout),
        this.readNow()
      );
      const session = this.requireOwnedUploadSession(document, request);
      if (session.state !== 'active') {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Publisher artifact upload is already sealed.'
        );
      }
      await rm(this.uploadPartPath(layout, session.sessionId), { force: true });
      await this.writeUploadSessions(
        layout,
        document.sessions.filter((candidate) => candidate.sessionId !== session.sessionId)
      );
    });
  }

  /**
   * Removes one exact sealed archive only when the Main-owned submission lookup
   * proves that no durable review record references it. This is deliberately
   * not exposed through IPC and fails closed without that lookup.
   */
  public discardSealedArtifact(input: PublisherArtifactDiscardSealedInput): Promise<void> {
    return this.serialize(async () => {
      const request = this.parseDiscardSealedInput(input);
      if (this.isArtifactReferenced === undefined) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
          'Publisher artifact cleanup is unavailable.'
        );
      }
      const layout = await this.ensureLayout();
      const document = await this.readDocument(layout);
      const artifact = document.artifacts.find((candidate) => candidate.artifactId === request.artifactId);
      if (
        artifact === undefined ||
        artifact.publisherId !== request.publisherId ||
        artifact.subjectId !== request.subjectId ||
        artifact.artifactFingerprint !== request.artifactFingerprint
      ) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
          'Sealed artifact is not available for cleanup.'
        );
      }
      const sessions = await this.readUploadSessions(layout);
      const sealedSession = sessions.sessions.find(
        (session) =>
          session.state === 'sealed' &&
          session.publisherId === artifact.publisherId &&
          session.subjectId === artifact.subjectId &&
          session.artifactId === artifact.artifactId &&
          session.idempotencyKey === artifact.idempotencyKey &&
          session.artifactFingerprint === artifact.artifactFingerprint
      );
      if (sealedSession === undefined) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Artifact was not sealed by a recoverable upload session.'
        );
      }
      // Validate the immutable blob before changing either durable index.
      await this.readArtifact(layout, artifact);
      let referenced: boolean;
      try {
        referenced = await this.isArtifactReferenced(artifact);
      } catch (error) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
          'Publisher artifact reference state is unavailable.',
          { cause: error }
        );
      }
      if (referenced) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
          'Sealed artifact has durable submission evidence.'
        );
      }
      const remainingArtifacts = document.artifacts.filter((candidate) => candidate.artifactId !== artifact.artifactId);
      const removeBlob = !remainingArtifacts.some(
        (candidate) => candidate.artifactFingerprint === artifact.artifactFingerprint
      );
      await this.writeDiscardJournal(layout, artifact, removeBlob);
      await this.writeDocument(layout, remainingArtifacts);
      await this.writeUploadSessions(
        layout,
        sessions.sessions.filter((session) => session.sessionId !== sealedSession.sessionId)
      );
      await this.completeDiscardJournal(layout, { artifact, removeBlob });
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return result;
  }

  private parseBeginUploadInput(input: PublisherArtifactUploadSessionInput): PublisherArtifactUploadSessionInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'artifactId', 'idempotencyKey', 'declaredByteLength'],
      'Publisher artifact upload request'
    );
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      artifactId: assertIdentifier(candidate.artifactId, 'Artifact id'),
      idempotencyKey: assertIdentifier(candidate.idempotencyKey, 'Artifact idempotency key'),
      declaredByteLength: assertBoundedPositiveInteger(
        candidate.declaredByteLength,
        Math.min(this.maxArtifactBytes, MAX_STREAMED_ARTIFACT_BYTES),
        'Publisher artifact upload byte length'
      ),
    };
  }

  private parseUploadChunkInput(input: PublisherArtifactUploadChunkInput): PublisherArtifactUploadChunkInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'sessionId', 'offset', 'bytes', 'chunkFingerprint'],
      'Publisher artifact upload chunk'
    );
    if (!(candidate.bytes instanceof Uint8Array)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact upload chunk bytes are invalid.'
      );
    }
    const bytes = Uint8Array.from(candidate.bytes);
    assertBoundedPositiveInteger(
      bytes.byteLength,
      MAX_UPLOAD_CHUNK_BYTES,
      'Publisher artifact upload chunk byte length'
    );
    if (typeof candidate.chunkFingerprint !== 'string' || !SHA256_FINGERPRINT.test(candidate.chunkFingerprint)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact upload chunk fingerprint is invalid.'
      );
    }
    if (artifactFingerprint(bytes) !== candidate.chunkFingerprint) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
        'Publisher artifact upload chunk fingerprint does not match supplied bytes.'
      );
    }
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      sessionId: assertIdentifier(candidate.sessionId, 'Upload session id'),
      offset: assertBoundedNonNegativeInteger(
        candidate.offset,
        this.maxArtifactBytes,
        'Publisher artifact upload chunk offset'
      ),
      bytes,
      chunkFingerprint: candidate.chunkFingerprint,
    };
  }

  private parseUploadSealInput(input: PublisherArtifactUploadSealInput): PublisherArtifactUploadSealInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'sessionId', 'artifactFingerprint'],
      'Publisher artifact upload seal'
    );
    if (typeof candidate.artifactFingerprint !== 'string' || !SHA256_FINGERPRINT.test(candidate.artifactFingerprint)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact upload seal fingerprint is invalid.'
      );
    }
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      sessionId: assertIdentifier(candidate.sessionId, 'Upload session id'),
      artifactFingerprint: candidate.artifactFingerprint,
    };
  }

  private parseDiscardSealedInput(input: PublisherArtifactDiscardSealedInput): PublisherArtifactDiscardSealedInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'artifactId', 'artifactFingerprint', 'reason'],
      'Publisher sealed artifact cleanup request'
    );
    if (typeof candidate.artifactFingerprint !== 'string' || !SHA256_FINGERPRINT.test(candidate.artifactFingerprint)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact cleanup fingerprint is invalid.'
      );
    }
    if (candidate.reason !== 'verification-failed' && candidate.reason !== 'submission-creation-failed') {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact cleanup reason is invalid.'
      );
    }
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      artifactId: assertIdentifier(candidate.artifactId, 'Artifact id'),
      artifactFingerprint: candidate.artifactFingerprint,
      reason: candidate.reason,
    };
  }

  private parseUploadCancelInput(input: PublisherArtifactUploadCancelInput): PublisherArtifactUploadCancelInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'sessionId'],
      'Publisher artifact upload cancellation'
    );
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      sessionId: assertIdentifier(candidate.sessionId, 'Upload session id'),
    };
  }

  private readNow(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact staging clock is unavailable.'
      );
    }
    return now;
  }

  private requireOwnedUploadSession(
    document: UploadSessionDocument,
    request: Readonly<{ publisherId: string; subjectId: string; sessionId: string }>
  ): UploadSessionRecord {
    const session = document.sessions.find((candidate) => candidate.sessionId === request.sessionId);
    if (
      session === undefined ||
      session.publisherId !== request.publisherId ||
      session.subjectId !== request.subjectId
    ) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
        'Publisher artifact upload is not available.'
      );
    }
    return session;
  }

  private touchUploadSession(session: UploadSessionRecord, now: number): UploadSessionRecord {
    const lastActivityAt = Math.max(session.lastActivityAt, now);
    return {
      ...session,
      lastActivityAt,
      expiresAt: Math.min(lastActivityAt + UPLOAD_SESSION_INACTIVITY_MS, session.maxExpiresAt),
    };
  }

  private replaceUploadSession(
    sessions: readonly UploadSessionRecord[],
    replacement: UploadSessionRecord
  ): UploadSessionRecord[] {
    return sessions.map((candidate) => (candidate.sessionId === replacement.sessionId ? replacement : candidate));
  }

  private parseStageInput(input: PublisherArtifactStageInput): PublisherArtifactStageInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'artifactId', 'bytes', 'idempotencyKey'],
      'Publisher artifact staging request'
    );
    if (!(candidate.bytes instanceof Uint8Array)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_INVALID',
        'Publisher artifact bytes are invalid.'
      );
    }
    const bytes = Uint8Array.from(candidate.bytes);
    assertBoundedPositiveInteger(bytes.byteLength, this.maxArtifactBytes, 'Publisher artifact byte length');
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      artifactId: assertIdentifier(candidate.artifactId, 'Artifact id'),
      bytes,
      idempotencyKey: assertIdentifier(candidate.idempotencyKey, 'Artifact idempotency key'),
    };
  }

  private parseReadInput(input: PublisherArtifactReadInput): PublisherArtifactReadInput {
    const candidate = assertExactKeys(
      input,
      ['publisherId', 'subjectId', 'artifactId'],
      'Publisher artifact read request'
    );
    return {
      publisherId: assertIdentifier(candidate.publisherId, 'Publisher id'),
      subjectId: assertIdentifier(candidate.subjectId, 'Subject id'),
      artifactId: assertIdentifier(candidate.artifactId, 'Artifact id'),
    };
  }

  private async ensureLayout(): Promise<
    Readonly<{
      rootDir: string;
      artifactDir: string;
      uploadDir: string;
      indexPath: string;
      uploadIndexPath: string;
      discardJournalPath: string;
    }>
  > {
    try {
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      const rootStat = await lstat(this.rootDir);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Root is not a real directory.');
      const rootDir = await realpath(this.rootDir);
      const artifactDir = this.resolveInsideRoot(rootDir, ARTIFACT_DIRECTORY_NAME);
      await mkdir(artifactDir, { recursive: true, mode: 0o700 });
      const artifactStat = await lstat(artifactDir);
      if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink())
        throw new Error('Artifact directory is not a real directory.');
      const uploadDir = this.resolveInsideRoot(rootDir, UPLOAD_DIRECTORY_NAME);
      await mkdir(uploadDir, { recursive: true, mode: 0o700 });
      const uploadStat = await lstat(uploadDir);
      if (!uploadStat.isDirectory() || uploadStat.isSymbolicLink())
        throw new Error('Upload directory is not a real directory.');
      const layout = {
        rootDir,
        artifactDir,
        uploadDir,
        indexPath: this.resolveInsideRoot(rootDir, INDEX_FILE_NAME),
        uploadIndexPath: this.resolveInsideRoot(rootDir, UPLOAD_SESSION_INDEX_FILE_NAME),
        discardJournalPath: this.resolveInsideRoot(rootDir, DISCARD_JOURNAL_FILE_NAME),
      };
      await this.recoverDiscardJournal(layout);
      return layout;
    } catch (error) {
      if (error instanceof PublisherArtifactStagingStoreError) throw error;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact staging is unavailable.',
        { cause: error }
      );
    }
  }

  private resolveInsideRoot(rootDir: string, relativePath: string): string {
    const resolved = path.resolve(rootDir, relativePath);
    const relative = path.relative(rootDir, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact staging path is invalid.'
      );
    }
    return resolved;
  }

  private async readDiscardJournal(
    layout: Readonly<{ discardJournalPath: string }>
  ): Promise<DiscardJournal | undefined> {
    try {
      const fileStat = await lstat(layout.discardJournalPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > this.maxIndexBytes) {
        throw new Error('Discard journal is not a bounded regular file.');
      }
      return parseDiscardJournal(
        JSON.parse(await readFile(layout.discardJournalPath, 'utf8')) as unknown,
        this.maxArtifactBytes
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof PublisherArtifactStagingStoreError) throw error;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Publisher artifact discard recovery state is corrupt.',
        { cause: error }
      );
    }
  }

  private async writeDiscardJournal(
    layout: Readonly<{ discardJournalPath: string }>,
    artifact: StagedPublisherArtifact,
    removeBlob: boolean
  ): Promise<void> {
    const journal: DiscardJournal = {
      schemaVersion: 1,
      artifact: clone(artifact),
      removeBlob,
      digest: digest(discardJournalPayload(artifact, removeBlob)),
    };
    const serialized = `${JSON.stringify(journal)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > this.maxIndexBytes) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact discard recovery state exceeds its limit.'
      );
    }
    await this.writeAtomically(layout.discardJournalPath, Buffer.from(serialized, 'utf8'));
  }

  private async recoverDiscardJournal(
    layout: Readonly<{
      rootDir: string;
      artifactDir: string;
      indexPath: string;
      uploadIndexPath: string;
      discardJournalPath: string;
    }>
  ): Promise<void> {
    const journal = await this.readDiscardJournal(layout);
    if (journal === undefined) return;
    const document = await this.readDocument(layout);
    const matching = document.artifacts.find((candidate) => candidate.artifactId === journal.artifact.artifactId);
    if (matching !== undefined) {
      if (!sameArtifact(matching, journal.artifact)) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
          'Discard journal conflicts with immutable artifact evidence.'
        );
      }
      await this.removeDiscardJournal(layout);
      return;
    }
    if (
      journal.removeBlob &&
      document.artifacts.some((candidate) => candidate.artifactFingerprint === journal.artifact.artifactFingerprint)
    ) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Discard journal would remove a shared artifact payload.'
      );
    }
    const sessions = await this.readUploadSessions(layout);
    const matchingSessions = sessions.sessions.filter((session) => session.artifactId === journal.artifact.artifactId);
    if (
      matchingSessions.some(
        (session) =>
          session.state !== 'sealed' ||
          session.publisherId !== journal.artifact.publisherId ||
          session.subjectId !== journal.artifact.subjectId ||
          session.idempotencyKey !== journal.artifact.idempotencyKey ||
          session.artifactFingerprint !== journal.artifact.artifactFingerprint
      )
    ) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Discard journal conflicts with upload-session evidence.'
      );
    }
    if (matchingSessions.length > 0) {
      await this.writeUploadSessions(
        layout,
        sessions.sessions.filter((session) => session.artifactId !== journal.artifact.artifactId)
      );
    }
    await this.completeDiscardJournal(layout, journal);
  }

  private async completeDiscardJournal(
    layout: Readonly<{ rootDir: string; artifactDir: string; discardJournalPath: string }>,
    journal: Pick<DiscardJournal, 'artifact' | 'removeBlob'>
  ): Promise<void> {
    if (journal.removeBlob) await this.removeArtifactBlob(layout, journal.artifact.artifactFingerprint);
    await this.removeDiscardJournal(layout);
  }

  private async removeArtifactBlob(
    layout: Readonly<{ rootDir: string; artifactDir: string }>,
    fingerprint: string
  ): Promise<void> {
    const filePath = this.artifactPath(layout, fingerprint);
    try {
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Artifact payload is not a regular file.');
      await rm(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Staged artifact payload cannot be discarded.',
        { cause: error }
      );
    }
  }

  private async removeDiscardJournal(layout: Readonly<{ discardJournalPath: string }>): Promise<void> {
    try {
      await rm(layout.discardJournalPath, { force: true });
    } catch (error) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact discard recovery state cannot be cleared.',
        { cause: error }
      );
    }
  }

  private artifactPath(layout: Readonly<{ rootDir: string; artifactDir: string }>, fingerprint: string): string {
    if (!SHA256_FINGERPRINT.test(fingerprint)) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Artifact fingerprint is invalid.'
      );
    }
    return this.resolveInsideRoot(layout.rootDir, path.join(ARTIFACT_DIRECTORY_NAME, `${fingerprint.slice(7)}.bin`));
  }

  private uploadPartPath(layout: Readonly<{ rootDir: string; uploadDir: string }>, sessionId: string): string {
    assertIdentifier(sessionId, 'Upload session id');
    return this.resolveInsideRoot(layout.rootDir, path.join(UPLOAD_DIRECTORY_NAME, `${sessionId}.part`));
  }

  private async readUploadSessions(layout: Readonly<{ uploadIndexPath: string }>): Promise<UploadSessionDocument> {
    try {
      const fileStat = await lstat(layout.uploadIndexPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > this.maxIndexBytes) {
        throw new Error('Upload session index is not a bounded regular file.');
      }
      return parseUploadSessionDocument(
        JSON.parse(await readFile(layout.uploadIndexPath, 'utf8')) as unknown,
        this.maxArtifactBytes
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1, sessions: [], digest: digest(uploadSessionPayload([])) };
      }
      if (error instanceof PublisherArtifactStagingStoreError) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
          'Publisher artifact upload session state is corrupt.',
          { cause: error }
        );
      }
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Publisher artifact upload session state cannot be read.',
        { cause: error }
      );
    }
  }

  private async writeUploadSessions(
    layout: Readonly<{ uploadIndexPath: string }>,
    sessions: readonly UploadSessionRecord[]
  ): Promise<void> {
    const document: UploadSessionDocument = {
      schemaVersion: 1,
      sessions: clone([...sessions]),
      digest: digest(uploadSessionPayload(sessions)),
    };
    const serialized = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > this.maxIndexBytes) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact upload session capacity is unavailable.'
      );
    }
    await this.writeAtomically(layout.uploadIndexPath, Buffer.from(serialized, 'utf8'));
  }

  private async pruneExpiredUploadSessions(
    layout: Readonly<{ rootDir: string; uploadDir: string; uploadIndexPath: string }>,
    document: UploadSessionDocument,
    now: number
  ): Promise<UploadSessionDocument> {
    const expired = document.sessions.filter((session) => session.state === 'active' && now >= session.expiresAt);
    if (expired.length === 0) return document;
    for (const session of expired) {
      await rm(this.uploadPartPath(layout, session.sessionId), { force: true });
    }
    const sessions = document.sessions.filter(
      (session) => !expired.some((candidate) => candidate.sessionId === session.sessionId)
    );
    await this.writeUploadSessions(layout, sessions);
    return { schemaVersion: 1, sessions, digest: digest(uploadSessionPayload(sessions)) };
  }

  private async readUploadRange(filePath: string, offset: number, byteLength: number): Promise<Uint8Array> {
    try {
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size < offset + byteLength) {
        throw new Error('Upload part is not a bounded regular file.');
      }
      const handle = await open(filePath, 'r');
      try {
        const bytes = new Uint8Array(byteLength);
        let read = 0;
        while (read < byteLength) {
          const result = await handle.read(bytes, read, byteLength - read, offset + read);
          if (result.bytesRead === 0) throw new Error('Upload part ended unexpectedly.');
          read += result.bytesRead;
        }
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof PublisherArtifactStagingStoreError) throw error;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Publisher artifact upload bytes cannot be read.',
        { cause: error }
      );
    }
  }

  private async appendUploadBytes(
    filePath: string,
    expectedOffset: number,
    bytes: Uint8Array,
    fingerprint: string
  ): Promise<void> {
    try {
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Upload part is not a regular file.');
      if (fileStat.size === expectedOffset + bytes.byteLength) {
        const persisted = await this.readUploadRange(filePath, expectedOffset, bytes.byteLength);
        if (artifactFingerprint(persisted) !== fingerprint)
          throw new Error('Upload part recovery evidence does not match.');
        return;
      }
      if (fileStat.size !== expectedOffset) throw new Error('Upload part size does not match durable offset.');
      const handle = await open(filePath, 'r+');
      try {
        let written = 0;
        while (written < bytes.byteLength) {
          const result = await handle.write(bytes, written, bytes.byteLength - written, expectedOffset + written);
          if (result.bytesWritten === 0) throw new Error('Upload part cannot be appended.');
          written += result.bytesWritten;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof PublisherArtifactStagingStoreError) throw error;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact upload bytes cannot be persisted.',
        { cause: error }
      );
    }
  }

  private async fingerprintUploadPart(filePath: string, expectedByteLength: number): Promise<string> {
    try {
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== expectedByteLength) {
        throw new Error('Upload part does not match its declared length.');
      }
      const handle = await open(filePath, 'r');
      try {
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(Math.min(MAX_UPLOAD_CHUNK_BYTES, expectedByteLength));
        let offset = 0;
        while (offset < expectedByteLength) {
          const result = await handle.read(buffer, 0, Math.min(buffer.byteLength, expectedByteLength - offset), offset);
          if (result.bytesRead === 0) throw new Error('Upload part ended unexpectedly.');
          hash.update(buffer.subarray(0, result.bytesRead));
          offset += result.bytesRead;
        }
        return `sha256-${hash.digest('hex')}`;
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Publisher artifact upload bytes cannot be sealed.',
        { cause: error }
      );
    }
  }

  private async persistUploadPart(
    layout: Readonly<{ rootDir: string; artifactDir: string; uploadDir: string }>,
    session: UploadSessionRecord,
    fingerprint: string
  ): Promise<void> {
    const sourcePath = this.uploadPartPath(layout, session.sessionId);
    const destinationPath = this.artifactPath(layout, fingerprint);
    try {
      try {
        await lstat(destinationPath);
        if ((await this.fingerprintUploadPart(destinationPath, session.declaredByteLength)) !== fingerprint) {
          throw new Error('Existing immutable artifact does not match its fingerprint.');
        }
        await rm(sourcePath, { force: true });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await this.fingerprintUploadPart(sourcePath, session.declaredByteLength);
      await rename(sourcePath, destinationPath);
      await chmod(destinationPath, 0o600);
    } catch (error) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact upload cannot be persisted.',
        { cause: error }
      );
    }
  }

  private async readSealedArtifact(
    layout: Readonly<{ indexPath: string }>,
    session: UploadSessionRecord
  ): Promise<StagedPublisherArtifact> {
    const document = await this.readDocument(layout);
    const artifact = document.artifacts.find(
      (candidate) =>
        candidate.publisherId === session.publisherId &&
        candidate.subjectId === session.subjectId &&
        candidate.artifactId === session.artifactId &&
        candidate.idempotencyKey === session.idempotencyKey &&
        candidate.artifactFingerprint === session.artifactFingerprint
    );
    if (artifact === undefined) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Publisher artifact upload seal cannot be recovered.'
      );
    }
    return clone(artifact);
  }

  private async readDocument(layout: Readonly<{ indexPath: string }>): Promise<ArtifactDocument> {
    try {
      const fileStat = await lstat(layout.indexPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > this.maxIndexBytes) {
        throw new Error('Staging index is not a bounded regular file.');
      }
      return parseDocument(JSON.parse(await readFile(layout.indexPath, 'utf8')) as unknown, this.maxArtifactBytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1, artifacts: [], digest: digest(documentPayload([])) };
      }
      if (error instanceof PublisherArtifactStagingStoreError) {
        throw new PublisherArtifactStagingStoreError(
          'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
          'Staging index is corrupt.',
          {
            cause: error,
          }
        );
      }
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Staging index cannot be read.',
        {
          cause: error,
        }
      );
    }
  }

  private async readArtifact(
    layout: Readonly<{ rootDir: string; artifactDir: string }>,
    artifact: StagedPublisherArtifact
  ): Promise<Uint8Array> {
    const filePath = this.artifactPath(layout, artifact.artifactFingerprint);
    try {
      const fileStat = await lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== artifact.byteLength) {
        throw new Error('Artifact payload is not its expected regular file.');
      }
      const bytes = new Uint8Array(await readFile(filePath));
      if (bytes.byteLength !== artifact.byteLength || artifactFingerprint(bytes) !== artifact.artifactFingerprint) {
        throw new Error('Artifact payload does not match its immutable evidence.');
      }
      return bytes;
    } catch (error) {
      if (error instanceof PublisherArtifactStagingStoreError) throw error;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
        'Staged artifact payload cannot be read.',
        { cause: error }
      );
    }
  }

  private async writeArtifact(
    layout: Readonly<{ rootDir: string; artifactDir: string }>,
    artifact: StagedPublisherArtifact,
    bytes: Uint8Array
  ): Promise<void> {
    await this.writeAtomically(this.artifactPath(layout, artifact.artifactFingerprint), bytes);
  }

  private async writeDocument(
    layout: Readonly<{ rootDir: string; artifactDir: string; indexPath: string }>,
    artifacts: readonly StagedPublisherArtifact[]
  ): Promise<void> {
    const document: ArtifactDocument = {
      schemaVersion: 1,
      artifacts: clone([...artifacts]),
      digest: digest(documentPayload(artifacts)),
    };
    const serialized = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > this.maxIndexBytes) {
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Staging index would exceed its configured size limit.'
      );
    }
    await this.writeAtomically(layout.indexPath, Buffer.from(serialized, 'utf8'));
  }

  private async writeAtomically(filePath: string, bytes: Uint8Array): Promise<void> {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      if (error instanceof PublisherArtifactStagingStoreError) throw error;
      throw new PublisherArtifactStagingStoreError(
        'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
        'Publisher artifact staging cannot be persisted.',
        { cause: error }
      );
    }
  }
}
