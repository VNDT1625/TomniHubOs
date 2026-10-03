import type {
  CapabilityCandidate,
  CapabilityQuery,
  PackageListing,
  PackageManifest,
  PackageSurfaceAiOperation,
} from '@/common/packages';

type StoreListingSource = Readonly<{
  list: (filter?: { type?: 'app'; installedOnly?: boolean }) => Promise<PackageListing[]>;
}>;

export type StoreSurfaceCandidateProvider = Readonly<{
  collect: (query: CapabilityQuery) => Promise<readonly CapabilityCandidate[]>;
}>;

const isSignedTrust = (trust: PackageListing['trust']): boolean =>
  trust === 'trusted-first-party' || trust === 'signed-first-party' || trust === 'signed-store';

const manifestFor = (listing: PackageListing): PackageManifest =>
  listing.state === 'installed' && listing.installedManifest !== undefined
    ? listing.installedManifest
    : listing.manifest;

const candidateFor = (listing: PackageListing, operation: PackageSurfaceAiOperation): CapabilityCandidate => {
  const installed = listing.state === 'installed' && listing.enabled;
  const installedArtifact = listing.state === 'installed' && listing.installedManifest !== undefined;
  const manifest = manifestFor(listing);
  const trust = installedArtifact ? (listing.installedTrust ?? listing.trust) : listing.trust;
  const review = installedArtifact ? listing.installedPublicationReview : listing.publicationReview;
  // A catalog revocation of a newer version cannot revoke a different installed artifact.
  const revoked = installedArtifact ? false : listing.revoked === true;
  const hasOneSurface = manifest.contributions?.apps?.length === 1;
  const reviewed = review !== undefined;
  const eligible = !revoked && hasOneSurface && reviewed && isSignedTrust(trust) && listing.compatible;
  const state =
    eligible && installed ? 'ready-local' : eligible && listing.state === 'available' ? 'installable' : 'unavailable';
  const reasonCodes = [
    `store:${manifest.id}`,
    `operation:${operation.id}`,
    ...(revoked ? ['STORE_REVOKED'] : []),
    ...(!hasOneSurface ? ['SURFACE_CONTRIBUTION_REQUIRED'] : []),
    ...(!reviewed ? ['STORE_REVIEW_REQUIRED'] : []),
    ...(!listing.compatible ? ['PACKAGE_INCOMPATIBLE'] : []),
    ...(listing.state === 'installed' && !listing.enabled ? ['PACKAGE_DISABLED'] : []),
  ].toSorted();
  return {
    schemaVersion: 1,
    candidateId: `surface:${manifest.id}:${manifest.version}:${operation.id}`,
    package: {
      packageId: manifest.id,
      packageVersion: manifest.version,
      publisherId: manifest.publisherId,
    },
    contribution: {
      package: {
        packageId: manifest.id,
        packageVersion: manifest.version,
        publisherId: manifest.publisherId,
      },
      contributionId: manifest.contributions?.apps?.[0]?.id ?? 'surface',
    },
    capability: operation.capability,
    state,
    trusted: isSignedTrust(trust) && reviewed && !revoked,
    compatible: listing.compatible,
    healthy: installed,
    dataLocation: 'local-only',
    supportsUi: true,
    supportsOffline: installed,
    ...(listing.offer ? { offer: listing.offer } : {}),
    reasonCodes,
  };
};

/**
 * Projects Store facts into the shared resolver contract. It never chooses a
 * model, installs a package, or grants AI access; those remain separate Hub and
 * consent actions. An installed reviewed Surface is emitted as local-ready;
 * the same reviewed catalog Surface is only installable otherwise.
 */
export const createStoreSurfaceCandidateProvider = (source: StoreListingSource): StoreSurfaceCandidateProvider => ({
  collect: async (query) => {
    const listings = await source.list({ type: 'app' });
    return listings
      .flatMap((listing) =>
        (manifestFor(listing).aiAccess?.operations ?? [])
          .filter((operation) => operation.capability === query.capability)
          .map((operation) => candidateFor(listing, operation))
      )
      .toSorted((left, right) => left.candidateId.localeCompare(right.candidateId));
  },
});
