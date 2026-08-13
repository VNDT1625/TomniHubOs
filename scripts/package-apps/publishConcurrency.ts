import { createHash } from 'node:crypto';
import type { PackageCatalogEntry, PackageManifest } from '../../packages/desktop/src/common/packages/index.js';

export const PUBLISH_LOCK_ASSET_NAME = 'tomni-store-publish.lock.json';

export type PublishLockLease = {
  assetId: number;
};

export type StorePublisherIdentity = {
  login: string;
  repositoryPermission: string;
};

export type StagedReleasePublishAdapter = {
  stageArtifact: () => Promise<void>;
  verifyStagedArtifact: () => Promise<void>;
  promoteArtifact: () => Promise<void>;
  verifyPromotedArtifact: () => Promise<void>;
  publishCatalog: () => Promise<void>;
  /**
   * Return true when a failed catalog request may nevertheless have committed.
   * The final artifact must then remain available so a catalog never points to
   * deleted bytes after an ambiguous network or provider failure.
   */
  catalogMayBeVisibleAfterFailure: () => Promise<boolean>;
  discardStagedArtifact: () => Promise<void>;
  discardPromotedArtifact: () => Promise<void>;
};

export type PublishLockAdapter<Lease = void> = {
  acquire: () => Promise<Lease>;
  release: (lease: Lease) => Promise<void>;
};

type GitHubReleaseAsset = {
  id: number;
  name: string;
  state: string;
  size: number;
  digest: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseReleaseAsset = (value: unknown): GitHubReleaseAsset | undefined => {
  if (!isRecord(value)) return undefined;
  const { id, name, state, size, digest } = value;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof name !== 'string' ||
    typeof state !== 'string' ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    typeof digest !== 'string'
  ) {
    return undefined;
  }
  return { id, name, state, size, digest };
};

/**
 * Resolve the immutable GitHub asset ID only when its server metadata proves
 * that it is the exact lock payload uploaded by this publisher.
 */
export const selectOwnedPublishLockAsset = (
  releaseValue: unknown,
  expectedDigest: string,
  expectedSize: number
): PublishLockLease => {
  if (!/^sha256:[a-f0-9]{64}$/i.test(expectedDigest) || !Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw new Error('Store publish lock ownership expectations are invalid.');
  }
  if (!isRecord(releaseValue) || !Array.isArray(releaseValue.assets)) {
    throw new Error('GitHub Release metadata is missing its asset list.');
  }

  const namedAssets = releaseValue.assets
    .map(parseReleaseAsset)
    .filter((asset): asset is GitHubReleaseAsset => asset?.name === PUBLISH_LOCK_ASSET_NAME);
  const ownedAssets = namedAssets.filter(
    (asset) =>
      asset.state === 'uploaded' &&
      asset.size === expectedSize &&
      asset.digest.toLowerCase() === expectedDigest.toLowerCase()
  );
  if (ownedAssets.length === 0) {
    if (namedAssets.length === 0) {
      throw new Error('The uploaded Store publish lock is absent from GitHub Release metadata.');
    }
    throw new Error('The current Store publish lock does not belong to this publisher.');
  }
  if (ownedAssets.length !== 1) {
    throw new Error('GitHub Release metadata must contain exactly one matching Store publish lock.');
  }
  return { assetId: ownedAssets[0]!.id };
};

export type ReleaseAssetExpectation = {
  name: string;
  digest: string;
  size: number;
};

