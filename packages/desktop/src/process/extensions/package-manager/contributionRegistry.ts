/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import {
  parsePackageManifest,
  PackageDependencyResolutionError,
  resolvePackageDependencies,
  resolvePackageDependencyResult,
  type InstalledPackageRecord,
  type PackageAppContribution,
  type PackageCommandContribution,
  type PackageIdeActivityGroupContribution,
  type PackageIdeSubtabContribution,
  type PackageManifest,
  type PackageOperationFailure,
  type PackageSettingContribution,
  type PackageContributionDiagnostic,
  type PackageContributionDiagnosticCode,
  type PackageContributionSnapshot,
  type RegisteredPackageContribution,
} from '../../../common/packages';

export type {
  PackageContributionDiagnostic,
  PackageContributionSnapshot,
  PackageContributionState,
  RegisteredPackageContribution,
} from '../../../common/packages';

export type PackageContributionRestoreDiagnostic = PackageContributionDiagnostic & { detail: string };
export type PackageContributionRestoreResult = {
  snapshot: PackageContributionSnapshot;
  diagnostics: PackageContributionRestoreDiagnostic[];
};

export class PackageContributionRegistryError extends Error {
  public constructor(
    public readonly code: PackageContributionDiagnosticCode,
    detail: string,
    public readonly failure?: PackageOperationFailure
  ) {
    super(detail);
    this.name = 'PackageContributionRegistryError';
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const trustedProtectedNamespace = new Set(['trusted-first-party', 'signed-first-party']);
const initialSnapshot = (): PackageContributionSnapshot => ({
  revision: 0,
  packageIds: [],
  apps: [],
  activityGroups: [],
  subtabs: [],
  commands: [],
  settings: [],
});

const contributionOrder = (value: { order?: number; id: string; packageId: string }): [number, string, string] => [
  value.order ?? 0,
  value.id,
  value.packageId,
];

const compareContributions = (
  left: { order?: number; id: string; packageId: string },
  right: { order?: number; id: string; packageId: string }
): number => {
  const a = contributionOrder(left);
  const b = contributionOrder(right);
  return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]);
};

const asRegistryError = (error: unknown): PackageContributionRegistryError =>
  error instanceof PackageContributionRegistryError
    ? error
    : new PackageContributionRegistryError('invalid-package', error instanceof Error ? error.message : String(error));

const restoreDiagnosticFor = (
  packageId: string,
  error: PackageContributionRegistryError
): PackageContributionRestoreDiagnostic => ({
  packageId,
  code: error.code,
  detail: error.message,
  ...(error.failure ? { failure: { ...error.failure, phase: 'restore' } } : {}),
});

const findCyclicPackageIds = (records: Iterable<InstalledPackageRecord>): Set<string> => {
  const candidates = new Map<string, { manifest: PackageManifest; state: 'installed'; enabled: true }>();
  for (const record of records) {
    if (record.state !== 'installed' || !record.enabled || !record.manifest) continue;
    try {
      const manifest = parsePackageManifest(record.manifest);
      if (record.id === manifest.id && record.version === manifest.version) {
        candidates.set(manifest.id, { manifest, state: 'installed', enabled: true });
      }
    } catch {
      // The regular restore path produces the package-specific validation diagnostic.
    }
  }

  const cyclicPackageIds = new Set<string>();
  for (const { manifest } of candidates.values()) {
    try {
      resolvePackageDependencies(manifest, (id) => candidates.get(id));
    } catch (error) {
      if (error instanceof PackageDependencyResolutionError && error.details.code === 'dependency-cycle') {
        for (const id of error.details.cycle ?? []) cyclicPackageIds.add(id);
      }
    }
  }
  return cyclicPackageIds;
};

const registerUnique = <T extends { id: string }>(
  target: Map<string, RegisteredPackageContribution<T>>,
  contribution: T,
  manifest: PackageManifest,
  kind: string
): void => {
  const key = `${manifest.id}/${contribution.id}`;
  if (target.has(key)) {
    throw new PackageContributionRegistryError(
      'contribution-collision',
      `${kind} contribution key is already registered: ${key}`
    );
  }
  target.set(key, {
    ...clone(contribution),
    key,
    packageId: manifest.id,
    packageVersion: manifest.version,
  });
};

/**
 * Older signed app artifacts can declare a runnable sandbox module without the
 * later `contributions.apps` projection. The fallback is deliberately limited
 * to app packages and sandboxed-web modules; the manifest has already passed
 * identity and trust validation before this value is admitted to the registry.
 */
const fallbackSandboxedAppContributions = (manifest: PackageManifest): PackageAppContribution[] => {
  if (manifest.type !== 'app') return [];

  const explicitApps = manifest.contributions?.apps ?? [];
  const explicitModuleIds = new Set(explicitApps.map((contribution) => contribution.moduleId));
  const explicitIds = new Set(explicitApps.map((contribution) => contribution.id));

  return manifest.modules.flatMap((module) => {
    if (module.runtime !== 'sandboxed-web' || explicitModuleIds.has(module.id)) return [];
    return [
      {
        id: explicitIds.has(module.id) ? `legacy-${module.id}` : module.id,
        title: module.title,
        moduleId: module.id,
      },
    ];
  });
};

