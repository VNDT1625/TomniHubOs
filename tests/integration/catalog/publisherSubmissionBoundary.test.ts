import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePackageManifest, type PackageCatalogEntry, type PackageManifest } from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager';
import { decideAutomatedPackageReview } from '@process/extensions/package-manager/catalog-federation/validation';
import {
  createPublisherSubmissionBoundary,
  type VerifiedStagedPublisherArtifact,
} from '@process/extensions/package-manager/publisherSubmissionBoundary';
import { PublisherSubmissionStore } from '@process/services/database/publisherSubmissionStore';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const artifactFingerprint = (character = 'a'): string => `sha256-${character.repeat(64)}`;

const manifest = (overrides: Partial<PackageManifest> = {}): PackageManifest =>
  parsePackageManifest({
    schemaVersion: 1,
    id: 'com.tomni.publisher-boundary',
    publisherId: 'com.tomni.publisher',
    name: 'Publisher boundary fixture',
    description: 'A signed, staged publisher submission fixture.',
    type: 'app',
    bundleKind: 'single',
    version: '1.0.0',
    engines: { tomni: '>=1.0.0 <2.0.0' },
    modules: [
      {
        id: 'main',
        title: 'Main',
        surface: 'publisher-boundary/main',
        pinnable: true,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    contributions: { version: 1, apps: [{ id: 'main', title: 'Main', moduleId: 'main' }] },
    permissions: [],
    dependencies: [],
    tags: ['publisher'],
    artifact: {
      integrity: artifactFingerprint(),
      sizeBytes: 128,
      signature: { algorithm: 'ed25519', keyId: 'publisher-key', value: 'publisher-signature' },
    },
    ...overrides,
  });

const staged = (fixtureManifest = manifest()): VerifiedStagedPublisherArtifact => ({
  manifest: fixtureManifest,
  archiveFingerprint: artifactFingerprint('b'),
  artifactFingerprint: fixtureManifest.artifact!.integrity,
  inspection: { hasNativeCode: false, aiOperations: [], destinations: [] },
});

const temporaryStore = async (): Promise<PublisherSubmissionStore> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-publisher-boundary-'));
  roots.push(root);
  return new PublisherSubmissionStore({ filePath: path.join(root, 'publisher-submissions.json') });
};

const reviewer = (input: Parameters<typeof decideAutomatedPackageReview>[0]) => decideAutomatedPackageReview(input);

const publisherPrincipal = async () => ({
  publisherId: 'com.tomni.publisher',
  subjectId: 'publisher-subject',
  namespace: 'com.tomni',
  activeSigningKey: { keyId: 'publisher-key', algorithm: 'Ed25519' as const, publicKeyPem: 'test-public-key' },
});

describe('publisher submission boundary', () => {
  it('resolves the current Main-owned publisher for every submission attempt', async () => {
    const resolvePrincipal = vi.fn(publisherPrincipal);
    const verifyAndStage = vi.fn(async () => staged());
    const boundary = createPublisherSubmissionBoundary({
      resolvePrincipal,
      verifyAndStage,
      automatedReviewer: reviewer,
      submissionStore: await temporaryStore(),
    });

    await boundary.submit({ idempotencyKey: 'submission-first', artifactId: 'artifact-1' });
    await boundary.submit({ idempotencyKey: 'submission-second', artifactId: 'artifact-2' });

    expect(resolvePrincipal).toHaveBeenCalledTimes(2);
    expect(verifyAndStage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ principal: await publisherPrincipal() })
    );
    expect(verifyAndStage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ principal: await publisherPrincipal() })
    );
  });

  it('fails closed when the authenticated publisher does not match the staged manifest', async () => {
    const verifyAndStage = vi.fn(async () => staged(manifest({ publisherId: 'com.tomni.other' })));
    const boundary = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage,
      automatedReviewer: reviewer,
      submissionStore: await temporaryStore(),
    });

    await expect(boundary.submit({ idempotencyKey: 'submission-1', artifactId: 'artifact-1' })).rejects.toMatchObject({
      code: 'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED',
    });
    expect(verifyAndStage).toHaveBeenCalledOnce();
  });

  it('does not enqueue when artifact verification or staging fails', async () => {
    const store = await temporaryStore();
    const boundary = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => {
        throw new Error('signature verification failed');
      },
      automatedReviewer: reviewer,
      submissionStore: store,
    });

    await expect(boundary.submit({ idempotencyKey: 'submission-1', artifactId: 'artifact-1' })).rejects.toMatchObject({
      code: 'PUBLISHER_SUBMISSION_ARTIFACT_REJECTED',
    });
    await expect(store.list()).resolves.toEqual([]);
  });

  it('derives durable automated and human-review outcomes without catalog publication', async () => {
    const autoStore = await temporaryStore();
    const auto = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => staged(),
      automatedReviewer: reviewer,
      submissionStore: autoStore,
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });
    const automated = await auto.submit({ idempotencyKey: 'submission-auto', artifactId: 'artifact-auto' });

    const humanStore = await temporaryStore();
    const human = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => staged(manifest({ permissions: ['workspace.read'] })),
      automatedReviewer: reviewer,
      submissionStore: humanStore,
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });
    const manual = await human.submit({ idempotencyKey: 'submission-human', artifactId: 'artifact-human' });

    expect(automated.status).toBe('auto-approved');
    expect(automated.review).toEqual({ disposition: 'auto-approved', findings: [] });
    expect(manual.status).toBe('human-review-required');
    expect(manual.review.findings[0]).toMatchObject({
      code: 'PERMISSIONS_REQUIRE_REVIEW',
      severity: 'warning',
      evidence: 'The package declares one or more permissions.',
    });
    expect(manual).not.toHaveProperty('catalogEntry');
    expect(manual).not.toHaveProperty('publication');
    await expect(autoStore.list()).resolves.toHaveLength(1);
    await expect(humanStore.list()).resolves.toHaveLength(1);
  });

  it('rejects a structurally valid auto-approval that bypasses the deterministic privileged review floor', async () => {
    const submissionStore = await temporaryStore();
    const boundary = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => staged(manifest({ permissions: ['workspace.write'] })),
      automatedReviewer: async () => ({
        disposition: 'auto-approved',
        fingerprint: artifactFingerprint('c'),
        reasons: [],
        findings: [],
      }),
      submissionStore,
    });

    await expect(
      boundary.submit({
        idempotencyKey: 'submission-forged-auto-approval',
        artifactId: 'artifact-forged-auto-approval',
      })
    ).rejects.toMatchObject({ code: 'PUBLISHER_SUBMISSION_REVIEW_INVALID' });
    await expect(submissionStore.list()).resolves.toEqual([]);
  });

  it('keeps signed AI and egress submissions out of automatic publication and activation while a low-risk submission advances', async () => {
    const lowRisk = manifest({ id: 'com.tomni.publisher-boundary.low-risk' });
    const guarded = manifest({ id: 'com.tomni.publisher-boundary.ai-egress' });
    const submissionStore = await temporaryStore();
    const boundary = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async ({ artifactId }) =>
        artifactId === 'artifact-low-risk'
          ? staged(lowRisk)
          : {
              ...staged(guarded),
              inspection: {
                hasNativeCode: false,
                aiOperations: ['workspace-summary'],
                destinations: ['https://api.example.test'],
              },
            },
      automatedReviewer: reviewer,
      submissionStore,
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });

    const approved = await boundary.submit({ idempotencyKey: 'submission-low-risk', artifactId: 'artifact-low-risk' });
    const heldForReview = await boundary.submit({
      idempotencyKey: 'submission-ai-egress',
      artifactId: 'artifact-ai-egress',
    });

    expect(approved).toMatchObject({ status: 'auto-approved', review: { disposition: 'auto-approved', findings: [] } });
    expect(heldForReview).toMatchObject({
      status: 'human-review-required',
      review: {
        disposition: 'human-review-required',
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'AI_OPERATIONS_REQUIRE_REVIEW' }),
          expect.objectContaining({ code: 'DESTINATIONS_REQUIRE_REVIEW' }),
        ]),
      },
    });
    expect(heldForReview).not.toHaveProperty('catalogEntry');
    expect(heldForReview).not.toHaveProperty('publication');
    await expect(submissionStore.list()).resolves.toHaveLength(2);

    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-publisher-boundary-review-'));
    roots.push(root);
    const service = createPackageManagerService({
      rootDir: root,
      appVersion: '1.0.0',
      catalog: [
        {
          manifest: lowRisk,
          delivery: 'downloaded-package',
          trust: 'signed-store',
          artifactUrl: 'https://store.example/com.tomni.publisher-boundary.low-risk-1.0.0.tomny',
          publicationReview: {
            schemaVersion: 1,
            disposition: 'auto-approved',
            fingerprint: approved.reviewFingerprint,
            reviewedAt: approved.submittedAt,
          },
        },
      ],
    });
    await service.initialize();

    await expect(service.status(lowRisk.id)).resolves.toMatchObject({ state: 'available', enabled: false });
    await expect(service.status(guarded.id)).rejects.toThrow(/Unknown package/i);
    await expect(service.install(guarded.id)).rejects.toThrow(/Unknown package/i);
    expect((await service.contributions()).snapshot.apps).toEqual([]);
  });

  it('keeps an auto-approved submission non-activatable when the Store revokes its exact artifact before install', async () => {
    const candidate = manifest();
    const boundary = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => staged(candidate),
      automatedReviewer: reviewer,
      submissionStore: await temporaryStore(),
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });
    const submission = await boundary.submit({ idempotencyKey: 'submission-revoked', artifactId: 'artifact-revoked' });
    const catalogEntry: PackageCatalogEntry = {
      manifest: candidate,
      delivery: 'downloaded-package',
      trust: 'signed-store',
      artifactUrl: 'https://store.example/com.tomni.publisher-boundary-1.0.0.tomny',
      publicationReview: {
        schemaVersion: 1,
        disposition: 'auto-approved',
        fingerprint: submission.reviewFingerprint,
        reviewedAt: submission.submittedAt,
      },
      revocation: {
        schemaVersion: 1,
        reasonCode: 'MALWARE_DETECTED',
        revokedAt: '2026-08-20T00:01:00.000Z',
      },
    };
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-revoked-submission-'));
    roots.push(root);
    const service = createPackageManagerService({ rootDir: root, appVersion: '1.0.0', catalog: [catalogEntry] });
    await service.initialize();

    expect(submission.status).toBe('auto-approved');
    await expect(service.status(candidate.id)).resolves.toMatchObject({ revoked: true, enabled: false });
    await expect(service.install(candidate.id)).rejects.toThrow(/revoked by the Store catalog/i);
    expect((await service.contributions()).snapshot.apps).toEqual([]);
  });

  it('returns an exact durable replay after restart and rejects changed staged evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-publisher-boundary-replay-'));
    roots.push(root);
    const filePath = path.join(root, 'publisher-submissions.json');
    const firstStore = new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-1' });
    const first = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => staged(),
      automatedReviewer: reviewer,
      submissionStore: firstStore,
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });
    const accepted = await first.submit({ idempotencyKey: 'submission-replay', artifactId: 'artifact-1' });
    const [stored] = await firstStore.list();
    expect(accepted).toMatchObject({
      archiveFingerprint: artifactFingerprint('b'),
      artifactFingerprint: artifactFingerprint(),
    });
    expect(stored).toMatchObject({
      archiveFingerprint: artifactFingerprint('b'),
      artifactFingerprint: artifactFingerprint(),
    });

    const restarted = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () => staged(),
      automatedReviewer: reviewer,
      submissionStore: new PublisherSubmissionStore({ filePath, createSubmissionId: () => 'submission-2' }),
      now: () => new Date('2026-08-21T00:00:00.000Z'),
    });
    await expect(restarted.submit({ idempotencyKey: 'submission-replay', artifactId: 'artifact-1' })).resolves.toEqual(
      accepted
    );

    const changed = createPublisherSubmissionBoundary({
      resolvePrincipal: publisherPrincipal,
      verifyAndStage: async () =>
        staged(
          manifest({ version: '1.0.1', artifact: { ...manifest().artifact!, integrity: artifactFingerprint('b') } })
        ),
      automatedReviewer: reviewer,
      submissionStore: new PublisherSubmissionStore({ filePath }),
    });
    await expect(
      changed.submit({ idempotencyKey: 'submission-replay', artifactId: 'artifact-2' })
    ).rejects.toMatchObject({
      code: 'PUBLISHER_SUBMISSION_IDEMPOTENCY_CONFLICT',
    });
  });
});
