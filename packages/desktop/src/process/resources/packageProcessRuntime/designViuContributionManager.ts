/**
 * Fixed Main-only lifecycle admission for the Design VIU contribution.
 *
 * This is deliberately not a package runtime or code loader. The signed
 * declaration only selects this reviewed host service; it cannot provide a
 * module path, argv, environment, or executable implementation.
 */

import type { PackageListing, PackageStateChangedEvent } from '@/common/packages';

export const DESIGN_VIU_PACKAGE_ID = 'com.tomni.design-studio' as const;
export const DESIGN_VIU_PUBLISHER_ID = 'com.tomni' as const;
export const DESIGN_VIU_CONTRIBUTION_ID = 'design-viu-v1' as const;

type DesignViuPackageService = Pick<
  import('@process/extensions/package-manager/PackageManagerService').PackageManagerService,
  'status' | 'onStateChanged'
>;

export type DesignViuContributionIdentity = Readonly<{
  packageId: typeof DESIGN_VIU_PACKAGE_ID;
  packageVersion: string;
  publisherId: typeof DESIGN_VIU_PUBLISHER_ID;
  artifactIntegrity: string;
}>;

export type DesignViuContributionEvidence = Readonly<{
  at: number;
  kind: 'admitted' | 'denied' | 'cancelled';
  reason:
    | 'package-inactive'
    | 'package-revoked'
    | 'package-identity-mismatch'
    | 'package-trust-unverified'
    | 'package-review-unverified'
    | 'package-artifact-unverified'
    | 'declaration-missing'
    | 'manual-stop'
    | 'package-state-changed'
    | 'manager-disposed';
  identity?: DesignViuContributionIdentity;
}>;

/**
 * An opaque reviewed-host service selected by the signed declaration. It has
 * no package code, path, manifest input, subprocess, or IPC endpoint.
 */
export type FixedDesignViuContributionService = Readonly<{
  schemaVersion: 1;
  contributionId: typeof DESIGN_VIU_CONTRIBUTION_ID;
  identity: DesignViuContributionIdentity;
  isCancelled: () => boolean;
}>;

export type DesignViuContributionManager = Readonly<{
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  state: () => 'inactive' | 'active' | 'disposed';
  activeService: () => FixedDesignViuContributionService | undefined;
  /** Main-only lifecycle signal; listeners must re-read activeService(). */
  onStateChanged: (listener: () => void) => () => void;
  evidence: () => readonly DesignViuContributionEvidence[];
  cancel: () => void;
  dispose: () => void;
}>;

export type DesignViuContributionManagerDeps = Readonly<{
  packages: DesignViuPackageService;
  now?: () => number;
}>;

type Admission =
  | Readonly<{ admitted: true; identity: DesignViuContributionIdentity }>
  | Readonly<{
      admitted: false;
      reason: Extract<DesignViuContributionEvidence['reason'], `package-${string}` | 'declaration-missing'>;
    }>;

const isExactDeclaration = (listing: PackageListing): boolean => {
  const declarations = listing.installedManifest?.mainContributions;
  return (
    declarations?.length === 1 &&
    declarations[0]?.schemaVersion === 1 &&
    declarations[0]?.id === DESIGN_VIU_CONTRIBUTION_ID
  );
};

const admit = (listing: PackageListing): Admission => {
  if (listing.revoked === true) return Object.freeze({ admitted: false, reason: 'package-revoked' });
  if (listing.state !== 'installed' || !listing.enabled || !listing.installedManifest) {
    return Object.freeze({ admitted: false, reason: 'package-inactive' });
  }
  const manifest = listing.installedManifest;
  if (
    manifest.id !== DESIGN_VIU_PACKAGE_ID ||
    manifest.publisherId !== DESIGN_VIU_PUBLISHER_ID ||
    listing.installedVersion !== manifest.version
  ) {
    return Object.freeze({ admitted: false, reason: 'package-identity-mismatch' });
  }
  if (listing.installedTrust !== 'signed-first-party') {
    return Object.freeze({ admitted: false, reason: 'package-trust-unverified' });
  }
  if (!listing.installedPublicationReview) {
    return Object.freeze({ admitted: false, reason: 'package-review-unverified' });
  }
  const integrity = manifest.artifact?.integrity;
  if (!integrity || !manifest.artifact?.signature.value) {
    return Object.freeze({ admitted: false, reason: 'package-artifact-unverified' });
  }
  if (!isExactDeclaration(listing)) return Object.freeze({ admitted: false, reason: 'declaration-missing' });
  return Object.freeze({
    admitted: true,
    identity: Object.freeze({
      packageId: DESIGN_VIU_PACKAGE_ID,
      packageVersion: manifest.version,
      publisherId: DESIGN_VIU_PUBLISHER_ID,
      artifactIntegrity: integrity,
    }),
  });
};

