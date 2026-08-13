/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- recovery transactions must reconcile filesystem and durable registry state in order. */

import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, rm } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  isPackageCompatible,
  parsePackageManifest,
  PackageOperationError,
  resolvePackageDependencyResult,
  toPackageOperationFailure,
  type InstalledPackageRecord,
  type PackageCatalogEntry,
  type PackageAsset,
  type PackageContributionChangedEvent,
  type PackageContributionDiagnostic,
  type PackageContributionState,
  type PackageDependencyResolutionCandidate,
  type PackageLifecycleState,
  type PackageListFilter,
  type PackageManifest,
  type PackageListing,
  type PackagePublicErrorCode,
  type PackageTrust,
  type PackageSearchRequest,
  type PackageStateChangedEvent,
} from '../../../common/packages';
import {
  computeArtifactIntegrity,
  copyArtifactSecurely,
  isPathInside,
  packageArtifactManifestsMatch,
  readArtifactManifest,
  verifyArtifactSignature,
} from './artifactSecurity';
import { JsonPackageStateStore, type PackageStateStore } from './packageStore';
import { downloadPackageArtifact } from './packageDownloader';
import { PackageContributionRegistry, PackageContributionRegistryError } from './contributionRegistry';

export type PackageSandboxMutationLease = {
  release: () => void;
};

export type PackageManagerServiceDeps = {
  rootDir: string;
  appVersion: string;
  catalog: readonly PackageCatalogEntry[];
  trustedKeys?: Readonly<Record<string, string>>;
  /** Keys pinned to Tomni's protected package namespace; generic store keys cannot elevate this trust tier. */
  firstPartyTrustedKeys?: Readonly<Record<string, string>>;
  stateStore?: PackageStateStore;
  now?: () => number;
  randomId?: () => string;
  readAssetFile?: (assetPath: string) => Promise<string>;
  resolveArtifactUrl?: (url: string) => string;
  allowLocalArtifactUrls?: boolean;
  contributionHostApiVersion?: string;
  isPackageSandboxActive?: (packageId: string) => boolean | Promise<boolean>;
  reservePackageSandboxMutation?: (packageId: string) => PackageSandboxMutationLease | undefined;

  catalogLoader?: () => Promise<readonly PackageCatalogEntry[]>;
};

export type PackageManagerService = {
  initialize: () => Promise<void>;

  refreshCatalog: () => Promise<PackageListing[]>;
  list: (filter?: PackageListFilter) => Promise<PackageListing[]>;
  search: (request: PackageSearchRequest) => Promise<PackageListing[]>;
  status: (id: string) => Promise<PackageListing>;
  install: (id: string) => Promise<PackageListing>;
  enable: (id: string) => Promise<PackageListing>;
  disable: (id: string) => Promise<PackageListing>;
  rollback: (id: string) => Promise<PackageListing>;
  uninstall: (id: string) => Promise<PackageListing>;
  contributions: () => Promise<PackageContributionState>;
  readAsset: (id: string, assetPath: string) => Promise<PackageAsset>;
  onStateChanged: (listener: (event: PackageStateChangedEvent) => void) => () => void;
  onContributionsChanged: (listener: (event: PackageContributionChangedEvent) => void) => () => void;
};

type OperationKind = 'installing' | 'enabling' | 'disabling' | 'rolling-back' | 'uninstalling';
type RunningOperation = { kind: OperationKind; promise: Promise<PackageListing> };
type AssetReadLeaseState = {
  activeReaders: number;
  waitForReaders: Promise<void>;
  resolveWhenIdle: () => void;
};
type ArtifactInstallTransaction = {
  rollback: () => Promise<void>;
  finalize: () => Promise<void>;
};

