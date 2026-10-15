/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Update from source (docs/platform/repotopackage-design.md section 9.5, criterion C6, task T2.8).
 *
 * A package that `/repotopackage` built records where it came from in `adapter.json` (`provenance`: address, ref,
 * subdirectory, commit). When the user asks, this module:
 *
 * 1. checks the recorded address for a newer commit (`checkForSourceUpdate`; never periodic, decision D18);
 * 2. fetches the source again and re-runs detection and packaging through the same signed, verified pipeline as the
 *    first build (`build`), with the same package id;
 * 3. plans the difference of connections and open items against the installed package (`planSourceUpdate`);
 * 4. installs the new version through the existing local-built path (`install`: register, install, sync), which
 *    keeps the old version for rollback and lets the connection registry decide, per connection, what stays on.
 *
 * Safety properties kept here, none of which is relaxed to make an update pass:
 *
 * - Only a package admitted as `local-built` is updated this way; a Store package never is.
 * - The rebuilt archive must report `verified` (re-read, integrity and signature checked) and carry the same
 *   package id. The package manager re-checks signature, integrity and size limits again when it installs it.
 * - Nothing is switched on. A connection that runs code and whose content changed is off until approved again; the
 *   registry enforces this from the approval hash, and as a second line this module switches off any such
 *   connection the registry left on.
 * - The network and git access (`remote`, `build`) and the package manager (`install`) are injected, so the
 *   decisions above run in unit tests with fakes.
 *
 * Wiring (Main): `build` calls `buildTomnyPackageFromRepo` with an output directory and the local signing options
 * of Main; `install` is `installLocalBuiltArtifact` bound to the package manager and the registry; `loadInstalled`
 * reads the installed package the way `connectionRuntime` does.
 */

import { adapterFromManifest, type AdapterConnectionKind, type AdapterDocument } from '@/common/packages/adapter';
import type { ConnectionRegistry, LoadedPackage } from '@process/integrations/connections/core/registry';
import type { LocalInstallOutcome } from '@process/integrations/connections/wiring/localInstall';
import type { PackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import type {
  RepoPackagingProgress,
  RepoToPackageOptions,
  RepoToPackageResult,
} from '@process/extensions/package-manager/repoPackaging/types';
import type { GitRemote } from './gitRemote';
import {
  bumpPatchVersion,
  isUpgradeVersion,
  planSourceUpdate,
  resolveUpdatableSource,
  type ConnectionUpdateCase,
  type SourceUpdatePlan,
  type UpdatableSource,
} from './updatePlan';

export type SourceUpdateErrorCode =
  | 'NOT_INSTALLED'
  | 'NOT_LOCAL_BUILT'
  | 'NO_PROVENANCE'
  | 'SOURCE_NOT_UPDATABLE'
  | 'UNVERIFIED_ARCHIVE'
  | 'PACKAGE_MISMATCH'
  | 'VERSION_UNAVAILABLE'
  | 'UPDATE_IN_PROGRESS'
  | 'CANCELLED';

/** Stable failure for the update flow; `code` is what callers branch on. Failures of the build keep their own codes. */
export class SourceUpdateError extends Error {
  readonly code: SourceUpdateErrorCode;
  constructor(code: SourceUpdateErrorCode, message: string) {
    super(message);
    this.name = 'SourceUpdateError';
    this.code = code;
  }
}

/** What the injected build is asked to do: package the recorded source again under the installed package id. */
export type SourceBuildRequest = Pick<
  RepoToPackageOptions,
  'source' | 'ref' | 'subdirectory' | 'packageId' | 'version' | 'signal' | 'onProgress'
>;

export type SourceUpdateDeps = Readonly<{
  packages: Pick<PackageManagerService, 'status'>;
  registry: Pick<ConnectionRegistry, 'view' | 'disable'>;
  /** The installed package with its adapter, read from Main's own copy. */
  loadInstalled: (packageId: string) => Promise<LoadedPackage | undefined>;
  remote: GitRemote;
  build: (request: SourceBuildRequest) => Promise<RepoToPackageResult>;
  /** Registers the archive as `local-built`, installs it over the old version and syncs the connections. */
  install: (artifactPath: string) => Promise<LocalInstallOutcome>;
  /** Removes an archive the update will not install (a preview, an unchanged source, a superseded build). */
  discardArtifact?: (artifactPath: string) => Promise<void>;
}>;

export type SourceUpdateOptions = Readonly<{
  /** Build and plan, then stop: nothing is installed. */
  preview?: boolean;
  /** Update even when the source still points at the packaged commit. */
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: RepoPackagingProgress) => void;
}>;

export type SourceUpdateCheck = Readonly<{
  status: 'update-available' | 'up-to-date' | 'unknown';
  installedCommit?: string;
  remoteCommit?: string;
}>;

export type ConnectionUpdateResult = Readonly<{
  key: string;
  kind: AdapterConnectionKind;
  /** What the plan expected. */
  change: ConnectionUpdateCase;
  wasEnabled: boolean;
  /** Where the connection stands after the update, as the registry reports it; `removed` when it is gone. */
  finalStatus: string;
  /** The connection was on before and now needs the user to approve it again. */
  reapprovalRequired: boolean;
  /** The registry left a changed code-running connection on, so this module switched it off. */
  switchedOffBySafeguard: boolean;
}>;