const sameIdentity = (left: DesignViuContributionIdentity, right: DesignViuContributionIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId &&
  left.artifactIntegrity === right.artifactIntegrity;

/**
 * Binds exactly one verified Design artifact to a reviewed host object. Package
 * lifecycle events are only a prompt to re-read the authoritative Main status;
 * they do not contain activation data themselves.
 */
export const createDesignViuContributionManager = (
  deps: DesignViuContributionManagerDeps
): DesignViuContributionManager => {
  const now = deps.now ?? Date.now;
  const records: DesignViuContributionEvidence[] = [];
  let active: FixedDesignViuContributionService | undefined;
  let cancelCurrent: (() => void) | undefined;
  let initialized = false;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  let refreshTail: Promise<void> = Promise.resolve();
  const stateListeners = new Set<() => void>();

  const emitStateChanged = (): void => {
    for (const listener of stateListeners) {
      try {
        listener();
      } catch {
        // A host observer must not weaken package revocation or admission.
        console.error('[DesignViuContribution] Lifecycle observer failed.');
      }
    }
  };

  const record = (
    kind: DesignViuContributionEvidence['kind'],
    reason: DesignViuContributionEvidence['reason'],
    identity?: DesignViuContributionIdentity
  ): void => {
    records.push(Object.freeze({ at: now(), kind, reason, ...(identity ? { identity } : {}) }));
    if (records.length > 32) records.splice(0, records.length - 32);
  };

  const cancelActive = (
    reason: Extract<
      DesignViuContributionEvidence['reason'],
      'manual-stop' | 'package-state-changed' | 'manager-disposed'
    >
  ): void => {
    if (!active) return;
    cancelCurrent?.();
    cancelCurrent = undefined;
    record('cancelled', reason, active.identity);
    active = undefined;
    emitStateChanged();
  };

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    let listing: PackageListing;
    try {
      listing = await deps.packages.status(DESIGN_VIU_PACKAGE_ID);
    } catch {
      cancelActive('package-state-changed');
      record('denied', 'package-inactive');
      return;
    }
    const admission = admit(listing);
    if (admission.admitted === false) {
      cancelActive('package-state-changed');
      record('denied', admission.reason);
      return;
    }
    if (active && sameIdentity(active.identity, admission.identity)) return;
    cancelActive('package-state-changed');
    const identity = admission.identity;
    let serviceCancelled = false;
    active = Object.freeze({
      schemaVersion: 1,
      contributionId: DESIGN_VIU_CONTRIBUTION_ID,
      identity,
      isCancelled: () => serviceCancelled,
    });
    cancelCurrent = () => {
      serviceCancelled = true;
    };
    record('admitted', 'package-inactive', identity);
    emitStateChanged();
  };

  const scheduleRefresh = (): Promise<void> => {
    const next = refreshTail.then(refresh, refresh);
    refreshTail = next.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return next;
  };

  const onStateChanged = (event: PackageStateChangedEvent): void => {
    if (event.id !== DESIGN_VIU_PACKAGE_ID) return;
    void scheduleRefresh();
  };

  return Object.freeze({
    initialize: async () => {
      if (initialized || disposed) return;
      initialized = true;
      unsubscribe = deps.packages.onStateChanged(onStateChanged);
      await scheduleRefresh();
    },
    refresh: scheduleRefresh,
    state: () => (disposed ? 'disposed' : active ? 'active' : 'inactive'),
    activeService: () => active,
    onStateChanged: (listener: () => void) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    evidence: () => Object.freeze(records.map((entry) => structuredClone(entry))),
    cancel: () => cancelActive('manual-stop'),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      cancelActive('manager-disposed');
    },
  });
};
