import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePackageManifest } from '@/common/packages';
import { decideAutomatedPackageReview } from '@process/extensions/package-manager/catalog-federation/validation';
import {
  PublisherSubmissionStore,
  type PublisherSubmissionRequest,
  type PublisherSubmissionStoreError,
} from '@process/services/database/publisherSubmissionStore';

const ARCHIVE_FINGERPRINT = `sha256-${'a'.repeat(64)}`;
const PAYLOAD_FINGERPRINT = `sha256-${'b'.repeat(64)}`;

const manifest = (permissions: readonly string[] = []) =>
  parsePackageManifest({
    schemaVersion: 1,
    id: 'com.tomni.publisher-example',
    publisherId: 'com.tomni.publisher',
    name: 'Publisher Example',
    description: 'A pre-verified publisher submission fixture.',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0 <2.0.0' },
    modules: [
      {
        id: 'main',
        title: 'Main',
        surface: 'publisher/main',
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    contributions: {
      version: 1,
      apps: [{ id: 'main', title: 'Publisher Example', moduleId: 'main' }],
    },
    permissions: [...permissions],
    dependencies: [],
    tags: ['publisher'],
    artifact: {
      integrity: PAYLOAD_FINGERPRINT,
      sizeBytes: 1,
      signature: { algorithm: 'ed25519', keyId: 'publisher-key-1', value: 'dGVzdA==' },
    },
  });

const request = (
  permissions: readonly string[] = [],
  idempotencyKey = 'publisher-submit-1'
): PublisherSubmissionRequest => {
  const verifiedManifest = manifest(permissions);
  return {
    idempotencyKey,
    publisherId: verifiedManifest.publisherId,
    archiveFingerprint: ARCHIVE_FINGERPRINT,
    artifactFingerprint: PAYLOAD_FINGERPRINT,
    manifest: verifiedManifest,
    review: decideAutomatedPackageReview({
      manifest: verifiedManifest,
      inspection: { hasNativeCode: false, aiOperations: [], destinations: [] },
    }),
    submittedAt: '2026-08-20T00:00:00.000Z',
  };
};

const inTemporaryStore = async (operation: (filePath: string) => Promise<void>): Promise<void> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-publisher-submission-'));
  try {
    await operation(path.join(rootDir, 'publisher-submissions.json'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
};

describe('PublisherSubmissionStore', () => {
  it('persists an immutable submission and returns the exact idempotent replay after restart', async () => {
    await inTemporaryStore(async (filePath) => {
      const input = request();
      const first = new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-1' });
      const accepted = await first.submit(input);
      input.manifest.name = 'Mutated after acceptance';

      const restarted = new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-2' });
      const replayed = await restarted.submit(request());

      expect(replayed).toEqual(accepted);
      expect(replayed.manifest.name).toBe('Publisher Example');
      expect(await restarted.list()).toEqual([accepted]);
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
        schemaVersion: 1,
        submissions: [accepted],
        digest: expect.stringMatching(/^sha256-[a-f0-9]{64}$/),
      });
    });
  });

  it('queues a human-review-required submission without claiming any catalog publication', async () => {
    await inTemporaryStore(async (filePath) => {
      const store = new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-human' });
      const accepted = await store.submit(request(['workspace.read']));

      expect(accepted.status).toBe('human-review-required');
      expect(accepted.review.reasons).toContain('PERMISSIONS_REQUIRE_REVIEW');
      expect(accepted.review.findings).toEqual([
        {
          code: 'PERMISSIONS_REQUIRE_REVIEW',
          severity: 'warning',
          evidence: 'The package declares one or more permissions.',
          remediation: 'Request authoritative review for the declared permissions.',
        },
      ]);
      expect(JSON.stringify(accepted.review.findings)).not.toMatch(/sha256|secret|token|key|[\\/]/i);
      expect(accepted).not.toHaveProperty('catalogEntry');
      expect(accepted).not.toHaveProperty('publication');
      expect(await store.list()).toEqual([accepted]);
    });
  });

  it('rejects an idempotency replay that changes immutable evidence', async () => {
    await inTemporaryStore(async (filePath) => {
      const store = new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-1' });
      await store.submit(request());

      await expect(store.submit(request(['workspace.read']))).rejects.toMatchObject({
        code: 'PUBLISHER_SUBMISSION_IDEMPOTENCY_CONFLICT',
      } satisfies Partial<PublisherSubmissionStoreError>);
    });
  });

  it('rejects a Package App submission that does not declare exactly one Surface', async () => {
    await inTemporaryStore(async (filePath) => {
      const store = new PublisherSubmissionStore({ filePath });
      const input = request();
      input.manifest.contributions = { version: 1, apps: [] };

      await expect(store.submit(input)).rejects.toMatchObject({
        code: 'PUBLISHER_SUBMISSION_INVALID',
      } satisfies Partial<PublisherSubmissionStoreError>);
    });
  });

  it('fails closed for oversized or malformed persisted queue documents', async () => {
    await inTemporaryStore(async (filePath) => {
      await writeFile(filePath, 'x'.repeat(1_025), 'utf8');
      const store = new PublisherSubmissionStore({ filePath, maxDocumentBytes: 1_024 });
      await expect(store.list()).rejects.toMatchObject({ code: 'PUBLISHER_SUBMISSION_STORE_CORRUPT' });

      await writeFile(filePath, '{"schemaVersion":1,"submissions":[', 'utf8');
      await expect(store.list()).rejects.toMatchObject({ code: 'PUBLISHER_SUBMISSION_STORE_CORRUPT' });
    });
  });

  it('fails closed when a persisted document duplicates an immutable identity', async () => {
    await inTemporaryStore(async (filePath) => {
      const first = new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-1' });
      await first.submit(request());
      const document = JSON.parse(await readFile(filePath, 'utf8')) as { submissions: unknown[] };
      document.submissions.push(structuredClone(document.submissions[0]));
      await writeFile(filePath, JSON.stringify(document), 'utf8');

      const restarted = new PublisherSubmissionStore({ filePath });
      await expect(restarted.list()).rejects.toMatchObject({ code: 'PUBLISHER_SUBMISSION_STORE_CORRUPT' });
    });
  });
});