type Versions = Readonly<{ fromVersion: string; toVersion: string; fromCommit?: string; toCommit?: string }>;

export type SourceUpdateOutcome =
  | Readonly<{ status: 'up-to-date'; version: string; commit?: string }>
  | (Versions & Readonly<{ status: 'preview'; plan: SourceUpdatePlan }>)
  | (Versions &
      Readonly<{ status: 'updated'; plan: SourceUpdatePlan; connections: readonly ConnectionUpdateResult[] }>);

export type SourceUpdater = Readonly<{
  /** Asks the recorded address whether it moved. Reads nothing else and installs nothing. */
  check: (packageId: string, signal?: AbortSignal) => Promise<SourceUpdateCheck>;
  update: (packageId: string, options?: SourceUpdateOptions) => Promise<SourceUpdateOutcome>;
}>;

type Prepared = Readonly<{
  loaded: LoadedPackage;
  source: Extract<UpdatableSource, { ok: true }>;
  installedVersion: string;
}>;

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw new SourceUpdateError('CANCELLED', 'Đã huỷ cập nhật.');
};

const requestFor = (
  packageId: string,
  source: Prepared['source'],
  options: SourceUpdateOptions,
  version?: string
): SourceBuildRequest => ({
  source: source.url,
  packageId,
  ...(source.ref !== undefined ? { ref: source.ref } : {}),
  ...(source.subdirectory !== undefined ? { subdirectory: source.subdirectory } : {}),
  ...(version !== undefined ? { version } : {}),
  ...(options.signal !== undefined ? { signal: options.signal } : {}),
  ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
});