const noArtifactTransaction = (): ArtifactInstallTransaction => ({
  rollback: async () => undefined,
  finalize: async () => undefined,
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const PACKAGE_PUBLIC_ERROR_CODES = new Set<PackagePublicErrorCode>([
  'PACKAGE_DEPENDENCY_MISSING',
  'PACKAGE_DEPENDENCY_DISABLED',
  'PACKAGE_DEPENDENCY_INCOMPATIBLE_VERSION',
  'PACKAGE_DEPENDENCY_CYCLE',
  'PACKAGE_DEPENDENCY_QUARANTINED',
  'PACKAGE_PAYLOAD_INCONSISTENT',
  'PACKAGE_CORE_REPAIR_REQUIRED',
  'PACKAGE_OPERATION_FAILED',
  'PACKAGE_QUARANTINED',
]);

const publicErrorCode = (
  state: PackageLifecycleState,
  lastError: string | undefined
): PackagePublicErrorCode | undefined => {
  if (lastError && PACKAGE_PUBLIC_ERROR_CODES.has(lastError as PackagePublicErrorCode)) {
    return lastError as PackagePublicErrorCode;
  }
  if (state === 'quarantined') return 'PACKAGE_QUARANTINED';
  return lastError ? 'PACKAGE_OPERATION_FAILED' : undefined;
};

const MAX_RUNTIME_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_CONCURRENT_RUNTIME_ASSET_READS = 4;

export const createPackageManagerService = (deps: PackageManagerServiceDeps): PackageManagerService => {
  if (!path.isAbsolute(deps.rootDir)) throw new Error('Package root directory must be absolute.');
  if (!semver.valid(deps.appVersion)) throw new Error(`Invalid Tomni version: ${deps.appVersion}`);

  const catalog = new Map<string, PackageCatalogEntry>();
  const replaceCatalog = (rawEntries: readonly PackageCatalogEntry[]): void => {
    const next = new Map<string, PackageCatalogEntry>();
    for (const rawEntry of rawEntries) {
      const entry = { ...rawEntry, manifest: parsePackageManifest(rawEntry.manifest) };
      if (next.has(entry.manifest.id)) throw new Error(`Duplicate package catalog id: ${entry.manifest.id}`);
      if (
        entry.delivery === 'downloaded-package' &&
        entry.trust !== 'signed-store' &&
        entry.trust !== 'signed-first-party'
      ) {
        throw new Error(`Downloaded package ${entry.manifest.id} must use signed package trust.`);
      }
      if (entry.installScope && entry.installScope !== 'core' && entry.installScope !== 'optional') {
        throw new Error(`Package ${entry.manifest.id} has an invalid installation scope.`);
      }
      next.set(entry.manifest.id, entry);
    }
    catalog.clear();
    for (const [id, entry] of next) catalog.set(id, entry);
  };
  replaceCatalog(deps.catalog);

  const rootDir = path.resolve(deps.rootDir);
  const packagesDir = path.join(rootDir, 'packages');
  const stagingDir = path.join(rootDir, '.staging');
  const trashDir = path.join(rootDir, '.trash');
  const downloadsDir = path.join(rootDir, '.downloads');
  const stateStore = deps.stateStore ?? new JsonPackageStateStore(path.join(rootDir, 'installed.json'));
  const trustedKeys = deps.trustedKeys ?? {};
  const firstPartyTrustedKeys = deps.firstPartyTrustedKeys ?? {};
  const now = deps.now ?? Date.now;
  const randomId = deps.randomId ?? randomUUID;
  const readAssetFile = deps.readAssetFile ?? ((assetPath: string): Promise<string> => readFile(assetPath, 'utf8'));
  const transientStates = new Map<string, PackageLifecycleState>();
  const operations = new Map<string, RunningOperation>();
  const assetReadLeases = new Map<string, AssetReadLeaseState>();
  const inFlightAssetReads = new Map<string, Promise<PackageAsset>>();
  let mutationQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<(event: PackageStateChangedEvent) => void>();
  const contributionListeners = new Set<(event: PackageContributionChangedEvent) => void>();
  const contributionRegistry = new PackageContributionRegistry(deps.contributionHostApiVersion);
  let contributionDiagnostics: PackageContributionDiagnostic[] = [];
  let reconciliationDiagnostics: PackageContributionDiagnostic[] = [];

  const contributionState = (): PackageContributionState => ({
    snapshot: contributionRegistry.read(),
    diagnostics: structuredClone([...reconciliationDiagnostics, ...contributionDiagnostics]),
  });

  const clearContributionDiagnostic = (packageId: string): void => {
    contributionDiagnostics = contributionDiagnostics.filter((diagnostic) => diagnostic.packageId !== packageId);
  };

  const clearReconciliationDiagnostic = (packageId: string): void => {
    reconciliationDiagnostics = reconciliationDiagnostics.filter((diagnostic) => diagnostic.packageId !== packageId);
  };

  const emit = (id: string, state: PackageLifecycleState, error?: PackagePublicErrorCode): void => {
    const event = Object.freeze(error ? { id, state, error } : { id, state });
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        console.error('[PackagePlatform] State listener failed.');
      }
    }
  };

  const emitContributionChanged = (): void => {
    const event = Object.freeze({ revision: contributionRegistry.read().revision });
    for (const listener of contributionListeners) {
      try {
        listener(event);
      } catch {
        console.error('[PackagePlatform] Contribution listener failed.');
      }
    }
  };

  const installedEntryFor = (id: string): PackageCatalogEntry | undefined => {
    const installed = stateStore.get(id);
    if (!installed?.manifest || !installed.trust) return undefined;
    return {
      manifest: installed.manifest,
      delivery: installed.delivery,
      trust: installed.trust,
      installScope: installed.provenance?.scope,
    };
  };

  const provenanceFor = (
    entry: Pick<PackageCatalogEntry, 'delivery' | 'installScope' | 'manifest'>,
    fallbackScope?: 'core' | 'optional'
  ): NonNullable<InstalledPackageRecord['provenance']> => {
    const integrity = entry.manifest.artifact?.integrity;
    return {
      source: entry.delivery === 'downloaded-package' ? 'store' : 'bundled',
      scope: entry.installScope ?? fallbackScope ?? 'optional',
      version: entry.manifest.version,
      ...(integrity ? { integrity } : {}),
    };
  };

  const entryFor = (id: string): PackageCatalogEntry => {
    const entry = catalog.get(id) ?? installedEntryFor(id);
    if (!entry) throw new Error(`Unknown package: ${id}`);
    return entry;
  };

  const listingFor = (entry: PackageCatalogEntry): PackageListing => {
    const installed = stateStore.get(entry.manifest.id);
    const transient = transientStates.get(entry.manifest.id);
    const lastError = installed ? publicErrorCode(installed.state, installed.lastError) : undefined;
    return {
      manifest: structuredClone(entry.manifest),
      delivery: entry.delivery,
      trust: entry.trust,
      state: transient ?? installed?.state ?? 'available',
      ...(installed?.version ? { installedVersion: installed.version } : {}),
      ...(installed?.manifest ? { installedManifest: structuredClone(installed.manifest) } : {}),
      ...(installed?.trust ? { installedTrust: installed.trust } : {}),
      ...(installed?.previousVersion ? { previousVersion: installed.previousVersion } : {}),
      updateAvailable: installed?.state === 'installed' && semver.gt(entry.manifest.version, installed.version),
      compatible: isPackageCompatible(entry.manifest, deps.appVersion),
      enabled: installed?.enabled ?? false,
      ...(lastError ? { lastError } : {}),
    };
  };

  const safeRemove = async (target: string, boundary: string): Promise<void> => {
    const resolvedBoundary = path.resolve(boundary);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget === resolvedBoundary || !isPathInside(resolvedBoundary, resolvedTarget)) {
      throw new Error(`Refusing to remove path outside package transaction directory: ${resolvedTarget}`);
    }
    await rm(resolvedTarget, { recursive: true, force: true });
  };

  const assertOwnedPayloadSafeForUninstall = async (packageRoot: string, payloadPath = packageRoot): Promise<void> => {
    const isPackageRoot = payloadPath === packageRoot;
    const [packagesRoot, resolvedPackageRoot, resolvedPayload, packageRootStat, payloadStat] = await Promise.all([
      realpath(packagesDir),
      realpath(packageRoot),
      realpath(payloadPath),
      lstat(packageRoot),
      lstat(payloadPath),
    ]);
    if (
      !packageRootStat.isDirectory() ||
      packageRootStat.isSymbolicLink() ||
      !payloadStat.isDirectory() ||
      payloadStat.isSymbolicLink() ||
      !isPathInside(packagesRoot, resolvedPackageRoot) ||
      (!isPackageRoot && !isPathInside(resolvedPackageRoot, resolvedPayload))
    ) {
      throw new Error('Refusing to uninstall a package payload containing a symbolic link or escaping its owned root.');
    }
  };

  const exists = async (target: string): Promise<boolean> => {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  };

  const recoverTrashedPackage = async (trashed: string): Promise<void> => {
    let packageId: string | undefined;
    let version: string | undefined;
    let wholePackage = false;
    try {
      const manifest = await readArtifactManifest(trashed);
      packageId = manifest.id;
      version = manifest.version;
    } catch {
      const packageIds = new Set<string>();
      for (const child of await readdir(trashed, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        try {
          packageIds.add((await readArtifactManifest(path.join(trashed, child.name))).id);
        } catch {
          // Older or incomplete versions may not contain a readable manifest.
        }
      }
      if (packageIds.size === 1) {
        packageId = packageIds.values().next().value;
        wholePackage = true;
      }
    }

    if (!packageId) {
      await safeRemove(trashed, trashDir);
      return;
    }
    const record = stateStore.get(packageId);
    const target = wholePackage ? path.join(packagesDir, packageId) : path.join(packagesDir, packageId, version!);
    const shouldRestore = wholePackage
      ? record !== undefined
      : record?.version === version || record?.previousVersion === version;
    if (shouldRestore && !(await exists(target))) {
      await mkdir(path.dirname(target), { recursive: true });
      await rename(trashed, target);
      return;
    }
    await safeRemove(trashed, trashDir);
  };

  const isCorePackage = (record: InstalledPackageRecord): boolean => record.provenance?.scope === 'core';

  const recordReconciliationFailure = async (record: InstalledPackageRecord): Promise<void> => {
    const core = isCorePackage(record);
    const failure = core
      ? { phase: 'restore' as const, code: 'PACKAGE_CORE_REPAIR_REQUIRED' as const }
      : { phase: 'restore' as const, code: 'PACKAGE_PAYLOAD_INCONSISTENT' as const };
    await stateStore.save({
      ...record,
      state: core ? 'failed' : 'quarantined',
      enabled: false,
      updatedAt: now(),
      lastError: failure.code,
    });
    clearReconciliationDiagnostic(record.id);
    reconciliationDiagnostics.push({
      packageId: record.id,
      code: core ? 'core-repair-required' : 'payload-inconsistent',
      failure,
    });
  };

  type OwnedPayloadEvidence = Pick<InstalledPackageRecord, 'manifest' | 'provenance' | 'trust'>;

  const isSignedByPinnedFirstPartyKey = (manifest: PackageManifest): boolean => {
    const keyId = manifest.artifact?.signature.keyId;
    if (!keyId) return false;
    const pinnedKey = firstPartyTrustedKeys[keyId];
    return pinnedKey !== undefined && pinnedKey === trustedKeys[keyId];
  };

  const reconcileOwnedPayload = async (
    record: InstalledPackageRecord,
    version: string,
    evidence: OwnedPayloadEvidence
  ) => {
    const payloadPath = path.join(packagesDir, record.id, version);
    if (!(await exists(payloadPath))) throw new Error('Owned package payload is missing.');

    const manifest = await readArtifactManifest(payloadPath);
    if (manifest.id !== record.id || manifest.version !== version) {
      throw new Error('Owned package payload does not match its registry identity.');
    }
    if (evidence.manifest && !packageArtifactManifestsMatch(evidence.manifest, manifest)) {
      throw new Error('Owned package payload does not match its durable registry manifest.');
    }
    verifyArtifactSignature(manifest, trustedKeys);
    const integrity = await computeArtifactIntegrity(payloadPath);
    if (integrity.integrity !== manifest.artifact?.integrity || integrity.sizeBytes !== manifest.artifact.sizeBytes) {
      throw new Error('Owned package payload integrity verification failed.');
    }

    const durableFirstPartyIdentity =
      evidence.trust === 'signed-first-party' &&
      evidence.manifest !== undefined &&
      packageArtifactManifestsMatch(evidence.manifest, manifest) &&
      manifest.publisherId === 'com.tomni' &&
      isSignedByPinnedFirstPartyKey(manifest) &&
      evidence.provenance?.scope !== undefined &&
      evidence.provenance.version === manifest.version &&
      evidence.provenance.integrity === manifest.artifact?.integrity;
    const trust: PackageTrust = durableFirstPartyIdentity ? 'signed-first-party' : 'signed-store';
    const provenance =
      evidence.provenance?.scope &&
      evidence.provenance.version === manifest.version &&
      evidence.provenance.integrity === manifest.artifact?.integrity
        ? evidence.provenance
        : provenanceFor(
            {
              manifest,
              delivery: record.delivery,
            },
            evidence.provenance?.scope
          );
    return { manifest, trust, provenance };
  };

  const recoverFilesystem = async (): Promise<void> => {
    await Promise.all([
      mkdir(packagesDir, { recursive: true }),
      mkdir(stagingDir, { recursive: true }),
      mkdir(trashDir, { recursive: true }),
      mkdir(downloadsDir, { recursive: true }),
    ]);
    for (const entry of await readdir(stagingDir, { withFileTypes: true })) {
      await safeRemove(path.join(stagingDir, entry.name), stagingDir);
    }
    for (const entry of await readdir(downloadsDir, { withFileTypes: true })) {
      await safeRemove(path.join(downloadsDir, entry.name), downloadsDir);
    }

    for (const entry of await readdir(trashDir, { withFileTypes: true })) {
      const trashed = path.join(trashDir, entry.name);
      if (!entry.isDirectory()) {
        await safeRemove(trashed, trashDir);
        continue;
      }
      await recoverTrashedPackage(trashed);
    }

    for (const record of stateStore.list()) {
      if (record.delivery !== 'downloaded-package') continue;
      const previousVersion = record.previousVersion;
      try {
        const activePayload = await reconcileOwnedPayload(record, record.version, {
          manifest: record.manifest ?? catalog.get(record.id)?.manifest,
          provenance: record.provenance,
          trust: record.trust,
        });
        const metadataChanged =
          !record.manifest ||
          record.trust !== activePayload.trust ||
          !packageArtifactManifestsMatch(record.manifest, activePayload.manifest) ||
          !record.provenance ||
          record.provenance.scope !== activePayload.provenance.scope ||
          record.provenance.version !== activePayload.provenance.version ||
          record.provenance.integrity !== activePayload.provenance.integrity;
        if (metadataChanged) {
          await stateStore.save({
            ...record,
            manifest: activePayload.manifest,
            trust: activePayload.trust,
            provenance: activePayload.provenance,
          });
        }
        clearReconciliationDiagnostic(record.id);
        continue;
      } catch {
        if (!previousVersion) {
          await recordReconciliationFailure(record);
          continue;
        }
      }

      const previousPayload = await reconcileOwnedPayload(record, previousVersion, {
        manifest: record.previousManifest,
        provenance: record.previousProvenance,
        trust: record.previousTrust,
      }).catch(async (): Promise<undefined> => {
        // Preserve every payload directory for manual repair; only durable state is fail-closed.
        await recordReconciliationFailure(record);
        return undefined;
      });
      if (!previousPayload) continue;

      const restoresInstalledSandbox =
        record.state === 'installed' &&
        record.enabled &&
        (record.manifest?.modules.some(
          (module: PackageManifest['modules'][number]) => module.runtime === 'sandboxed-web'
        ) === true ||
          previousPayload.manifest.modules.some(
            (module: PackageManifest['modules'][number]) => module.runtime === 'sandboxed-web'
          ));
      if (restoresInstalledSandbox) {
        if (!deps.isPackageSandboxActive) {
          throw new Error(`Cannot repair ${record.id} because sandbox activity state is unavailable.`);
        }
        if (await deps.isPackageSandboxActive(record.id)) {
          throw new Error(`Cannot repair ${record.id} while its sandbox is active.`);
        }
      }

      try {
        const {
          lastError: _lastError,
          previousManifest: _previousManifest,
          previousProvenance: _previousProvenance,
          previousTrust: _previousTrust,
          previousVersion: _previousVersion,
          ...previousRecord
        } = record;
        await stateStore.save({
          ...previousRecord,
          version: previousVersion,
          updatedAt: now(),
          manifest: previousPayload.manifest,
          trust: previousPayload.trust,
          provenance: previousPayload.provenance,
        });
        clearReconciliationDiagnostic(record.id);
      } catch {
        await recordReconciliationFailure(record);
      }
    }
  };

  const restoreContributionRegistryFailClosed = async (): Promise<string[]> => {
    const restored = contributionRegistry.restore(stateStore.list());
    contributionDiagnostics = restored.diagnostics.map(({ packageId, code, failure }) => ({
      packageId,
      code,
      ...(failure ? { failure } : {}),
    }));
    const quarantinedIds: string[] = [];
    for (const diagnostic of restored.diagnostics) {
      const record = stateStore.get(diagnostic.packageId);
      if (!record || record.state !== 'installed' || !record.enabled) continue;
      await stateStore.save({
        ...record,
        state: 'quarantined',
        enabled: false,
        updatedAt: now(),
        lastError: diagnostic.failure?.code ?? `Contribution registry ${diagnostic.code}: ${diagnostic.detail}`,
      });
      quarantinedIds.push(record.id);
    }
    return quarantinedIds;
  };

  const rejectRuntimeVerificationFailure = async (
    record: InstalledPackageRecord,
    verificationError: unknown
  ): Promise<never> => {
    try {
      await recordReconciliationFailure(record);
      const dependentQuarantines = await restoreContributionRegistryFailClosed();
      const core = isCorePackage(record);
      emit(
        record.id,
        core ? 'failed' : 'quarantined',
        core ? 'PACKAGE_CORE_REPAIR_REQUIRED' : 'PACKAGE_PAYLOAD_INCONSISTENT'
      );
      for (const packageId of dependentQuarantines) {
        if (packageId !== record.id) emit(packageId, 'quarantined', 'PACKAGE_QUARANTINED');
      }
      emitContributionChanged();
    } catch (quarantineError) {
      const aggregateError = new AggregateError(
        [verificationError, quarantineError],
        'Package runtime verification failed and durable quarantine was incomplete.'
      );
      aggregateError.cause = verificationError;
      throw aggregateError;
    }
    throw verificationError;
  };

  const initialize = async (): Promise<void> => {
    await stateStore.initialize();
    if (deps.catalogLoader) replaceCatalog(await deps.catalogLoader());
    reconciliationDiagnostics = [];
    await recoverFilesystem();

    await restoreContributionRegistryFailClosed();

    emitContributionChanged();
  };

  const allEntries = (): PackageCatalogEntry[] => {
    const entries = new Map(catalog);
    for (const record of stateStore.list()) {
      if (entries.has(record.id)) continue;
      const installedEntry = installedEntryFor(record.id);
      if (installedEntry) entries.set(record.id, installedEntry);
    }
    return [...entries.values()];
  };

  const list = async (filter: PackageListFilter = {}): Promise<PackageListing[]> =>
    allEntries()
      .filter((entry) => !filter.type || entry.manifest.type === filter.type)
      .map(listingFor)
      .filter((entry) => !filter.installedOnly || entry.state === 'installed')
      .toSorted((left, right) => left.manifest.name.localeCompare(right.manifest.name));

  const refreshCatalog = async (): Promise<PackageListing[]> => {
    if (deps.catalogLoader) replaceCatalog(await deps.catalogLoader());
    return list();
  };

  const search = async (request: PackageSearchRequest): Promise<PackageListing[]> => {
    const query = request.query.trim().toLocaleLowerCase();
    const entries = await list(request);
    if (!query) return entries;
    return entries.filter(({ manifest }) =>
      [
        manifest.id,
        manifest.name,
        manifest.description,
        manifest.publisherId,
        ...manifest.tags,
        ...manifest.modules.flatMap((module) => [module.id, module.title, module.surface]),
      ].some((value) => value.toLocaleLowerCase().includes(query))
    );
  };

  const status = async (id: string): Promise<PackageListing> => listingFor(entryFor(id));
  const acquireAssetReadLease = (id: string): (() => void) | undefined => {
    if (operations.has(id)) return undefined;
    let lease = assetReadLeases.get(id);
    if (!lease) {
      let resolveWhenIdle: () => void = () => undefined;
      const waitForReaders = new Promise<void>((resolve) => {
        resolveWhenIdle = resolve;
      });
      lease = { activeReaders: 0, waitForReaders, resolveWhenIdle };
      assetReadLeases.set(id, lease);
    }
    lease.activeReaders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      lease.activeReaders -= 1;
      if (lease.activeReaders !== 0) return;
      assetReadLeases.delete(id);
      lease.resolveWhenIdle();
    };
  };

  const waitForAssetReadLeases = async (id: string): Promise<void> => {
    await assetReadLeases.get(id)?.waitForReaders;
  };

  const readAssetNow = async (id: string, assetPath: string): Promise<PackageAsset> => {
    const releaseReadLease = acquireAssetReadLease(id);
    if (!releaseReadLease) {
      await operations.get(id)?.promise;
      return readAssetNow(id, assetPath);
    }
    try {
      const entry = entryFor(id);
      const installed = stateStore.get(id);
      if (!installed || installed.state !== 'installed' || !installed.enabled) {
        throw new Error(`Package ${id} is not installed and enabled.`);
      }
      if (entry.delivery !== 'downloaded-package' && entry.delivery !== 'bundled-package') {
        throw new Error(`Package ${id} does not expose installable assets.`);
      }
      const packageRoot = path.join(packagesDir, id, installed.version);
      const target = path.resolve(packageRoot, assetPath);
      if (!assetPath || !isPathInside(packageRoot, target) || target === path.resolve(packageRoot)) {
        throw new Error('Package asset path is invalid.');
      }
      const [resolvedRoot, resolvedTarget, stat] = await Promise.all([
        realpath(packageRoot),
        realpath(target),
        lstat(target),
      ]);
      if (!stat.isFile() || stat.isSymbolicLink() || !isPathInside(resolvedRoot, resolvedTarget)) {
        throw new Error('Package asset is not a safe regular file.');
      }
      if (stat.size > MAX_RUNTIME_ASSET_BYTES) throw new Error('Package asset exceeds the runtime size limit.');

      const runtimeManifest = installed.manifest ?? entry.manifest;
      let expectedArtifact: NonNullable<PackageManifest['artifact']>;
      try {
        verifyArtifactSignature(runtimeManifest, trustedKeys);
        const declaredArtifact = runtimeManifest.artifact;
        if (!declaredArtifact) throw new Error(`Package ${id} does not declare runtime artifact integrity.`);
        expectedArtifact = declaredArtifact;
      } catch (error) {
        await rejectRuntimeVerificationFailure(installed, error);
      }

      const content = await readAssetFile(resolvedTarget);
      if (Buffer.byteLength(content, 'utf8') > MAX_RUNTIME_ASSET_BYTES) {
        throw new Error('Package asset exceeds the runtime size limit.');
      }
      try {
        const activeIntegrity = await computeArtifactIntegrity(packageRoot, {
          relativePath: path.relative(packageRoot, resolvedTarget).replaceAll(path.sep, '/'),
          content,
        });
        if (
          activeIntegrity.integrity !== expectedArtifact.integrity ||
          activeIntegrity.sizeBytes !== expectedArtifact.sizeBytes
        ) {
          throw new Error(`Package ${id} runtime artifact integrity verification failed.`);
        }
      } catch (error) {
        await rejectRuntimeVerificationFailure(installed, error);
      }
      const extension = path.extname(resolvedTarget).toLocaleLowerCase();
      return {
        content,
        contentType:
          extension === '.js' || extension === '.mjs'
            ? 'application/javascript'
            : extension === '.css'
              ? 'text/css'
              : extension === '.json'
                ? 'application/json'
                : extension === '.html'
                  ? 'text/html'
                  : 'text/plain',
      };
    } finally {
      releaseReadLease();
    }
  };

  const readAsset = (id: string, assetPath: string): Promise<PackageAsset> => {
    const key = JSON.stringify([id, assetPath]);
    const active = inFlightAssetReads.get(key);
    if (active && !operations.has(id)) return active;
    if (inFlightAssetReads.size >= MAX_CONCURRENT_RUNTIME_ASSET_READS) {
      return Promise.reject(new PackageOperationError({ phase: 'activation', code: 'PACKAGE_OPERATION_FAILED' }));
    }
    const operation = readAssetNow(id, assetPath);
    inFlightAssetReads.set(key, operation);
    const clear = (): void => {
      if (inFlightAssetReads.get(key) === operation) inFlightAssetReads.delete(key);
    };
    operation.then(clear, clear);
    return operation;
  };

  const dependencyCandidateFor = (id: string): PackageDependencyResolutionCandidate | undefined => {
    const installed = stateStore.get(id);
    if (installed) {
      if (
        !installed.manifest ||
        installed.manifest.id !== installed.id ||
        installed.manifest.version !== installed.version
      ) {
        return undefined;
      }
      return {
        manifest: installed.manifest,
        state: installed.state,
        enabled: installed.enabled,
      };
    }
    const catalogEntry = catalog.get(id);
    return catalogEntry
      ? {
          manifest: catalogEntry.manifest,
          state: 'available',
          enabled: false,
        }
      : undefined;
  };

  const verifyDependencies = (entry: PackageCatalogEntry): void => {
    const result = resolvePackageDependencyResult(entry.manifest, dependencyCandidateFor, 'install');
    if ('error' in result) throw new PackageOperationError(result.error);
  };

  const installArtifact = async (entry: PackageCatalogEntry): Promise<ArtifactInstallTransaction> => {
    let sourceDirectory = entry.sourceDirectory;
    let downloadedSource: string | undefined;
    if (!sourceDirectory && entry.artifactUrl) {
      downloadedSource = path.join(downloadsDir, `${entry.manifest.id}-${entry.manifest.version}-${randomId()}`);
      try {
        await downloadPackageArtifact(
          deps.resolveArtifactUrl?.(entry.artifactUrl) ?? entry.artifactUrl,
          downloadedSource,
          {
            expectedManifest: entry.manifest,
            trustedKeys,
            allowLocalDevelopment: deps.allowLocalArtifactUrls === true,
          }
        );
      } catch (error) {
        try {
          await safeRemove(downloadedSource, downloadsDir);
        } catch (cleanupError) {
          const aggregateError = new AggregateError(
            [error, cleanupError],
            'Package download failed and cleanup was incomplete.'
          );
          aggregateError.cause = error;
          throw aggregateError;
        }
        throw error;
      }
      sourceDirectory = downloadedSource;
    }
    if (!sourceDirectory) throw new Error(`Package ${entry.manifest.id} has no downloadable artifact.`);
    const resolvedSource = path.resolve(sourceDirectory);
    const trustedDownload = downloadedSource !== undefined && isPathInside(downloadsDir, resolvedSource);
    if (!path.isAbsolute(sourceDirectory) || (!trustedDownload && isPathInside(rootDir, resolvedSource))) {
      throw new Error('Package source must be an absolute directory outside the package installation root.');
    }

    try {
      const sourceManifest = await readArtifactManifest(resolvedSource);
      if (!packageArtifactManifestsMatch(entry.manifest, sourceManifest)) {
        throw new Error(`Artifact manifest does not match the Store catalog for ${entry.manifest.id}.`);
      }
      verifyArtifactSignature(sourceManifest, trustedKeys);
      const integrity = await computeArtifactIntegrity(resolvedSource);
      if (
        integrity.integrity !== sourceManifest.artifact?.integrity ||
        integrity.sizeBytes !== sourceManifest.artifact.sizeBytes
      ) {
        throw new Error(`Artifact integrity verification failed for ${entry.manifest.id}.`);
      }

      const stage = path.join(stagingDir, `${entry.manifest.id}-${entry.manifest.version}-${randomId()}`);
      const target = path.join(packagesDir, entry.manifest.id, entry.manifest.version);
      await copyArtifactSecurely(resolvedSource, stage);
      const stagedIntegrity = await computeArtifactIntegrity(stage);
      if (
        stagedIntegrity.integrity !== sourceManifest.artifact.integrity ||
        stagedIntegrity.sizeBytes !== sourceManifest.artifact.sizeBytes
      ) {
        await safeRemove(stage, stagingDir);
        throw new Error(`Staged artifact verification failed for ${entry.manifest.id}.`);
      }

      await mkdir(path.dirname(target), { recursive: true });
      if (await exists(target)) {
        const existingIntegrity = await computeArtifactIntegrity(target);
        if (
          existingIntegrity.integrity !== sourceManifest.artifact.integrity ||
          existingIntegrity.sizeBytes !== sourceManifest.artifact.sizeBytes
        ) {
          const replaced = path.join(trashDir, `${entry.manifest.id}-${entry.manifest.version}-${randomId()}`);
          await rename(target, replaced);
          try {
            await rename(stage, target);
          } catch (error) {
            await rename(replaced, target);
            throw error;
          }
          return {
            rollback: async () => {
              if (await exists(target)) await safeRemove(target, packagesDir);
              if (await exists(replaced)) await rename(replaced, target);
            },
            finalize: async () => safeRemove(replaced, trashDir),
          };
        }
        await safeRemove(stage, stagingDir);
        return noArtifactTransaction();
      }
      await rename(stage, target);
      return {
        rollback: async () => {
          if (await exists(target)) await safeRemove(target, packagesDir);
        },
        finalize: async () => undefined,
      };
    } finally {
      if (downloadedSource) {
        await safeRemove(downloadedSource, downloadsDir).catch((error: unknown): void => {
          console.error('[PackagePlatform] Failed to finalize downloaded artifact cleanup:', error);
        });
      }
    }
  };

  const performInstall = async (id: string): Promise<PackageListing> => {
    const entry = entryFor(id);
    const existing = stateStore.get(id);
    if (existing?.state === 'installed' && existing.version === entry.manifest.version) {
      if (!existing.provenance) {
        await stateStore.save({ ...existing, updatedAt: now(), provenance: provenanceFor(entry) });
      }
      return listingFor(entry);
    }
    if (existing?.state === 'installed' && semver.gt(existing.version, entry.manifest.version)) {
      throw new Error(`Refusing to downgrade ${id} from ${existing.version} to ${entry.manifest.version}.`);
    }

    const installedManifest =
      existing !== undefined && existing.manifest?.id === existing.id && existing.manifest.version === existing.version
        ? existing.manifest
        : undefined;
    const updatesSandboxedRuntime =
      existing?.state === 'installed' &&
      existing.version !== entry.manifest.version &&
      (installedManifest === undefined ||
        installedManifest.modules.some(
          (module: PackageManifest['modules'][number]) => module.runtime === 'sandboxed-web'
        ) ||
        entry.manifest.modules.some(
          (module: PackageManifest['modules'][number]) => module.runtime === 'sandboxed-web'
        ));
    let sandboxMutationLease: PackageSandboxMutationLease | undefined;
    if (updatesSandboxedRuntime) {
      if (!deps.isPackageSandboxActive || !deps.reservePackageSandboxMutation) {
        throw new Error(`Cannot update ${id} because sandbox activity state is unavailable.`);
      }
      if (await deps.isPackageSandboxActive(id)) {
        throw new Error(`Cannot update ${id} while its sandbox is active.`);
      }
      sandboxMutationLease = deps.reservePackageSandboxMutation(id);
      if (!sandboxMutationLease) throw new Error(`Cannot update ${id} while its sandbox is active.`);
    }

    try {
      transientStates.set(id, 'installing');
      emit(id, 'installing');
      const timestamp = now();
      const record: InstalledPackageRecord = {
        id,
        version: entry.manifest.version,
        ...(existing?.version && existing.version !== entry.manifest.version
          ? {
              previousVersion: existing.version,
              previousManifest: existing.manifest ? structuredClone(existing.manifest) : undefined,
              previousProvenance: existing.provenance ? structuredClone(existing.provenance) : undefined,
              previousTrust: existing.trust,
            }
          : existing?.previousVersion
            ? {
                previousVersion: existing.previousVersion,
                previousManifest: existing.previousManifest ? structuredClone(existing.previousManifest) : undefined,
                previousProvenance: existing.previousProvenance
                  ? structuredClone(existing.previousProvenance)
                  : undefined,
                previousTrust: existing.previousTrust,
              }
            : {}),
        state: 'installed',
        delivery: entry.delivery,
        enabled: true,
        installedAt: existing?.installedAt ?? timestamp,
        updatedAt: timestamp,
        manifest: structuredClone(entry.manifest),
        trust: entry.trust,
        provenance: provenanceFor(entry),
      };
      let artifactTransaction = noArtifactTransaction();
      let durableStateCommitted = false;
      try {
        if (!isPackageCompatible(entry.manifest, deps.appVersion)) {
          throw new Error(`Package ${id}@${entry.manifest.version} is not compatible with Tomni ${deps.appVersion}.`);
        }
        verifyDependencies(entry);
        contributionRegistry.validate(record);
        if (entry.delivery === 'downloaded-package') artifactTransaction = await installArtifact(entry);
        await stateStore.save(record);
        durableStateCommitted = true;
        contributionRegistry.register(record);
        clearContributionDiagnostic(id);
        clearReconciliationDiagnostic(id);
        emitContributionChanged();
        await artifactTransaction.finalize().catch((error: unknown): void => {
          console.error('[PackagePlatform] Failed to finalize artifact transaction:', error);
        });
        transientStates.delete(id);
        emit(id, 'installed');
        return listingFor(entry);
      } catch (error) {
        const rollbackTasks: Promise<unknown>[] = [artifactTransaction.rollback()];
        if (durableStateCommitted) {
          rollbackTasks.push(existing ? stateStore.save(existing) : stateStore.remove(id));
        }
        const rollbackResults = await Promise.allSettled(rollbackTasks);
        const rollbackErrors = rollbackResults.flatMap((result) =>
          result.status === 'rejected' ? [result.reason as unknown] : []
        );
        const failure = toPackageOperationFailure(error, 'install');
        const message = error instanceof PackageOperationError ? failure.code : errorMessage(error);
        const failureTimestamp = now();
        if (error instanceof PackageContributionRegistryError) {
          clearContributionDiagnostic(id);
          contributionDiagnostics.push({
            packageId: id,
            code: error.code,
            ...(error.failure ? { failure: error.failure } : {}),
          });
        }
        try {
          await stateStore.save(
            existing
              ? { ...existing, updatedAt: failureTimestamp, lastError: message }
              : {
                  id,
                  version: entry.manifest.version,
                  state: 'failed',
                  delivery: entry.delivery,
                  enabled: false,
                  installedAt: failureTimestamp,
                  updatedAt: failureTimestamp,
                  lastError: message,
                  manifest: structuredClone(entry.manifest),
                  trust: entry.trust,
                  provenance: provenanceFor(entry),
                }
          );
        } catch (stateError) {
          rollbackErrors.push(stateError);
        }
        transientStates.delete(id);
        emit(id, 'failed', failure.code);
        if (rollbackErrors.length > 0) {
          const aggregateError = new AggregateError(
            [error, ...rollbackErrors],
            'Package install failed and rollback was incomplete.'
          );
          aggregateError.cause = error;
          throw aggregateError;
        }
        throw error;
      }
    } finally {
      sandboxMutationLease?.release();
    }
  };

  const reserveInactiveSandboxMutation = async (
    record: InstalledPackageRecord,
    action: 'disable' | 'rollback'
  ): Promise<PackageSandboxMutationLease | undefined> => {
    if (record.manifest?.modules.every((module) => module.runtime !== 'sandboxed-web')) return undefined;
    if (!deps.isPackageSandboxActive || !deps.reservePackageSandboxMutation) {
      throw new Error(`Cannot ${action} ${record.id} because sandbox activity state is unavailable.`);
    }
    if (await deps.isPackageSandboxActive(record.id)) {
      throw new Error(`Cannot ${action} ${record.id} while its sandbox is active.`);
    }
    const lease = deps.reservePackageSandboxMutation(record.id);
    if (!lease) throw new Error(`Cannot ${action} ${record.id} while its sandbox is active.`);
    return lease;
  };

  const performEnable = async (id: string): Promise<PackageListing> => {
    const entry = entryFor(id);
    const installed = stateStore.get(id);
    if (!installed || installed.state !== 'installed') throw new Error(`Package ${id} is not installed.`);
    if (installed.enabled) return listingFor(entry);
    const manifest = installed.manifest;
    if (!manifest || manifest.id !== id || manifest.version !== installed.version) {
      throw new Error(`Package ${id} has no valid installed manifest.`);
    }
    if (!isPackageCompatible(manifest, deps.appVersion))
      throw new Error(`Package ${id} is not compatible with this Tomni version.`);
    const dependencies = resolvePackageDependencyResult(manifest, dependencyCandidateFor, 'activation');
    if (dependencies.ok === false) throw new PackageOperationError(dependencies.error);
    const next: InstalledPackageRecord = { ...installed, enabled: true, updatedAt: now(), lastError: undefined };
    contributionRegistry.validate(next);
    await stateStore.save(next);
    contributionRegistry.register(next);
    clearContributionDiagnostic(id);
    emitContributionChanged();
    emit(id, 'installed');
    return listingFor(entry);
  };

  const performDisable = async (id: string): Promise<PackageListing> => {
    const entry = entryFor(id);
    const installed = stateStore.get(id);
    if (!installed || installed.state !== 'installed') throw new Error(`Package ${id} is not installed.`);
    if (!installed.enabled) return listingFor(entry);
    const dependent = stateStore
      .list()
      .find(
        (record) =>
          record.id !== id &&
          record.state === 'installed' &&
          record.enabled &&
          record.manifest?.dependencies.some((dependency) => dependency.id === id)
      );
    if (dependent) throw new Error(`Package ${id} is required by enabled package ${dependent.id}.`);
    const lease = await reserveInactiveSandboxMutation(installed, 'disable');
    try {
      const next = { ...installed, enabled: false, updatedAt: now() };
      await stateStore.save(next);
      contributionRegistry.remove(id);
      clearContributionDiagnostic(id);
      emitContributionChanged();
      emit(id, 'installed');
      return listingFor(entry);
    } finally {
      lease?.release();
    }
  };

  const performRollback = async (id: string): Promise<PackageListing> => {
    const entry = entryFor(id);
    const installed = stateStore.get(id);
    if (!installed || installed.state !== 'installed') throw new Error(`Package ${id} is not installed.`);
    if (!installed.previousVersion) throw new Error(`Package ${id} has no rollback version.`);
    const lease = await reserveInactiveSandboxMutation(installed, 'rollback');
    try {
      const previous = await reconcileOwnedPayload(installed, installed.previousVersion, {
        manifest: installed.previousManifest,
        provenance: installed.previousProvenance,
        trust: installed.previousTrust,
      });
      const next: InstalledPackageRecord = {
        ...installed,
        version: installed.previousVersion,
        previousVersion: installed.version,
        previousManifest: installed.manifest ? structuredClone(installed.manifest) : undefined,
        previousProvenance: installed.provenance ? structuredClone(installed.provenance) : undefined,
        previousTrust: installed.trust,
        manifest: previous.manifest,
        trust: previous.trust,
        provenance: previous.provenance,
        updatedAt: now(),
        lastError: undefined,
      };
      if (next.enabled) {
        const dependencies = resolvePackageDependencyResult(next.manifest!, dependencyCandidateFor, 'activation');
        if (dependencies.ok === false) throw new PackageOperationError(dependencies.error);
        contributionRegistry.validate(next);
      }
      await stateStore.save(next);
      if (next.enabled) contributionRegistry.register(next);
      else contributionRegistry.remove(id);
      clearContributionDiagnostic(id);
      emitContributionChanged();
      emit(id, 'installed');
      return listingFor(entry);
    } finally {
      lease?.release();
    }
  };

  const performUninstall = async (id: string): Promise<PackageListing> => {
    const entry = entryFor(id);
    const installed = stateStore.get(id);
    if (!installed) {
      contributionRegistry.remove(id);
      clearContributionDiagnostic(id);
      clearReconciliationDiagnostic(id);
      return listingFor(entry);
    }

    const requireInstalledManifestForUninstall = (record: InstalledPackageRecord): PackageManifest => {
      const durableManifest = record.manifest;
      if (durableManifest?.id === record.id && durableManifest.version === record.version) {
        return durableManifest;
      }
      const cleanupCatalogManifest =
        !durableManifest && (record.state !== 'installed' || !record.enabled)
          ? catalog.get(record.id)?.manifest
          : undefined;
      if (cleanupCatalogManifest?.id === record.id && cleanupCatalogManifest.version === record.version) {
        return cleanupCatalogManifest;
      }
      throw new Error(
        `Cannot uninstall ${id} because the durable installed manifest for ${record.id} is unavailable or ambiguous.`
      );
    };
    const installedManifest = requireInstalledManifestForUninstall(installed);
    const installScope = installed.provenance?.scope ?? entry.installScope ?? 'optional';
    if (installScope === 'core') throw new Error(`Core package ${id} cannot be uninstalled.`);
    const usesSandboxedRuntime = installedManifest.modules.some(
      (module: PackageManifest['modules'][number]) => module.runtime === 'sandboxed-web'
    );
    let sandboxMutationLease: PackageSandboxMutationLease | undefined;
    if (usesSandboxedRuntime) {
      if (!deps.isPackageSandboxActive || !deps.reservePackageSandboxMutation) {
        throw new Error(`Cannot uninstall ${id} because sandbox activity state is unavailable.`);
      }
      if (await deps.isPackageSandboxActive(id)) {
        throw new Error(`Cannot uninstall ${id} while its sandbox is active.`);
      }
      sandboxMutationLease = deps.reservePackageSandboxMutation(id);
      if (!sandboxMutationLease) throw new Error(`Cannot uninstall ${id} while its sandbox is active.`);
    }

    try {
      if (installed.state === 'installed') {
        const dependent = stateStore
          .list()
          .filter((record) => record.state === 'installed')
          .find((record) =>
            requireInstalledManifestForUninstall(record).dependencies.some((dependency) => dependency.id === id)
          );
        if (dependent) throw new Error(`Package ${id} is required by installed package ${dependent.id}.`);
      }

      transientStates.set(id, 'uninstalling');
      emit(id, 'uninstalling');
      const trashedPayloads: Array<{ activePath: string; trashedPath: string }> = [];
      let durableStateRemoved = false;
      const packageRoot = path.join(packagesDir, id);
      try {
        contributionRegistry.validateRemove(id);
        if (installed.delivery === 'downloaded-package') {
          if (await exists(packageRoot)) await assertOwnedPayloadSafeForUninstall(packageRoot);
          const ownedVersions = [
            ...new Set(
              [installed.version, installed.previousVersion].filter(
                (version): version is string => version !== undefined
              )
            ),
          ];
          for (const version of ownedVersions) {
            const activePath = path.join(packageRoot, version);
            if (!(await exists(activePath))) continue;
            await assertOwnedPayloadSafeForUninstall(packageRoot, activePath);
            const trashedPath = path.join(trashDir, `${id}-${version}-${randomId()}`);
            await rename(activePath, trashedPath);
            trashedPayloads.push({ activePath, trashedPath });
          }
          await rmdir(packageRoot).catch((removeError: NodeJS.ErrnoException): void => {
            if (removeError.code !== 'ENOENT' && removeError.code !== 'ENOTEMPTY') throw removeError;
          });
        }
        await stateStore.remove(id);
        durableStateRemoved = true;
        contributionRegistry.remove(id);
        clearContributionDiagnostic(id);
        clearReconciliationDiagnostic(id);
        emitContributionChanged();
        await Promise.all(
          trashedPayloads.map(({ trashedPath }) =>
            safeRemove(trashedPath, trashDir).catch((error: unknown): void => {
              console.error('[PackagePlatform] Failed to finalize uninstall transaction:', error);
            })
          )
        );
        transientStates.delete(id);
        emit(id, 'available');
        return listingFor(entry);
      } catch (error) {
        const restoreArtifact = async (): Promise<void> => {
          for (const { activePath, trashedPath } of [...trashedPayloads].reverse()) {
            if ((await exists(trashedPath)) && !(await exists(activePath))) {
              await mkdir(path.dirname(activePath), { recursive: true });
              await rename(trashedPath, activePath);
            }
          }
        };
        const rollbackTasks: Promise<unknown>[] = [restoreArtifact()];
        if (durableStateRemoved) rollbackTasks.push(stateStore.save(installed));
        const rollbackResults = await Promise.allSettled(rollbackTasks);
        const rollbackErrors = rollbackResults.flatMap((result) =>
          result.status === 'rejected' ? [result.reason as unknown] : []
        );
        const failure = toPackageOperationFailure(error, 'uninstall');
        const message = error instanceof PackageOperationError ? failure.code : errorMessage(error);
        const rollbackIncomplete = rollbackErrors.length > 0;
        const core = isCorePackage(installed);
        const rollbackFailure = core
          ? { state: 'failed' as const, code: 'PACKAGE_CORE_REPAIR_REQUIRED' as const }
          : { state: 'quarantined' as const, code: 'PACKAGE_PAYLOAD_INCONSISTENT' as const };
        let resultingState = installed.state;
        let resultingCode = failure.code;
        try {
          if (rollbackIncomplete) {
            await recordReconciliationFailure(installed);
            resultingState = rollbackFailure.state;
            resultingCode = rollbackFailure.code;
            const dependentQuarantines = await restoreContributionRegistryFailClosed();
            for (const packageId of dependentQuarantines) {
              if (packageId !== id) emit(packageId, 'quarantined', 'PACKAGE_QUARANTINED');
            }
            emitContributionChanged();
          } else {
            await stateStore.save({ ...installed, updatedAt: now(), lastError: message });
          }
        } catch (stateError) {
          rollbackErrors.push(stateError);
        }
        transientStates.delete(id);
        emit(id, resultingState, resultingCode);
        if (rollbackErrors.length > 0) {
          const aggregateError = new AggregateError(
            [error, ...rollbackErrors],
            'Package uninstall failed and rollback was incomplete.'
          );
          aggregateError.cause = error;
          throw aggregateError;
        }
        throw error;
      }
    } finally {
      sandboxMutationLease?.release();
    }
  };

  const runOperation = (
    id: string,
    kind: OperationKind,
    operation: () => Promise<PackageListing>
  ): Promise<PackageListing> => {
    const running = operations.get(id);
    if (running) {
      if (running.kind === kind) return running.promise;
      return Promise.reject(new Error(`Package ${id} is already ${running.kind}.`));
    }
    const queued = mutationQueue
      .catch((): undefined => undefined)
      .then(async (): Promise<PackageListing> => {
        await waitForAssetReadLeases(id);
        return operation();
      });
    mutationQueue = queued.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    const promise = queued.finally(() => operations.delete(id));
    operations.set(id, { kind, promise });
    return promise;
  };

  return {
    initialize,

    refreshCatalog,
    list,
    search,
    status,
    install: (id) => runOperation(id, 'installing', () => performInstall(id)),
    enable: (id) => runOperation(id, 'enabling', () => performEnable(id)),
    disable: (id) => runOperation(id, 'disabling', () => performDisable(id)),
    rollback: (id) => runOperation(id, 'rolling-back', () => performRollback(id)),
    uninstall: (id) => runOperation(id, 'uninstalling', () => performUninstall(id)),
    contributions: async () => contributionState(),
    readAsset,
    onStateChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onContributionsChanged: (listener) => {
      contributionListeners.add(listener);
      return () => contributionListeners.delete(listener);
    },
  };
};