/** Verify a staged or promoted release asset against immutable server metadata. */
export const selectOwnedReleaseAsset = (
  releaseValue: unknown,
  { name, digest, size }: ReleaseAssetExpectation
): PublishLockLease => {
  if (!name.trim() || !/^sha256:[a-f0-9]{64}$/i.test(digest) || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('Store release asset ownership expectations are invalid.');
  }
  if (!isRecord(releaseValue) || !Array.isArray(releaseValue.assets)) {
    throw new Error('GitHub Release metadata is missing its asset list.');
  }
  const namedAssets = releaseValue.assets
    .map(parseReleaseAsset)
    .filter((asset): asset is GitHubReleaseAsset => asset?.name === name);
  const ownedAssets = namedAssets.filter(
    (asset) => asset.state === 'uploaded' && asset.size === size && asset.digest.toLowerCase() === digest.toLowerCase()
  );
  if (ownedAssets.length === 0) {
    if (namedAssets.length === 0) {
      throw new Error(`The uploaded Store release asset ${name} is absent from GitHub Release metadata.`);
    }
    throw new Error(`The current Store release asset ${name} does not belong to this publisher.`);
  }
  if (ownedAssets.length !== 1) {
    throw new Error(`GitHub Release metadata must contain exactly one matching Store release asset ${name}.`);
  }
  return { assetId: ownedAssets[0]!.id };
};

/** Serialize publishers through a remote lock whose acquire operation must be atomic. */
export const withPublishLock = async <T, Lease = void>(
  adapter: PublishLockAdapter<Lease>,
  operation: () => Promise<T>
): Promise<T> => {
  const lease = await adapter.acquire();
  let result: T;
  try {
    result = await operation();
  } catch (operationError) {
    try {
      await adapter.release(lease);
    } catch (releaseError) {
      throw new AggregateError(
        [operationError, releaseError],
        'Store publish failed and its remote lock could not be released.'
      );
    }
    throw operationError;
  }
  await adapter.release(lease);
  return result;
};

/**
 * Promote a verified staging asset before publishing its catalog reference.
 * A catalog is therefore the only public discovery point. Any failure before
 * that commit removes the promoted bytes in reverse order, unless the catalog
 * provider reports an ambiguous commit outcome.
 */
export const publishStagedRelease = async ({
  stageArtifact,
  verifyStagedArtifact,
  promoteArtifact,
  verifyPromotedArtifact,
  publishCatalog,
  catalogMayBeVisibleAfterFailure,
  discardStagedArtifact,
  discardPromotedArtifact,
}: StagedReleasePublishAdapter): Promise<void> => {
  let staged = false;
  let promoted = false;
  let catalogPublishAttempted = false;

  try {
    await stageArtifact();
    staged = true;
    await verifyStagedArtifact();
    await promoteArtifact();
    promoted = true;
    await verifyPromotedArtifact();
    catalogPublishAttempted = true;
    await publishCatalog();
  } catch (publishError) {
    const cleanupErrors: unknown[] = [];
    let preservePromotedArtifact = false;
    if (promoted && catalogPublishAttempted) {
      try {
        preservePromotedArtifact = await catalogMayBeVisibleAfterFailure();
      } catch {
        preservePromotedArtifact = true;
      }
    }
    if (promoted && !preservePromotedArtifact) {
      try {
        await discardPromotedArtifact();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (staged) {
      try {
        await discardStagedArtifact();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (preservePromotedArtifact) {
      cleanupErrors.push(
        new Error('Store catalog commit is uncertain; the promoted artifact was retained for manual verification.')
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [publishError, ...cleanupErrors],
        'Store staged publish failed and cleanup is incomplete.'
      );
    }
    throw publishError;
  }

  try {
    await discardStagedArtifact();
  } catch (cleanupError) {
    throw new AggregateError(
      [cleanupError],
      'Store package is published, but the staging artifact could not be removed.'
    );
  }
};

const GITHUB_LOGIN = /^(?=.{1,39}$)[A-Za-z\d](?:[A-Za-z\d-]*[A-Za-z\d])?$/;
const WRITABLE_REPOSITORY_PERMISSIONS = new Set(['admin', 'maintain', 'write']);
const STORE_RELEASE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}\.tomny$/;

const normalizedGitHubLogin = (value: string, label: string): string => {
  const login = value.trim();
  if (!GITHUB_LOGIN.test(login)) throw new Error(`${label} must be a valid GitHub login.`);
  return login.toLowerCase();
};

/** Parse the fail-closed publisher-to-release-operator ownership policy. */
export const parseStorePublisherOwners = (serialized: string | undefined): Readonly<Record<string, string>> => {
  if (!serialized?.trim()) {
    throw new Error('Store publishing requires TOMNI_STORE_PUBLISHER_OWNERS to declare each publisher owner.');
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error('TOMNI_STORE_PUBLISHER_OWNERS must be a JSON object.', { cause: error });
  }
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('TOMNI_STORE_PUBLISHER_OWNERS must be a non-empty JSON object.');
  }
  const owners: Record<string, string> = {};
  for (const [publisherId, owner] of Object.entries(value)) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(publisherId) || typeof owner !== 'string') {
      throw new Error('TOMNI_STORE_PUBLISHER_OWNERS contains an invalid publisher ownership entry.');
    }
    owners[publisherId] = normalizedGitHubLogin(owner, `Owner for ${publisherId}`);
  }
  return Object.freeze(owners);
};

