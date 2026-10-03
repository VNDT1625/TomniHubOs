import type { PackageContributionState, PackageListing } from '@/common/packages';

import type { SurfaceManifest, SurfaceRegistry } from './types';

/**
 * Main-only read seam over Package Manager. The synchronizer accepts only
 * already validated, installed contribution facts; it never reads a package
 * artifact, loads package code, or lets a package self-register.
 */
export type PackageSurfaceRegistrySource = Readonly<{
  listInstalledApps: () => Promise<readonly PackageListing[]>;
  contributions: () => Promise<PackageContributionState>;
  onContributionsChanged: (listener: () => void) => () => void;
}>;

export type PackageSurfaceRegistrySyncResult = Readonly<{
  revision: number;
  registeredSurfaceIds: readonly string[];
  removedSurfaceIds: readonly string[];
  rejectedPackageIds: readonly string[];
}>;

export type PackageSurfaceRegistrySynchronizer = Readonly<{
  start: () => Promise<PackageSurfaceRegistrySyncResult>;
  sync: () => Promise<PackageSurfaceRegistrySyncResult>;
  dispose: () => void;
}>;

const PACKAGE_CONTEXT = ['agent', 'conversation', 'surface'] as const;

const emptySyncResult = (): PackageSurfaceRegistrySyncResult =>
  Object.freeze({
    revision: 0,
    registeredSurfaceIds: Object.freeze([]) as readonly string[],
    removedSurfaceIds: Object.freeze([]) as readonly string[],
    rejectedPackageIds: Object.freeze([]) as readonly string[],
  });

const isEligibleListing = (listing: PackageListing, packageVersion: string): boolean =>
  listing.state === 'installed' &&
  listing.enabled &&
  listing.revoked !== true &&
  listing.installedManifest !== undefined &&
  listing.installedManifest.version === packageVersion &&
  listing.installedTrust !== undefined &&
  listing.installedPublicationReview !== undefined;

/**
 * Convert a reviewed Package App contribution into a metadata-only Surface.
 * AI operations intentionally are not exposed as legacy ToolMap bindings here:
 * C4 dispatches those only after its own exact operation consent and runtime
 * transport checks.
 */
const toPackageSurface = (
  listing: PackageListing,
  contribution: PackageContributionState['snapshot']['apps'][number]
): SurfaceManifest | undefined => {
  const manifest = listing.installedManifest;
  if (!manifest || !manifest.modules.some((module) => module.id === contribution.moduleId)) return undefined;
  return {
    schemaVersion: 1,
    id: contribution.packageId,
    label: contribution.title,
    description: manifest.description,
    source: { kind: 'package', id: contribution.packageId, version: contribution.packageVersion },
    priority: 50,
    context: {
      required: [...PACKAGE_CONTEXT],
      includeOpaqueSecretHandles: false,
    },
    permissions: {
      minimumMode: 'read-only',
      allowedModes: ['read-only', 'workspace-write', 'full-access'],
      requireExplicitGrant: true,
    },
    capabilities: [],
  };
};

/**
 * Mirrors only active reviewed Package App contributions into the legacy
 * SurfaceRegistry during the migration to one Package App = one Surface.
 * It removes the previous mirror before publishing a new snapshot, so disable,
 * uninstall, review loss, and stale contribution state fail closed.
 */
export const createPackageSurfaceRegistrySynchronizer = (
  registry: SurfaceRegistry,
  source: PackageSurfaceRegistrySource,
  onError: (error: unknown) => void = (error) =>
    console.error('[PackageSurfaceRegistry] Synchronization failed.', error)
): PackageSurfaceRegistrySynchronizer => {
  let mirroredIds = new Set<string>();
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  let serial = Promise.resolve<PackageSurfaceRegistrySyncResult>(emptySyncResult());

  const syncNow = async (): Promise<PackageSurfaceRegistrySyncResult> => {
    const [contributionState, listings] = await Promise.all([source.contributions(), source.listInstalledApps()]);
    const listingsById = new Map(listings.map((listing) => [listing.manifest.id, listing]));
    const next = new Map<string, SurfaceManifest>();
    const rejected = new Set<string>();

    for (const contribution of contributionState.snapshot.apps) {
      const listing = listingsById.get(contribution.packageId);
      if (!listing || !isEligibleListing(listing, contribution.packageVersion)) {
        rejected.add(contribution.packageId);
        continue;
      }
      const surface = toPackageSurface(listing, contribution);
      if (!surface || next.has(surface.id)) {
        rejected.add(contribution.packageId);
        continue;
      }
      next.set(surface.id, surface);
    }

    const removedSurfaceIds = [...mirroredIds].filter((surfaceId) => !next.has(surfaceId)).toSorted();
    for (const surfaceId of removedSurfaceIds) registry.unregister(surfaceId);

    const registeredSurfaceIds: string[] = [];
    for (const [surfaceId, surface] of [...next.entries()].toSorted(([left], [right]) => left.localeCompare(right))) {
      const prior = registry.get(surfaceId);
      if (prior && !mirroredIds.has(surfaceId)) {
        rejected.add(surface.source.id ?? surfaceId);
        continue;
      }
      registry.register(surface, { replace: mirroredIds.has(surfaceId) });
      registeredSurfaceIds.push(surfaceId);
    }
    mirroredIds = new Set(registeredSurfaceIds);
    return Object.freeze({
      revision: contributionState.snapshot.revision,
      registeredSurfaceIds: Object.freeze(registeredSurfaceIds),
      removedSurfaceIds: Object.freeze(removedSurfaceIds),
      rejectedPackageIds: Object.freeze([...rejected].toSorted()),
    });
  };

  const sync = (): Promise<PackageSurfaceRegistrySyncResult> => {
    const next = serial.then(syncNow, syncNow);
    serial = next.catch(emptySyncResult);
    return next;
  };

  return {
    start: async () => {
      if (disposed) throw new Error('PACKAGE_SURFACE_REGISTRY_DISPOSED');
      unsubscribe ??= source.onContributionsChanged(() => {
        if (!disposed) void sync().catch(onError);
      });
      return sync();
    },
    sync,
    dispose: () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      for (const surfaceId of mirroredIds) registry.unregister(surfaceId);
      mirroredIds = new Set();
    },
  };
};