export const createSourceUpdater = (deps: SourceUpdateDeps): SourceUpdater => {
  const running = new Set<string>();

  const discard = async (artifactPath: string): Promise<void> => {
    try {
      await deps.discardArtifact?.(artifactPath);
    } catch {
      // A leftover archive in Main's output directory is harmless and is never installed.
    }
  };

  const prepare = async (packageId: string): Promise<Prepared> => {
    let listing: Awaited<ReturnType<PackageManagerService['status']>>;
    try {
      listing = await deps.packages.status(packageId);
    } catch {
      throw new SourceUpdateError('NOT_INSTALLED', 'Gói chưa được cài.');
    }
    if (listing.state !== 'installed' || listing.installedVersion === undefined) {
      throw new SourceUpdateError('NOT_INSTALLED', 'Gói chưa được cài.');
    }
    if (listing.installedTrust !== 'local-built' && listing.installedTrust !== 'unsigned-revoked') {
      throw new SourceUpdateError('NOT_LOCAL_BUILT', 'Chỉ gói tạo trên máy này mới cập nhật từ nguồn được.');
    }
    const loaded = await deps.loadInstalled(packageId);
    if (loaded === undefined) throw new SourceUpdateError('NOT_INSTALLED', 'Không đọc được gói đã cài.');
    const source = resolveUpdatableSource(loaded.adapter.provenance);
    if (source.ok === false) throw new SourceUpdateError(source.reason, source.message);
    return { loaded, source, installedVersion: listing.installedVersion };
  };

  /** A build that is not exactly the package being updated, or not re-verified, is never installed. */
  const assertTrustworthy = async (packageId: string, result: RepoToPackageResult): Promise<void> => {
    if (result.verified !== true) {
      await discard(result.artifactPath);
      throw new SourceUpdateError('UNVERIFIED_ARCHIVE', 'Gói mới chưa qua bước kiểm tra chữ ký và toàn vẹn.');
    }
    if (result.manifest.id !== packageId) {
      await discard(result.artifactPath);
      throw new SourceUpdateError('PACKAGE_MISMATCH', 'Gói dựng lại có mã khác với gói đang cài.');
    }
  };

  const check: SourceUpdater['check'] = async (packageId, signal) => {
    const { source } = await prepare(packageId);
    const remoteCommit = await deps.remote.resolveCommit({
      url: source.url,
      ...(source.ref !== undefined ? { ref: source.ref } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
    const known = {
      ...(source.commit !== undefined ? { installedCommit: source.commit } : {}),
      ...(remoteCommit !== undefined ? { remoteCommit } : {}),
    };
    if (remoteCommit === undefined || source.commit === undefined) return { status: 'unknown', ...known };
    return { status: remoteCommit === source.commit ? 'up-to-date' : 'update-available', ...known };
  };

  const run = async (packageId: string, options: SourceUpdateOptions): Promise<SourceUpdateOutcome> => {
    const { loaded, source, installedVersion } = await prepare(packageId);
    throwIfAborted(options.signal);

    if (options.force !== true) {
      const remoteCommit = await deps.remote.resolveCommit({
        url: source.url,
        ...(source.ref !== undefined ? { ref: source.ref } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (remoteCommit !== undefined && remoteCommit === source.commit) {
        return { status: 'up-to-date', version: installedVersion, commit: remoteCommit };
      }
    }
    throwIfAborted(options.signal);

    let result = await deps.build(requestFor(packageId, source, options));
    await assertTrustworthy(packageId, result);
    if (
      options.force !== true &&
      result.provenance.commit !== undefined &&
      result.provenance.commit === source.commit
    ) {
      // The remote could not be asked (or moved back); the fetched source is the one already installed.
      await discard(result.artifactPath);
      return { status: 'up-to-date', version: installedVersion, commit: source.commit };
    }

    if (!isUpgradeVersion(installedVersion, result.manifest.version)) {
      // The repository did not raise its version: keep the package manager's no-downgrade rule by counting up.
      const bumped = bumpPatchVersion(installedVersion);
      await discard(result.artifactPath);
      if (bumped === undefined) {
        throw new SourceUpdateError('VERSION_UNAVAILABLE', 'Không tính được số phiên bản mới cho gói.');
      }
      throwIfAborted(options.signal);
      result = await deps.build(requestFor(packageId, source, options, bumped));
      await assertTrustworthy(packageId, result);
      if (!isUpgradeVersion(installedVersion, result.manifest.version)) {
        await discard(result.artifactPath);
        throw new SourceUpdateError('VERSION_UNAVAILABLE', 'Phiên bản gói mới không cao hơn phiên bản đang cài.');
      }
    }

    const nextAdapter: AdapterDocument = result.adapter ?? adapterFromManifest(result.manifest);
    const before = await deps.registry.view(packageId);
    const enabledKeys = new Set(before.filter((view) => view.state.enabled).map((view) => view.key));
    const plan = planSourceUpdate({ previous: loaded.adapter, next: nextAdapter, enabledKeys });
    const versions: Versions = {
      fromVersion: installedVersion,
      toVersion: result.manifest.version,
      ...(source.commit !== undefined ? { fromCommit: source.commit } : {}),
      ...(result.provenance.commit !== undefined ? { toCommit: result.provenance.commit } : {}),
    };

    if (options.preview === true) {
      await discard(result.artifactPath);
      return { status: 'preview', ...versions, plan };
    }

    throwIfAborted(options.signal);
    let outcome: LocalInstallOutcome;
    try {
      outcome = await deps.install(result.artifactPath);
    } finally {
      await discard(result.artifactPath);
    }
    if (outcome.packageId !== packageId) {
      throw new SourceUpdateError('PACKAGE_MISMATCH', 'Gói vừa cài có mã khác với gói đang cập nhật.');
    }

    const statusByKey = new Map(outcome.connections.map((connection) => [connection.key, connection.status]));
    const connections: ConnectionUpdateResult[] = [];
    for (const entry of plan.connections) {
      const finalStatus = entry.change === 'removed' ? 'removed' : (statusByKey.get(entry.key) ?? 'off');
      // Second line of defence for C6: whatever the plan or the registry concluded, a connection that runs code and
      // whose content changed must not be left on.
      const mustBeOff = entry.change === 'code-changed' && entry.wasEnabled;
      const switchedOffBySafeguard = mustBeOff && finalStatus === 'on';
      // oxlint-disable-next-line no-await-in-loop -- one registry call at a time keeps the state file consistent.
      if (switchedOffBySafeguard) await deps.registry.disable(packageId, entry.key);
      connections.push({
        key: entry.key,
        kind: entry.kind,
        change: entry.change,
        wasEnabled: entry.wasEnabled,
        finalStatus: switchedOffBySafeguard ? 'off' : finalStatus,
        reapprovalRequired:
          entry.wasEnabled && entry.change !== 'removed' && (finalStatus === 'needs-input' || switchedOffBySafeguard),
        switchedOffBySafeguard,
      });
    }
    return { status: 'updated', ...versions, plan, connections };
  };

  return {
    check,
    update: async (packageId, options = {}) => {
      if (running.has(packageId)) {
        throw new SourceUpdateError('UPDATE_IN_PROGRESS', 'Gói này đang được cập nhật.');
      }
      running.add(packageId);
      try {
        return await run(packageId, options);
      } finally {
        running.delete(packageId);
      }
    },
  };
};

/** Dependencies of the read-only check: nothing is built, installed or registered. */
export type SourceCheckDeps = Pick<SourceUpdateDeps, 'packages' | 'loadInstalled' | 'remote'>;

/**
 * Read-only "is there a newer commit on GitHub?" for the Store button (S1). It runs the same eligibility rules as
 * `createSourceUpdater().check` and never builds, installs or changes a connection. Build and install are not
 * reachable from this entry point.
 */
export const checkSourceUpdate = (
  deps: SourceCheckDeps,
  packageId: string,
  signal?: AbortSignal
): Promise<SourceUpdateCheck> => {
  const refuse = (): Promise<never> =>
    Promise.reject(new SourceUpdateError('SOURCE_NOT_UPDATABLE', 'Check-only entry point cannot build or install.'));
  return createSourceUpdater({
    ...deps,
    registry: { view: refuse, disable: refuse },
    build: refuse,
    install: refuse,
  }).check(packageId, signal);
};
