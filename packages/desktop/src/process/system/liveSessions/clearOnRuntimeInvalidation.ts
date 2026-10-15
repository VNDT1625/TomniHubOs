/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

type RuntimeInvalidation = Readonly<{
  packageId: string;
  runtimeId: string;
  ownerId: string;
  reason: 'runtime-closed' | 'owner-unavailable' | 'package-revoked';
}>;

type RuntimeSource = Readonly<{
  onInvalidated: (listener: (event: RuntimeInvalidation) => void) => () => void;
  listRuntimeBindings: (packageId: string) => readonly { runtimeId: string; ownerId: string }[];
}>;

/**
 * A package's sessions belong to its live runtime: once its last sandbox runtime closes, is orphaned by
 * its window, or the package is revoked, whatever it reported under Active goes with it.
 */
export const clearSessionsOnRuntimeInvalidation = (
  runtimes: RuntimeSource,
  clear: (packageId: string) => void
): (() => void) =>
  runtimes.onInvalidated((event) => {
    // When a window goes away, Main announces each of its runtimes before removing any of them, so the others
    // from the same window are still listed and must not count as survivors.
    const survivors = runtimes
      .listRuntimeBindings(event.packageId)
      .filter(
        (binding) =>
          binding.runtimeId !== event.runtimeId &&
          !(event.reason === 'owner-unavailable' && binding.ownerId === event.ownerId)
      );
    if (event.reason === 'package-revoked' || survivors.length === 0) clear(event.packageId);
  });
