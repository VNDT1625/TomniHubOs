/**
 * Fixed Main-runtime lifecycle for a reviewed package id. Package metadata never
 * selects host code: the caller supplies both operations for one exact id.
 */

import type { PackageListing, PackageStateChangedEvent } from '@/common/packages';

export type FixedPackageActivationLifecycle = Readonly<{
  initialize: () => Promise<void>;
  quiesce: () => Promise<void>;
  resume: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

type FixedPackageLifecycleSource = Readonly<{
  status: (packageId: string) => Promise<PackageListing>;
  onStateChanged: (listener: (event: PackageStateChangedEvent) => void) => () => void;
}>;

/**
 * Starts a fixed reviewed host only for an installed-and-enabled package, and
 * tears it down for every other lifecycle state before mutation can continue.
 */
export const createFixedPackageActivationLifecycle = (
  packageId: string,
  deps: Readonly<{
    packages: FixedPackageLifecycleSource;
    activate: () => Promise<void>;
    deactivate: () => Promise<void>;
  }>
): FixedPackageActivationLifecycle => {
  let disposed = false;
  let active = false;
  let quiesced = false;
  let unsubscribe: (() => void) | undefined;
  let transitions: Promise<void> = Promise.resolve();

  const reconcile = (): Promise<void> => {
    const next = transitions
      .catch((): undefined => undefined)
      .then(async (): Promise<void> => {
        if (disposed || quiesced) return;
        let listing: PackageListing;
        try {
          listing = await deps.packages.status(packageId);
        } catch {
          if (active) {
            active = false;
            await deps.deactivate();
          }
          return;
        }
        const shouldActivate = listing.state === 'installed' && listing.enabled && !listing.revoked;
        if (shouldActivate && !active) {
          await deps.activate();
          active = true;
        } else if (!shouldActivate && active) {
          active = false;
          await deps.deactivate();
        }
      });
    transitions = next;
    return next;
  };

  return Object.freeze({
    initialize: async (): Promise<void> => {
      if (disposed || unsubscribe) return;
      unsubscribe = deps.packages.onStateChanged((event) => {
        if (event.id !== packageId) return;
        void reconcile().catch((): undefined => undefined);
      });
      await reconcile();
    },
    quiesce: async (): Promise<void> => {
      quiesced = true;
      await transitions.catch((): undefined => undefined);
      if (active) {
        active = false;
        await deps.deactivate();
      }
    },
    resume: async (): Promise<void> => {
      if (disposed) return;
      quiesced = false;
      await reconcile();
    },
    dispose: async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      await transitions.catch((): undefined => undefined);
      if (active) {
        active = false;
        await deps.deactivate();
      }
    },
  });
};
