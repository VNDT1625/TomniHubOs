#!/usr/bin/env bun
/**
 * Upload a signed .tomny artifact through a verified staging release asset and
 * atomically republish the public Store catalog.
 *
 * Usage: bun run store:publish -- <artifact.tomny>
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { loadPublishCatalogDocument, mergePublishCatalog } from './publishCatalog.js';
import {
  assertPublicStoreVisibility,
  assertPublishCatalogUnchanged,
  assertStorePublisherAuthorized,
  computePublishCatalogIdentity,
  createStagedReleaseAssetName,
  parseStorePublisherOwners,
  PUBLISH_LOCK_ASSET_NAME,
  publishStagedRelease,
  selectOwnedReleaseAsset,
  withPublishLock,
} from './publishConcurrency.js';
import {
  DEFAULT_PACKAGE_CATALOG_URL,
  FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
  parsePackageManifest,
  type PackageCatalogEntry,
  type PackageManifest,
  type PackagePublicationReview,
} from '../../packages/desktop/src/common/packages/index.js';
import { verifyArtifactSignature } from '../../packages/desktop/src/process/extensions/package-manager/artifactSecurity.js';
import {
  parseRemotePackageCatalog,
  signRemotePackageCatalog,
  type RemotePackageCatalogDocument,
} from '../../packages/desktop/src/process/extensions/package-manager/remoteCatalog.js';
import {
  decideAutomatedPackageReview,
  type AutomatedPackageReviewDecision,
} from '../../packages/desktop/src/process/extensions/package-manager/catalog-federation/validation.js';

const isPublishEntrypoint =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
const args = isPublishEntrypoint ? process.argv.slice(2) : [];
const artifactArgument = args.find((value) => !value.startsWith('--'));
const bootstrap = args.includes('--bootstrap');
if (isPublishEntrypoint && !artifactArgument) throw new Error('Usage: bun run store:publish -- <artifact.tomny>');

const repository = process.env.TOMNI_STORE_REPOSITORY ?? 'VNDT1625/tomni-hub-agent-os';
const releaseTag = process.env.TOMNI_STORE_RELEASE_TAG ?? 'tomni-store-v1';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('TOMNI_STORE_REPOSITORY must be an owner/repository identifier.');
}
if (!/^[A-Za-z0-9_.-]{1,128}$/.test(releaseTag)) {
  throw new Error('TOMNI_STORE_RELEASE_TAG must be a safe release tag.');
}
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${releaseTag}`;
const artifactPath = artifactArgument ? path.resolve(artifactArgument) : '';
if (isPublishEntrypoint && !path.basename(artifactPath).endsWith('.tomny'))
  throw new Error('Store publisher expects a .tomny artifact.');

const runGh = (commandArgs: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'gh.exe' : 'gh', commandArgs, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`gh exited with status ${code}.`))));
  });

const runGhOutput = (commandArgs: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'gh.exe' : 'gh', commandArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
        return;
      }
      reject(new Error(`gh exited with status ${code}.`));
    });
  });

type VerifiedArtifact = {
  manifest: PackageManifest;
  releaseAsset: { digest: string; size: number };
  reviewEntries: readonly PackageReviewArchiveEntry[];
};

type PackageReviewArchiveEntry = Readonly<{
  name: string;
  content: Uint8Array;
}>;

const STATIC_PAYLOAD_FILE = /\.(?:css|html?|ico|jpe?g|png|webp|gif|svg|woff2?|txt|md|json)$/i;
const TEXT_STATIC_PAYLOAD_FILE = /\.(?:css|html?|svg|txt|md|json)$/i;
const DYNAMIC_OR_EGRESS_STATIC_CONTENT =
  /(?:<\s*(?:script|form|iframe|object|embed|link)\b|@import\b|url\s*\(|\b(?:https?|wss?|data|javascript|file):|["']\s*\/\/)/i;

/**
 * The publication command auto-approves only a deliberately tiny, statically
 * inspectable package subset. Anything not proven static is sent to review.
 */
export const inspectPackageArtifactForAutomatedReview = (
  entries: readonly PackageReviewArchiveEntry[]
): Readonly<{
  hasNativeCode: boolean | 'unknown';
  aiOperations: readonly string[] | 'unknown';
  destinations: readonly string[] | 'unknown';
}> => {
  for (const entry of entries) {
    if (!STATIC_PAYLOAD_FILE.test(entry.name)) {
      return { hasNativeCode: 'unknown', aiOperations: 'unknown', destinations: 'unknown' };
    }
    if (
      TEXT_STATIC_PAYLOAD_FILE.test(entry.name) &&
      DYNAMIC_OR_EGRESS_STATIC_CONTENT.test(Buffer.from(entry.content).toString('utf8'))
    ) {
      return { hasNativeCode: false, aiOperations: 'unknown', destinations: 'unknown' };
    }
  }
  return { hasNativeCode: false, aiOperations: [], destinations: [] };
};

