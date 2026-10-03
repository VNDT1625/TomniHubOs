/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import type {
  PackageDependencyResolution,
  PackageDependencyResolutionCandidate,
  PackageDependencyResolutionErrorDetails,
  PackageManifest,
  PackageOperationFailure,
  PackageOperationFailureCode,
  PackageOperationPhase,
  PackageOperationResult,
} from './types';

const errorMessage = (details: PackageDependencyResolutionErrorDetails): string => {
  switch (details.code) {
    case 'dependency-missing':
      return `Package ${details.packageId} requires unavailable dependency ${details.dependencyId}.`;
    case 'dependency-inactive':
      return `Package ${details.packageId} requires active dependency ${details.dependencyId}.`;
    case 'dependency-version-incompatible':
      return `Package ${details.packageId} requires ${details.dependencyId} ${details.requiredVersion}, but found ${details.actualVersion}.`;
    case 'dependency-cycle':
      return `Package dependency cycle detected: ${details.cycle?.join(' -> ') ?? details.packageId}.`;
    default:
      return `Package ${details.packageId} has an invalid dependency graph.`;
  }
};

/** A fail-closed error returned when a package dependency graph cannot be activated. */
export class PackageDependencyResolutionError extends Error {
  public constructor(public readonly details: PackageDependencyResolutionErrorDetails) {
    super(errorMessage(details));
    this.name = 'PackageDependencyResolutionError';
  }
}

const dependencyFailureCode = (details: PackageDependencyResolutionErrorDetails): PackageOperationFailureCode => {
  switch (details.code) {
    case 'dependency-missing':
      return 'PACKAGE_DEPENDENCY_MISSING';
    case 'dependency-version-incompatible':
      return 'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION';
    case 'dependency-cycle':
      return 'PACKAGE_DEPENDENCY_CYCLE';
    case 'dependency-inactive':
      if (details.dependencyState === 'quarantined') return 'PACKAGE_DEPENDENCY_QUARANTINED';
      if (details.dependencyState === 'installed') return 'PACKAGE_DEPENDENCY_DISABLED';
      return 'PACKAGE_DEPENDENCY_MISSING';
  }
  return 'PACKAGE_OPERATION_FAILED';
};

/** A public operation error whose message and data are safe to pass through Electron IPC. */
export class PackageOperationError extends Error {
  public constructor(public readonly failure: PackageOperationFailure) {
    super(failure.code);
    this.name = 'PackageOperationError';
  }
}

const PACKAGE_OPERATION_PHASES = new Set<PackageOperationPhase>(['install', 'activation', 'restore', 'uninstall']);
const PACKAGE_OPERATION_FAILURE_CODES = new Set<PackageOperationFailureCode>([
  'PACKAGE_DEPENDENCY_MISSING',
  'PACKAGE_DEPENDENCY_DISABLED',
  'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION',
  'PACKAGE_DEPENDENCY_CYCLE',
  'PACKAGE_DEPENDENCY_QUARANTINED',
  'PACKAGE_PAYLOAD_INCONSISTENT',
  'PACKAGE_CORE_REPAIR_REQUIRED',
  'PACKAGE_OPERATION_FAILED',
]);

const operationFailureFrom = (error: unknown): PackageOperationFailure | undefined => {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined;
  const failure = (error as { failure?: unknown }).failure;
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return undefined;
  const candidate = failure as { phase?: unknown; code?: unknown };
  if (
    typeof candidate.phase !== 'string' ||
    typeof candidate.code !== 'string' ||
    !PACKAGE_OPERATION_PHASES.has(candidate.phase as PackageOperationPhase) ||
    !PACKAGE_OPERATION_FAILURE_CODES.has(candidate.code as PackageOperationFailureCode)
  ) {
    return undefined;
  }
  return {
    phase: candidate.phase as PackageOperationPhase,
    code: candidate.code as PackageOperationFailureCode,
  };
};

/** Converts internal dependency failures to a stable public error without exposing package metadata. */
export const toPackageOperationFailure = (error: unknown, phase: PackageOperationPhase): PackageOperationFailure => {
  if (error instanceof PackageOperationError) return error.failure;
  const nestedFailure = operationFailureFrom(error);
  if (nestedFailure) return nestedFailure;
  if (error instanceof PackageDependencyResolutionError) {
    return {
      phase,
      code: dependencyFailureCode(error.details),
    };
  }
  return { phase, code: 'PACKAGE_OPERATION_FAILED' };
};

/** Resolves one installed package by ID for dependency admission and activation. */
export type PackageDependencyCandidateLookup = (id: string) => PackageDependencyResolutionCandidate | undefined;

/**
 * Resolves the transitive activation dependencies for a package in dependency-first order.
 *
 * A package is activatable only when every transitive dependency is installed, enabled,
 * version-compatible, and does not form a cycle with the root package.
 */
export const resolvePackageDependencies = (
  root: PackageManifest,
  lookup: PackageDependencyCandidateLookup
): PackageDependencyResolution => {
  const states = new Map<string, 'visiting' | 'visited'>();
  const path: string[] = [];
  const packageIds: string[] = [];

  const visit = (manifest: PackageManifest): void => {
    const state = states.get(manifest.id);
    if (state === 'visited') return;
    if (state === 'visiting') {
      const cycleStart = path.indexOf(manifest.id);
      const cycle = [...path.slice(cycleStart), manifest.id];
      throw new PackageDependencyResolutionError({
        code: 'dependency-cycle',
        packageId: manifest.id,
        cycle,
      });
    }

    states.set(manifest.id, 'visiting');
    path.push(manifest.id);
    for (const dependency of manifest.dependencies) {
      const candidate = lookup(dependency.id);
      if (!candidate) {
        throw new PackageDependencyResolutionError({
          code: 'dependency-missing',
          packageId: manifest.id,
          dependencyId: dependency.id,
          requiredVersion: dependency.version,
        });
      }
      if (!semver.satisfies(candidate.manifest.version, dependency.version, { includePrerelease: true })) {
        throw new PackageDependencyResolutionError({
          code: 'dependency-version-incompatible',
          packageId: manifest.id,
          dependencyId: dependency.id,
          requiredVersion: dependency.version,
          actualVersion: candidate.manifest.version,
        });
      }

      const inactive = candidate.state !== 'installed' || !candidate.enabled;
      if (!inactive || candidate.state === 'available') visit(candidate.manifest);
      if (inactive) {
        throw new PackageDependencyResolutionError({
          code: 'dependency-inactive',
          packageId: manifest.id,
          dependencyId: dependency.id,
          requiredVersion: dependency.version,
          actualVersion: candidate.manifest.version,
          dependencyState: candidate.state,
        });
      }
    }
    path.pop();
    states.set(manifest.id, 'visited');
    if (manifest.id !== root.id) packageIds.push(manifest.id);
  };

  visit(root);
  return { packageIds };
};

/**
 * Resolves dependencies without allowing internal package metadata to cross a public boundary.
 */
export const resolvePackageDependencyResult = (
  root: PackageManifest,
  lookup: PackageDependencyCandidateLookup,
  phase: PackageOperationPhase = 'activation'
): PackageOperationResult<PackageDependencyResolution> => {
  try {
    return { ok: true, value: resolvePackageDependencies(root, lookup) };
  } catch (error) {
    return { ok: false, error: toPackageOperationFailure(error, phase) };
  }
};