/** Atomic in-memory projection of contributions from the durable installed-package registry. */
export class PackageContributionRegistry {
  private records = new Map<string, InstalledPackageRecord>();
  private snapshot = initialSnapshot();

  public constructor(private readonly hostApiVersion = '1.0.0') {
    if (!semver.valid(hostApiVersion)) {
      throw new PackageContributionRegistryError(
        'invalid-package',
        `IDE host API version is not valid semantic version: ${hostApiVersion}`
      );
    }
  }

  public read(): PackageContributionSnapshot {
    return clone(this.snapshot);
  }

  public replace(records: readonly InstalledPackageRecord[]): PackageContributionSnapshot {
    const nextRecords = new Map<string, InstalledPackageRecord>();
    for (const record of records) {
      if (nextRecords.has(record.id)) {
        throw new PackageContributionRegistryError(
          'invalid-package',
          `Duplicate installed package record: ${record.id}`
        );
      }
      nextRecords.set(record.id, clone(record));
    }
    return this.commit(nextRecords);
  }

  /** Restores all valid packages and reports rejected records without blocking host startup. */
  public restore(records: readonly InstalledPackageRecord[]): PackageContributionRestoreResult {
    const diagnostics: PackageContributionRestoreDiagnostic[] = [];
    const unique = new Map<string, InstalledPackageRecord>();
    for (const record of records) {
      if (unique.has(record.id)) {
        diagnostics.push({
          packageId: record.id,
          code: 'invalid-package',
          detail: `Duplicate installed package record: ${record.id}`,
        });
        continue;
      }
      unique.set(record.id, clone(record));
    }

    for (const packageId of findCyclicPackageIds(unique.values())) {
      unique.delete(packageId);
      diagnostics.push({
        packageId,
        code: 'dependency-cycle',
        detail: 'Enabled package dependency cycle detected during activation restore.',
        failure: { phase: 'restore', code: 'PACKAGE_DEPENDENCY_CYCLE' },
      });
    }

    const accepted = new Map<string, InstalledPackageRecord>();
    // Restore uses declared package dependencies rather than a privileged
    // package-name ordering. The retry loop below admits a dependency before
    // its dependents, so every Package App follows the same contract.
    let pending = [...unique.values()].toSorted((left, right) => left.id.localeCompare(right.id));

    while (pending.length > 0) {
      let progressed = false;
      const deferred: InstalledPackageRecord[] = [];
      for (const record of pending) {
        const trial = new Map(accepted);
        trial.set(record.id, record);
        try {
          this.build(trial, this.snapshot.revision + 1);
          accepted.set(record.id, record);
          progressed = true;
        } catch (error) {
          const registryError = asRegistryError(error);
          if (registryError.code === 'dependency-unavailable') {
            deferred.push(record);
            continue;
          }
          diagnostics.push(restoreDiagnosticFor(record.id, registryError));
        }
      }
      if (deferred.length === 0) break;
      if (!progressed) {
        for (const record of deferred) {
          try {
            const trial = new Map(accepted);
            trial.set(record.id, record);
            this.build(trial, this.snapshot.revision + 1);
          } catch (error) {
            const registryError = asRegistryError(error);
            diagnostics.push(restoreDiagnosticFor(record.id, registryError));
          }
        }
        break;
      }
      pending = deferred;
    }

    const snapshot = this.commit(accepted);
    return { snapshot, diagnostics };
  }

  public validate(record: InstalledPackageRecord): void {
    const nextRecords = new Map(this.records);
    nextRecords.set(record.id, clone(record));
    this.build(nextRecords, this.snapshot.revision + 1);
  }

  public register(record: InstalledPackageRecord): PackageContributionSnapshot {
    const nextRecords = new Map(this.records);
    nextRecords.set(record.id, clone(record));
    return this.commit(nextRecords);
  }

  public validateRemove(packageId: string): void {
    const nextRecords = new Map(this.records);
    nextRecords.delete(packageId);
    this.build(nextRecords, this.snapshot.revision + 1);
  }

  public remove(packageId: string): PackageContributionSnapshot {
    const nextRecords = new Map(this.records);
    nextRecords.delete(packageId);
    return this.commit(nextRecords);
  }

  private commit(nextRecords: Map<string, InstalledPackageRecord>): PackageContributionSnapshot {
    const next = this.build(nextRecords, this.snapshot.revision + 1);
    this.records = nextRecords;
    this.snapshot = next;
    return clone(next);
  }