/**
 * A human review override is accepted only when the reviewer supplied the
 * exact immutable decision fingerprint for this artifact.
 */
export const assertPackageAppSurfaceForPublication = (manifest: PackageManifest): void => {
  if (manifest.type !== 'app') return;
  const surfaces = manifest.contributions?.apps ?? [];
  if (surfaces.length !== 1 || !manifest.modules.some((module) => module.id === surfaces[0]?.moduleId)) {
    throw new Error('A Package App publication must declare exactly one module-backed Surface.');
  }
};

export const assertPackageArtifactApprovedForPublication = (
  manifest: PackageManifest,
  entries: readonly PackageReviewArchiveEntry[],
  reviewerApprovalFingerprint: string | undefined
): AutomatedPackageReviewDecision => {
  assertPackageAppSurfaceForPublication(manifest);
  const decision = decideAutomatedPackageReview({
    manifest,
    inspection: inspectPackageArtifactForAutomatedReview(entries),
    priorApprovalFingerprint: reviewerApprovalFingerprint,
  });
  if (decision.disposition === 'auto-approved' || reviewerApprovalFingerprint === decision.fingerprint) return decision;

  const reasons = decision.reasons.join(', ') || 'NO_AUTOMATED_APPROVAL';
  throw new Error(
    `Store publication requires automated approval or an explicit reviewer approval for fingerprint ${decision.fingerprint}. Reasons: ${reasons}.`
  );
};

/**
 * The catalog signer attests to this record together with the exact manifest
 * and review fingerprint. A human identity is mandatory whenever automated
 * review did not approve the artifact.
 */
export const createPublicationReviewRecord = (
  decision: AutomatedPackageReviewDecision,
  artifactIntegrity: string,
  reviewedAt: string,
  reviewerId: string | undefined
): PackagePublicationReview => {
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error('Store publication review time is invalid.');
  if (!/^sha256-[a-f0-9]{64}$/.test(artifactIntegrity)) {
    throw new Error('Store publication review needs the exact artifact integrity.');
  }
  if (decision.disposition === 'auto-approved') {
    return {
      schemaVersion: 2,
      disposition: 'auto-approved',
      fingerprint: decision.fingerprint,
      artifactIntegrity,
      reviewedAt,
    };
  }
  const normalizedReviewerId = reviewerId?.trim();
  if (!normalizedReviewerId || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$/.test(normalizedReviewerId)) {
    throw new Error('Human Store publication review requires a valid reviewer identity.');
  }
  return {
    schemaVersion: 2,
    disposition: 'human-approved',
    fingerprint: decision.fingerprint,
    artifactIntegrity,
    reviewedAt,
    reviewerId: normalizedReviewerId,
  };
};

const readAndVerifyArtifact = async (): Promise<VerifiedArtifact> => {
  const artifactBytes = await readFile(artifactPath);
  const archive = await JSZip.loadAsync(artifactBytes);
  const manifestEntry = archive.file('tomny-package.json');
  if (!manifestEntry) throw new Error('Artifact does not contain tomny-package.json.');
  const manifest = parsePackageManifest(JSON.parse(await manifestEntry.async('string')) as unknown);
  verifyArtifactSignature(manifest, FIRST_PARTY_PACKAGE_TRUSTED_KEYS);

  const files = Object.values(archive.files)
    .filter((entry) => !entry.dir && entry.name !== 'tomny-package.json')
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const payloadHash = createHash('sha256');
  let sizeBytes = 0;
  const reviewEntries: PackageReviewArchiveEntry[] = [];
  for (const entry of files) {
    const content = await entry.async('nodebuffer');
    payloadHash.update(entry.name);
    payloadHash.update('\0');
    payloadHash.update(content);
    payloadHash.update('\0');
    sizeBytes += content.byteLength;
    reviewEntries.push({ name: entry.name, content });
  }
  if (
    manifest.artifact?.sizeBytes !== sizeBytes ||
    manifest.artifact.integrity !== `sha256-${payloadHash.digest('hex')}`
  ) {
    throw new Error('Artifact payload does not match its signed integrity declaration.');
  }
  return {
    manifest,
    releaseAsset: {
      digest: `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`,
      size: artifactBytes.byteLength,
    },
    reviewEntries,
  };
};

