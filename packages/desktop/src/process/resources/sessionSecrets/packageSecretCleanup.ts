import type { ScopedSecretVault } from '@process/agentRuntime/secretVault';

type Deps = {
  vault: Pick<ScopedSecretVault, 'removePackage'>;
  /** Subscribes to package install/uninstall changes; returns an unsubscribe function. */
  onChanged: (listener: () => void) => () => void;
  /** The ids of the installed Package Apps, read after the package store is ready. */
  installedPackageIds: () => Promise<ReadonlySet<string>>;
  /** Other places that hold something for a package (for example its access grants). */
  also?: { forget: (packageId: string) => Promise<unknown> };
};

/**
 * Removes a Package App's secret sets when the package is uninstalled while the app runs. It only ever acts on a
 * package it has seen installed and later sees gone, so an unreadable package store, a package that was never
 * installed here or a missed event can only leave sets behind, never delete them.
 */
export const wirePackageSecretCleanup = ({ vault, onChanged, installedPackageIds, also }: Deps): (() => void) => {
  let known: ReadonlySet<string> | undefined;
  let chain: Promise<void> = Promise.resolve();
  const settle = async (): Promise<void> => {
    let current: ReadonlySet<string>;
    try {
      current = await installedPackageIds();
    } catch {
      return;
    }
    const previous = known;
    known = current;
    if (!previous) return;
    for (const packageId of previous) {
      if (current.has(packageId)) continue;
      try {
        await vault.removePackage(packageId);
        await also?.forget(packageId);
      } catch {
        // Whatever could not be removed stays until the next uninstall.
      }
    }
  };
  const run = (): void => {
    chain = chain.then(settle).catch((): undefined => undefined);
  };
  run();
  return onChanged(run);
};