  private build(records: ReadonlyMap<string, InstalledPackageRecord>, revision: number): PackageContributionSnapshot {
    const active = new Map<string, { record: InstalledPackageRecord; manifest: PackageManifest }>();
    for (const record of [...records.values()].toSorted((left, right) => left.id.localeCompare(right.id))) {
      if (record.state !== 'installed' || !record.enabled) continue;
      if (!record.manifest || !record.trust) {
        throw new PackageContributionRegistryError(
          'invalid-package',
          `Enabled package lacks a trusted installed manifest: ${record.id}`
        );
      }
      let manifest: PackageManifest;
      try {
        manifest = parsePackageManifest(record.manifest);
      } catch (error) {
        throw new PackageContributionRegistryError(
          'invalid-package',
          `Enabled package manifest is invalid: ${record.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (record.id !== manifest.id || record.version !== manifest.version) {
        throw new PackageContributionRegistryError(
          'invalid-package',
          `Installed package identity is inconsistent: ${record.id}`
        );
      }
      if (manifest.id.startsWith('com.tomni.')) {
        if (!trustedProtectedNamespace.has(record.trust) || manifest.publisherId !== 'com.tomni') {
          throw new PackageContributionRegistryError(
            'protected-namespace',
            `Package is not authorized for the protected com.tomni namespace: ${manifest.id}`
          );
        }
      }
      const hostApiRange = manifest.contributions?.ide?.hostApiVersion;
      if (
        hostApiRange &&
        !semver.satisfies(this.hostApiVersion, hostApiRange, {
          includePrerelease: true,
        })
      ) {
        throw new PackageContributionRegistryError(
          'host-api-incompatible',
          `IDE host API ${this.hostApiVersion} does not satisfy ${manifest.id} requirement ${hostApiRange}`
        );
      }
      active.set(manifest.id, { record, manifest });
    }

    const activationCandidates = new Map<
      string,
      { manifest: PackageManifest; state: InstalledPackageRecord['state']; enabled: boolean }
    >();
    for (const record of records.values()) {
      if (!record.manifest) continue;
      try {
        const manifest = parsePackageManifest(record.manifest);
        if (record.id === manifest.id && record.version === manifest.version) {
          activationCandidates.set(manifest.id, {
            manifest,
            state: record.state,
            enabled: record.enabled,
          });
        }
      } catch {
        // The active package validation above reports invalid records with package-specific diagnostics.
      }
    }
    for (const { manifest } of active.values()) {
      const result = resolvePackageDependencyResult(manifest, (id) => activationCandidates.get(id), 'activation');
      if ('error' in result) {
        throw new PackageContributionRegistryError(
          result.error.code === 'PACKAGE_DEPENDENCY_CYCLE' ? 'dependency-cycle' : 'dependency-unavailable',
          result.error.code,
          result.error
        );
      }
    }

    const apps = new Map<string, RegisteredPackageContribution<PackageAppContribution>>();
    const activityGroups = new Map<string, RegisteredPackageContribution<PackageIdeActivityGroupContribution>>();
    const subtabs = new Map<string, RegisteredPackageContribution<PackageIdeSubtabContribution>>();
    const commands = new Map<string, RegisteredPackageContribution<PackageCommandContribution>>();
    const settings = new Map<string, RegisteredPackageContribution<PackageSettingContribution>>();
    for (const { manifest } of active.values()) {
      const contributions = manifest.contributions;
      for (const contribution of contributions?.apps ?? []) registerUnique(apps, contribution, manifest, 'App');
      for (const contribution of fallbackSandboxedAppContributions(manifest)) {
        registerUnique(apps, contribution, manifest, 'App');
      }
      for (const contribution of contributions?.ide?.activityGroups ?? []) {
        registerUnique(activityGroups, contribution, manifest, 'IDE activity group');
      }
      for (const contribution of contributions?.ide?.subtabs ?? []) {
        registerUnique(subtabs, contribution, manifest, 'IDE subtab');
      }
      for (const contribution of contributions?.ide?.commands ?? []) {
        registerUnique(commands, contribution, manifest, 'Command');
      }
      for (const contribution of contributions?.ide?.settings ?? []) {
        registerUnique(settings, contribution, manifest, 'Setting');
      }
    }
    for (const contribution of subtabs.values()) {
      const activityGroupKey = `com.tomni.ide/${contribution.activityGroupId}`;
      if (!activityGroups.has(activityGroupKey)) {
        throw new PackageContributionRegistryError(
          'dangling-reference',
          `IDE subtab ${contribution.key} references missing activity group ${activityGroupKey}`
        );
      }
    }

    return {
      revision,
      packageIds: [...active.keys()].toSorted(),
      apps: [...apps.values()].toSorted(compareContributions),
      activityGroups: [...activityGroups.values()].toSorted(compareContributions),
      subtabs: [...subtabs.values()].toSorted(compareContributions),
      commands: [...commands.values()].toSorted(compareContributions),
      settings: [...settings.values()].toSorted(compareContributions),
    };
  }
}