/** Require a repository writer whose authenticated login owns the package publisher namespace. */
export const assertStorePublisherAuthorized = (
  manifest: Pick<PackageManifest, 'publisherId'>,
  identity: StorePublisherIdentity,
  publisherOwners: Readonly<Record<string, string>>
): void => {
  const actor = normalizedGitHubLogin(identity.login, 'Authenticated publisher');
  const permission = identity.repositoryPermission.trim().toLowerCase();
  if (!WRITABLE_REPOSITORY_PERMISSIONS.has(permission)) {
    throw new Error('Authenticated publisher does not have write permission for the Store repository.');
  }
  const owner = publisherOwners[manifest.publisherId];
  if (!owner) throw new Error(`No Store publisher owner is configured for ${manifest.publisherId}.`);
  if (actor !== owner) {
    throw new Error(`Authenticated publisher ${actor} does not own the ${manifest.publisherId} Store namespace.`);
  }
};

/** The account-free catalog is intentionally public; never route private bytes into it. */
export const assertPublicStoreVisibility = (requestedVisibility: string | undefined): void => {
  const visibility = (requestedVisibility ?? 'public').trim().toLowerCase();
  if (visibility !== 'public') {
    throw new Error('Private Store publishing is not supported by the account-free public catalog.');
  }
};

/** Generate a non-discoverable staging asset name without accepting shell or URL delimiters. */
export const createStagedReleaseAssetName = (artifactName: string, attemptId: string): string => {
  if (!STORE_RELEASE_ASSET_NAME.test(artifactName)) {
    throw new Error('Store artifact filename must be a safe .tomny release asset name.');
  }
  const normalizedAttemptId = attemptId.replaceAll('-', '').toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(normalizedAttemptId)) {
    throw new Error('Store staging attempt ID must be a UUID or hexadecimal identifier.');
  }
  return `tomni-stage-${normalizedAttemptId}-${artifactName}`;
};

/** Stable identity for the exact verified package set read before a catalog update. */
export const computePublishCatalogIdentity = (packages: readonly PackageCatalogEntry[]): string => {
  const canonical = packages
    .toSorted((left, right) => left.manifest.id.localeCompare(right.manifest.id))
    .map((entry) => JSON.stringify(entry))
    .join('\n');
  return `sha256-${createHash('sha256').update(canonical).digest('hex')}`;
};

/** Fail instead of overwriting entries published after this publisher's verified read. */
export const assertPublishCatalogUnchanged = (
  expectedIdentity: string,
  currentPackages: readonly PackageCatalogEntry[]
): void => {
  if (computePublishCatalogIdentity(currentPackages) !== expectedIdentity) {
    throw new Error('Store catalog changed during publish; aborting to prevent a lost update.');
  }
};
