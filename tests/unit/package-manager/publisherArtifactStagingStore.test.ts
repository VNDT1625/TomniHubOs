import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PublisherArtifactStagingStore,
  type PublisherArtifactStageInput,
  type PublisherArtifactStagingStoreError,
} from '@process/services/database/publisherArtifactStagingStore';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const fingerprint = (value: Uint8Array): string => 'sha256-' + createHash('sha256').update(value).digest('hex');

const request = (
  overrides: Partial<Omit<PublisherArtifactStageInput, 'bytes'>> & { bytes?: Uint8Array } = {}
): PublisherArtifactStageInput => ({
  publisherId: 'com.tomni.publisher',
  subjectId: 'account-123',
  artifactId: 'artifact-123',
  idempotencyKey: 'stage-123',
  bytes: bytes('publisher artifact bytes'),
  ...overrides,
});

const inTemporaryStore = async (operation: (rootDir: string) => Promise<void>): Promise<void> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-publisher-artifact-'));
  try {
    await operation(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
};

const sealUpload = async (
  store: PublisherArtifactStagingStore,
  input: Readonly<{ artifactId: string; idempotencyKey: string; value: Uint8Array }>
) => {
  const session = await store.beginUpload({
    publisherId: 'com.tomni.publisher',
    subjectId: 'account-123',
    artifactId: input.artifactId,
    idempotencyKey: input.idempotencyKey,
    declaredByteLength: input.value.byteLength,
  });
  await store.appendUploadChunk({
    publisherId: 'com.tomni.publisher',
    subjectId: 'account-123',
    sessionId: session.sessionId,
    offset: 0,
    bytes: input.value,
    chunkFingerprint: fingerprint(input.value),
  });
  return store.sealUpload({
    publisherId: 'com.tomni.publisher',
    subjectId: 'account-123',
    sessionId: session.sessionId,
    artifactFingerprint: fingerprint(input.value),
  });
};

describe('PublisherArtifactStagingStore', () => {
  it('durably stages Main-fed bytes, returns the exact idempotent replay, and reads after restart', async () => {
    await inTemporaryStore(async (rootDir) => {
      const input = request();
      const first = new PublisherArtifactStagingStore({ rootDir });
      const accepted = await first.stage(input);
      input.bytes[0] = 0;

      const restarted = new PublisherArtifactStagingStore({ rootDir });
      const replayed = await restarted.stage(request());
      const read = await restarted.read({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        artifactId: 'artifact-123',
      });

      expect(replayed).toEqual(accepted);
      expect(replayed.artifactFingerprint).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(new TextDecoder().decode(read)).toBe('publisher artifact bytes');
      expect(JSON.parse(await readFile(path.join(rootDir, 'publisher-artifact-staging.v1.json'), 'utf8'))).toEqual({
        schemaVersion: 1,
        artifacts: [accepted],
        digest: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
      });
    });
  });

  it('rejects idempotency conflicts, cross-principal reads, and untrusted path-like input', async () => {
    await inTemporaryStore(async (rootDir) => {
      const store = new PublisherArtifactStagingStore({ rootDir });
      await store.stage(request());

      await expect(store.stage(request({ bytes: bytes('changed') }))).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(store.stage(request({ subjectId: 'account-other' }))).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.read({ publisherId: 'com.tomni.publisher', subjectId: 'account-other', artifactId: 'artifact-123' })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.stage(request({ artifactId: '../outside', idempotencyKey: 'stage-456' }))
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_INVALID',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.stage({
          ...request({ artifactId: 'artifact-456', idempotencyKey: 'stage-456' }),
          path: 'C:\\outside.bin',
        } as never)
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_INVALID',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
    });
  });

  it('fails closed when the durable index or staged bytes are corrupted', async () => {
    await inTemporaryStore(async (rootDir) => {
      const store = new PublisherArtifactStagingStore({ rootDir });
      const accepted = await store.stage(request());
      const artifactPath = path.join(rootDir, 'artifacts', `${accepted.artifactFingerprint.slice(7)}.bin`);
      await writeFile(artifactPath, 'changed', 'utf8');

      await expect(
        store.read({ publisherId: 'com.tomni.publisher', subjectId: 'account-123', artifactId: 'artifact-123' })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);

      await writeFile(path.join(rootDir, 'publisher-artifact-staging.v1.json'), '{"schemaVersion":1', 'utf8');
      const restarted = new PublisherArtifactStagingStore({ rootDir });
      await expect(
        restarted.stage(request({ artifactId: 'artifact-456', idempotencyKey: 'stage-456' }))
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
    });
  });

  it('enforces bounded non-empty byte payloads before any storage operation', async () => {
    await inTemporaryStore(async (rootDir) => {
      const store = new PublisherArtifactStagingStore({ rootDir, maxArtifactBytes: 4 });

      await expect(store.stage(request({ bytes: new Uint8Array() }))).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_INVALID',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(store.stage(request({ bytes: bytes('oversized') }))).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_INVALID',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
    });
  });

  it('streams ordered chunks, seals immutable evidence, and recovers the sealed artifact after restart', async () => {
    await inTemporaryStore(async (rootDir) => {
      let now = 1_000;
      const value = bytes('streamed publisher artifact bytes');
      const firstChunk = value.slice(0, 9);
      const secondChunk = value.slice(9);
      const first = new PublisherArtifactStagingStore({ rootDir, now: () => now });
      const session = await first.beginUpload({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        artifactId: 'stream-artifact-123',
        idempotencyKey: 'stream-stage-123',
        declaredByteLength: value.byteLength,
      });

      const restarted = new PublisherArtifactStagingStore({ rootDir, now: () => now });
      await restarted.appendUploadChunk({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        sessionId: session.sessionId,
        offset: 0,
        bytes: firstChunk,
        chunkFingerprint: fingerprint(firstChunk),
      });
      const appended = await restarted.appendUploadChunk({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        sessionId: session.sessionId,
        offset: firstChunk.byteLength,
        bytes: secondChunk,
        chunkFingerprint: fingerprint(secondChunk),
      });
      expect(appended.receivedByteLength).toBe(value.byteLength);

      const sealed = await restarted.sealUpload({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        sessionId: session.sessionId,
        artifactFingerprint: fingerprint(value),
      });
      const recovered = new PublisherArtifactStagingStore({ rootDir, now: () => now });
      await expect(
        recovered.sealUpload({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          sessionId: session.sessionId,
          artifactFingerprint: fingerprint(value),
        })
      ).resolves.toEqual(sealed);
      await expect(
        recovered.read({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          artifactId: 'stream-artifact-123',
        })
      ).resolves.toEqual(value);
    });
  });

  it('rejects cross-principal, unordered, oversized, and tampered upload chunks', async () => {
    await inTemporaryStore(async (rootDir) => {
      const store = new PublisherArtifactStagingStore({ rootDir });
      const session = await store.beginUpload({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        artifactId: 'stream-artifact-456',
        idempotencyKey: 'stream-stage-456',
        declaredByteLength: 5,
      });
      const valid = bytes('hello');

      await expect(
        store.appendUploadChunk({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-other',
          sessionId: session.sessionId,
          offset: 0,
          bytes: valid,
          chunkFingerprint: fingerprint(valid),
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.appendUploadChunk({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          sessionId: session.sessionId,
          offset: 1,
          bytes: valid,
          chunkFingerprint: fingerprint(valid),
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_INVALID',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
      await expect(
        store.appendUploadChunk({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          sessionId: session.sessionId,
          offset: 0,
          bytes: oversized,
          chunkFingerprint: fingerprint(oversized),
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_INVALID',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.appendUploadChunk({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          sessionId: session.sessionId,
          offset: 0,
          bytes: valid,
          chunkFingerprint: fingerprint(bytes('other')),
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
    });
  });

  it('expires and cancels active upload sessions while deleting their temporary bytes', async () => {
    await inTemporaryStore(async (rootDir) => {
      let now = 0;
      const store = new PublisherArtifactStagingStore({ rootDir, now: () => now });
      const expiring = await store.beginUpload({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        artifactId: 'stream-artifact-expiring',
        idempotencyKey: 'stream-stage-expiring',
        declaredByteLength: 4,
      });
      now = 15 * 60 * 1000;
      await expect(
        store.appendUploadChunk({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          sessionId: expiring.sessionId,
          offset: 0,
          bytes: bytes('test'),
          chunkFingerprint: fingerprint(bytes('test')),
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);

      const cancellable = await store.beginUpload({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        artifactId: 'stream-artifact-cancelled',
        idempotencyKey: 'stream-stage-cancelled',
        declaredByteLength: 4,
      });
      await store.cancelUpload({
        publisherId: 'com.tomni.publisher',
        subjectId: 'account-123',
        sessionId: cancellable.sessionId,
      });
      await expect(
        store.appendUploadChunk({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          sessionId: cancellable.sessionId,
          offset: 0,
          bytes: bytes('test'),
          chunkFingerprint: fingerprint(bytes('test')),
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(readdir(path.join(rootDir, 'uploads'))).resolves.toEqual([]);
    });
  });

  it('removes an exact sealed archive after verifier failure and remains removed after restart', async () => {
    await inTemporaryStore(async (rootDir) => {
      const value = bytes('invalid verifier payload');
      const original = new PublisherArtifactStagingStore({ rootDir, isArtifactReferenced: () => false });
      const sealed = await sealUpload(original, {
        artifactId: 'verifier-failed-artifact',
        idempotencyKey: 'verifier-failed-request',
        value,
      });
      const restarted = new PublisherArtifactStagingStore({ rootDir, isArtifactReferenced: () => false });

      await restarted.discardSealedArtifact({
        publisherId: sealed.publisherId,
        subjectId: sealed.subjectId,
        artifactId: sealed.artifactId,
        artifactFingerprint: sealed.artifactFingerprint,
        reason: 'verification-failed',
      });

      await expect(
        restarted.read({
          publisherId: sealed.publisherId,
          subjectId: sealed.subjectId,
          artifactId: sealed.artifactId,
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(readdir(path.join(rootDir, 'artifacts'))).resolves.toEqual([]);
      await expect(readdir(path.join(rootDir, 'uploads'))).resolves.toEqual([]);
    });
  });

  it('never discards another principal, mismatched evidence, or a durable human-review artifact', async () => {
    await inTemporaryStore(async (rootDir) => {
      const value = bytes('reviewable archive');
      const store = new PublisherArtifactStagingStore({ rootDir, isArtifactReferenced: () => true });
      const sealed = await sealUpload(store, {
        artifactId: 'reviewable-artifact',
        idempotencyKey: 'reviewable-request',
        value,
      });
      const cleanup = (overrides: Partial<Parameters<typeof store.discardSealedArtifact>[0]> = {}) =>
        store.discardSealedArtifact({
          publisherId: sealed.publisherId,
          subjectId: sealed.subjectId,
          artifactId: sealed.artifactId,
          artifactFingerprint: sealed.artifactFingerprint,
          reason: 'submission-creation-failed',
          ...overrides,
        });

      await expect(cleanup({ subjectId: 'account-other' })).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(cleanup({ artifactFingerprint: fingerprint(bytes('different')) })).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_NOT_FOUND',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(cleanup()).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CONFLICT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.read({
          publisherId: sealed.publisherId,
          subjectId: sealed.subjectId,
          artifactId: sealed.artifactId,
        })
      ).resolves.toEqual(value);
    });
  });

  it('fails closed when Main did not configure a durable submission reference lookup', async () => {
    await inTemporaryStore(async (rootDir) => {
      const value = bytes('unverified cleanup authority');
      const store = new PublisherArtifactStagingStore({ rootDir });
      const sealed = await sealUpload(store, {
        artifactId: 'missing-reference-lookup',
        idempotencyKey: 'missing-reference-request',
        value,
      });

      await expect(
        store.discardSealedArtifact({
          publisherId: sealed.publisherId,
          subjectId: sealed.subjectId,
          artifactId: sealed.artifactId,
          artifactFingerprint: sealed.artifactFingerprint,
          reason: 'submission-creation-failed',
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_UNAVAILABLE',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
      await expect(
        store.read({
          publisherId: sealed.publisherId,
          subjectId: sealed.subjectId,
          artifactId: sealed.artifactId,
        })
      ).resolves.toEqual(value);
    });
  });

  it('fails closed on corrupt discard recovery state', async () => {
    await inTemporaryStore(async (rootDir) => {
      const store = new PublisherArtifactStagingStore({ rootDir, isArtifactReferenced: () => false });
      await store.stage(request({ artifactId: 'corrupt-discard-artifact', idempotencyKey: 'corrupt-discard-request' }));
      await writeFile(path.join(rootDir, 'publisher-artifact-discard.v1.json'), '{not-json}', 'utf8');
      const restarted = new PublisherArtifactStagingStore({ rootDir, isArtifactReferenced: () => false });

      await expect(
        restarted.read({
          publisherId: 'com.tomni.publisher',
          subjectId: 'account-123',
          artifactId: 'corrupt-discard-artifact',
        })
      ).rejects.toMatchObject({
        code: 'PUBLISHER_ARTIFACT_STAGING_CORRUPT',
      } satisfies Partial<PublisherArtifactStagingStoreError>);
    });
  });
});