const resolveCatalogSigning = async (manifest: PackageManifest): Promise<{ keyId: string; privateKey: string }> => {
  const keyId = (process.env.TOMNI_STORE_CATALOG_SIGNING_KEY_ID ?? manifest.artifact?.signature.keyId ?? '').trim();
  const privateKeyPath = (
    process.env.TOMNI_STORE_CATALOG_SIGNING_PRIVATE_KEY_PATH ??
    process.env.TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH ??
    ''
  ).trim();
  if (!keyId || !privateKeyPath) {
    throw new Error(
      'Catalog signing requires TOMNI_STORE_CATALOG_SIGNING_KEY_ID and TOMNI_STORE_CATALOG_SIGNING_PRIVATE_KEY_PATH (or the package-signing private-key path).'
    );
  }
  if (!FIRST_PARTY_PACKAGE_TRUSTED_KEYS[keyId]) {
    throw new Error(`Catalog signing key ${keyId} is not in the application trust policy.`);
  }
  return { keyId, privateKey: await readFile(path.resolve(privateKeyPath), 'utf8') };
};

const nextRevision = (currentRevision: number | undefined): number => {
  const revision = (currentRevision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error('Store catalog revision has reached its safe integer limit.');
  return revision;
};

const uploadReleaseAsset = async (sourcePath: string, name: string, clobber = false): Promise<void> => {
  if (sourcePath.includes('#'))
    throw new Error('Store artifact paths cannot contain # while uploading a named release asset.');
  await runGh([
    'release',
    'upload',
    releaseTag,
    `${sourcePath}#${name}`,
    '--repo',
    repository,
    ...(clobber ? ['--clobber'] : []),
  ]);
};

const selectReleaseAsset = async (name: string, expected: VerifiedArtifact['releaseAsset']): Promise<number> => {
  let release: unknown;
  try {
    release = JSON.parse(
      await runGhOutput(['release', 'view', releaseTag, '--repo', repository, '--json', 'assets'])
    ) as unknown;
  } catch (error) {
    throw new Error(`Store release asset ${name} could not be verified from GitHub metadata.`, { cause: error });
  }
  return selectOwnedReleaseAsset(release, { name, digest: expected.digest, size: expected.size }).assetId;
};

const deleteReleaseAsset = async (assetId: number): Promise<void> =>
  runGh(['api', '--method', 'DELETE', `repos/${repository}/releases/assets/${assetId}`]);

const authenticatedPublisher = async (): Promise<{ login: string; repositoryPermission: string }> => {
  const login = (await runGhOutput(['api', 'user', '--jq', '.login'])).trim();
  const repositoryPermission = (
    await runGhOutput([
      'api',
      `repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`,
      '--jq',
      '.permission',
    ])
  ).trim();
  return { login, repositoryPermission };
};

const catalogMatches = (
  candidate: RemotePackageCatalogDocument | undefined,
  expected: RemotePackageCatalogDocument
): boolean =>
  candidate?.revision === expected.revision &&
  candidate.signature.keyId === expected.signature.keyId &&
  candidate.signature.value === expected.signature.value;

const main = async (): Promise<void> => {
  const verifiedArtifact = await readAndVerifyArtifact();
  const { manifest, releaseAsset, reviewEntries } = verifiedArtifact;
  const reviewDecision = assertPackageArtifactApprovedForPublication(
    manifest,
    reviewEntries,
    process.env.TOMNI_STORE_REVIEWER_APPROVAL_FINGERPRINT?.trim() || undefined
  );
  const publicationReview = createPublicationReviewRecord(
    reviewDecision,
    manifest.artifact?.integrity ?? '',
    new Date().toISOString(),
    process.env.TOMNI_STORE_REVIEWER_ID
  );
  assertPublicStoreVisibility(process.env.TOMNI_STORE_VISIBILITY);
  const artifactName = `${manifest.id}-${manifest.version}.tomny`;
  if (path.basename(artifactPath) !== artifactName) {
    throw new Error(`Store artifact must be named ${artifactName} to keep its release URL deterministic.`);
  }
  const publisherOwners = parseStorePublisherOwners(process.env.TOMNI_STORE_PUBLISHER_OWNERS);
  assertStorePublisherAuthorized(manifest, await authenticatedPublisher(), publisherOwners);
  const catalogSigning = await resolveCatalogSigning(manifest);
  const catalogUrl = process.env.TOMNI_STORE_CATALOG_URL ?? DEFAULT_PACKAGE_CATALOG_URL;
  const parseCatalog = (value: unknown): RemotePackageCatalogDocument =>
    parseRemotePackageCatalog(value, FIRST_PARTY_PACKAGE_TRUSTED_KEYS, FIRST_PARTY_PACKAGE_SIGNING_POLICIES);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'tomny-store-publish-'));
  const catalogPath = path.join(temporaryDirectory, 'catalog.json');
  const lockPath = path.join(temporaryDirectory, PUBLISH_LOCK_ASSET_NAME);
  await writeFile(
    lockPath,
    `${JSON.stringify({ schemaVersion: 1, artifactName, processId: process.pid, startedAt: new Date().toISOString() })}\n`
  );

  try {
    await withPublishLock(
      {
        acquire: async () => {
          try {
            await runGh(['release', 'upload', releaseTag, lockPath, '--repo', repository]);
          } catch (error) {
            throw new Error(
              `Store publish lock ${PUBLISH_LOCK_ASSET_NAME} could not be acquired; another publisher may be active.`,
              { cause: error }
            );
          }
        },
        release: () =>
          runGh(['release', 'delete-asset', releaseTag, PUBLISH_LOCK_ASSET_NAME, '--repo', repository, '--yes']),
      },
      async () => {
        const currentCatalog = await loadPublishCatalogDocument({ url: catalogUrl, bootstrap, parse: parseCatalog });
        const currentPackages = currentCatalog ? [...currentCatalog.packages] : [];
        const expectedCatalogIdentity = computePublishCatalogIdentity(currentPackages);
        const expectedRevision = currentCatalog?.revision;
        const catalogEntry: PackageCatalogEntry = {
          delivery: 'downloaded-package',
          trust: manifest.publisherId === 'com.tomni' ? 'signed-first-party' : 'signed-store',
          artifactUrl: `${releaseBaseUrl}/${encodeURIComponent(artifactName)}`,
          manifest,
          publicationReview,
        };
        const issuedAt = new Date();
        const document = signRemotePackageCatalog(
          {
            schemaVersion: 1,
            revision: nextRevision(expectedRevision),
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
            packages: mergePublishCatalog(currentPackages, catalogEntry),
          },
          catalogSigning.keyId,
          catalogSigning.privateKey
        );
        parseCatalog(document);
        await writeFile(catalogPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });

        const stagedAssetName = createStagedReleaseAssetName(artifactName, randomUUID());
        let stagedAssetId: number | undefined;
        let promotedAssetId: number | undefined;
        await publishStagedRelease({
          stageArtifact: () => uploadReleaseAsset(artifactPath, stagedAssetName),
          verifyStagedArtifact: async () => {
            stagedAssetId = await selectReleaseAsset(stagedAssetName, releaseAsset);
          },
          promoteArtifact: () => uploadReleaseAsset(artifactPath, artifactName),
          verifyPromotedArtifact: async () => {
            promotedAssetId = await selectReleaseAsset(artifactName, releaseAsset);
          },
          publishCatalog: async () => {
            const latestCatalog = await loadPublishCatalogDocument({ url: catalogUrl, bootstrap, parse: parseCatalog });
            const latestPackages = latestCatalog ? [...latestCatalog.packages] : [];
            assertPublishCatalogUnchanged(expectedCatalogIdentity, latestPackages);
            if (latestCatalog?.revision !== expectedRevision) {
              throw new Error('Store catalog revision changed during publish; aborting to prevent a lost update.');
            }
            await uploadReleaseAsset(catalogPath, 'catalog.json', true);
          },
          catalogMayBeVisibleAfterFailure: async () => {
            try {
              return catalogMatches(
                await loadPublishCatalogDocument({ url: catalogUrl, bootstrap, parse: parseCatalog }),
                document
              );
            } catch {
              return true;
            }
          },
          discardStagedArtifact: async () => {
            if (stagedAssetId === undefined)
              throw new Error('Staged Store artifact cannot be deleted without server metadata.');
            await deleteReleaseAsset(stagedAssetId);
          },
          discardPromotedArtifact: async () => {
            if (promotedAssetId === undefined)
              throw new Error('Promoted Store artifact cannot be deleted without server metadata.');
            await deleteReleaseAsset(promotedAssetId);
          },
        });
      }
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(`Published ${manifest.id}@${manifest.version}`);
  console.log(`Catalog: ${catalogUrl}`);
};

if (isPublishEntrypoint) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
