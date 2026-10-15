/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Installs a package that `/repotopackage` just built on this machine (docs/platform/repotopackage-design.md
 * section 9.2): extract the signed `.tomny` into a temporary directory chosen by Main, admit it as `local-built`
 * (signature and integrity are checked against the pinned local key by the package manager), install it, and let the
 * connection registry read its adapter. Connections start off. Only a fresh install that passes an `activation` (the
 * install paths of `/repotopackage` and the repository sources) then switches on data kinds and offers the code-running
 * ones in one confirmation (`installActivation.ts`). The archive path always comes from the packager's own result, never
 * from the renderer.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ConnectionRegistry, ConnectionView } from '@process/integrations/connections/core/registry';
import type { PackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import { isSafeEntryPath } from '@process/extensions/package-manager/repoPackaging/fileScreen';
import { openZip } from '@process/extensions/package-manager/repoPackaging/streaming/zipReader';
import type { LocalSigningKeys } from './localKeys';
import {
  activateInstalledConnections,
  type InstallActivationConfirm,
  type InstallActivationReport,
} from './installActivation';

/** Same ceilings the package manager applies to a package it installs. */
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 20_000;

export type LocalInstallDeps = Readonly<{
  keys: Pick<LocalSigningKeys, 'refresh'>;
  packages: Pick<PackageManagerService, 'registerLocalPackage' | 'install' | 'status' | 'uninstall'>;
  registry: Pick<ConnectionRegistry, 'syncPackage' | 'view' | 'describe' | 'enable' | 'setAutoStart'>;
  /**
   * Present only for a fresh install that should switch connections on (see `installActivation.ts`). `confirm` is absent
   * when this machine has no confirmation window: data kinds still switch on, code-running kinds stay off.
   */
  activation?: Readonly<{ confirm?: InstallActivationConfirm }>;
  /** Parent of the temporary extraction directory; defaults to the operating system's temp directory. */
  temporaryRoot?: string;
}>;

export type LocalInstallOutcome = Readonly<{
  packageId: string;
  version: string;
  /** Connection keys and where each one stands after the sync; all `off` unless the host cannot run them. */
  connections: readonly Readonly<{ key: string; status: string; reason?: string }>[];
  /** What the activation step did; absent when the install did not ask for activation. */
  activation?: InstallActivationReport;
}>;

/**
 * Unpacks an archive into `destination` without trusting its entry names: the reader refuses `..`, absolute and
 * backslash names, and each name must also pass the packager's own safe-path rule. Only regular files are written.
 */
export const extractArtifactArchive = async (artifactPath: string, destination: string): Promise<void> => {
  const zip = await openZip(artifactPath);
  try {
    const files = zip.entries.filter((entry) => !entry.isDirectory);
    if (files.length > MAX_EXTRACTED_FILES) throw new Error(`Package exceeds ${MAX_EXTRACTED_FILES} files.`);
    if (files.reduce((total, entry) => total + entry.uncompressedSize, 0) > MAX_EXTRACTED_BYTES) {
      throw new Error('Package exceeds the size limit.');
    }
    const root = path.resolve(destination);
    const seen = new Set<string>();
    for (const entry of files) {
      if (!isSafeEntryPath(entry.name) || seen.has(entry.name.toLowerCase())) {
        throw new Error(`Unsafe package entry: ${entry.name}`);
      }
      seen.add(entry.name.toLowerCase());
      const target = path.resolve(root, ...entry.name.split('/'));
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Package entry leaves the package: ${entry.name}`);
      // oxlint-disable-next-line no-await-in-loop -- one entry at a time bounds memory and open handles.
      await mkdir(path.dirname(target), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- the reader requires each entry stream to end before the next.
      await pipeline(await zip.read(entry), createWriteStream(target, { flags: 'wx' }));
    }
  } finally {
    zip.close();
  }
};

export const installLocalBuiltArtifact = async (
  deps: LocalInstallDeps,
  artifactPath: string
): Promise<LocalInstallOutcome> => {
  // The pinned key must be the one that signed this archive, so it is loaded before anything is registered.
  await deps.keys.refresh();
  const directory = await mkdtemp(path.join(deps.temporaryRoot ?? tmpdir(), 'tomny-local-pkg-'));
  try {
    await extractArtifactArchive(artifactPath, directory);
    const listing = await deps.packages.registerLocalPackage(directory);
    const packageId = listing.manifest.id;
    // A package whose key was revoked is reinstalled from scratch, so no old connection state or approval survives.
    // A same-version reinstall would otherwise return early and keep the revoked trust.
    const previous = await deps.packages.status(packageId).catch((): undefined => undefined);
    if (previous?.state === 'installed' && previous.installedTrust === 'unsigned-revoked') {
      await deps.packages.uninstall(packageId);
    }
    const installed = await deps.packages.install(packageId);
    if (installed.state !== 'installed') throw new Error(`Package ${packageId} did not reach the installed state.`);
    const synced = await deps.registry.syncPackage(packageId);
    const activation = deps.activation
      ? await activateInstalledConnections(
          {
            registry: deps.registry,
            ...(deps.activation.confirm === undefined ? {} : { confirm: deps.activation.confirm }),
          },
          packageId,
          synced
        )
      : undefined;
    const views: readonly ConnectionView[] = activation ? await deps.registry.view(packageId) : synced;
    return {
      packageId,
      version: installed.installedVersion ?? installed.manifest.version,
      ...(activation === undefined ? {} : { activation }),
      connections: views.map((view) =>
        view.state.reason
          ? { key: view.key, status: view.state.status, reason: view.state.reason }
          : { key: view.key, status: view.state.status }
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((): undefined => undefined);
  }
};
