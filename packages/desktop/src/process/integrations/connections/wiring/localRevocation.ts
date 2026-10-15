/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Revokes this machine's local signing key and brings what depended on it up to date (docs/platform/repotopackage-design.md
 * section 9.1). Order matters: the key is revoked first (its id is written to the revoked list before anything is deleted),
 * then the installed `local-built` packages are marked `unsigned-revoked`, then the connection registry switches their
 * code-running connections off. Each step is safe to repeat, so a failure part-way is repaired at the next start.
 */

import type { PackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import type { ConnectionRegistry } from '@process/integrations/connections/core/registry';
import type { LocalSigningKeys } from './localKeys';

export type LocalKeyRevocationDeps = Readonly<{
  keys: Pick<LocalSigningKeys, 'revoke'>;
  packages: Pick<PackageManagerService, 'reconcileLocalKeyRevocations'>;
  registry: Pick<ConnectionRegistry, 'reconcile'>;
}>;

export type LocalKeyRevocationOutcome = Readonly<{
  /** Installed packages whose trust changed to `unsigned-revoked`. A count only: no key id or path leaves Main. */
  unsignedPackages: number;
}>;

/** How many installed packages were made on this machine, the ones a revocation would turn unsigned. */
export const countLocalBuiltPackages = async (packages: Pick<PackageManagerService, 'list'>): Promise<number> =>
  (await packages.list({ installedOnly: true })).filter((listing) => listing.installedTrust === 'local-built').length;

/** Revokes the current local key and reconciles packages and connections. Throws when a step fails. */
export const revokeLocalSigningKey = async (deps: LocalKeyRevocationDeps): Promise<LocalKeyRevocationOutcome> => {
  await deps.keys.revoke();
  const unsignedPackages = await deps.packages.reconcileLocalKeyRevocations();
  await deps.registry.reconcile();
  return { unsignedPackages };
};
