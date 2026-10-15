/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The extension host (docs/platform/repotopackage-design.md sections 12.2, 12.5 and 12.8): loads the working copy of an
 * extension into the Browser profile session, unloads it, and loads the enabled ones again at startup because Electron
 * does not remember them.
 *
 * Electron is reached only through {@link ExtensionLoaderPort}, so everything here runs under Node in tests with a
 * fake loader. This module adds no `chrome.*` API (that is T4.3) and decides nothing about approval (the connection
 * registry and `extensionHost.ts` do).
 *
 * - One operation at a time: a double click or a reconcile during an enable cannot interleave.
 * - Site access applies to content scripts as well as to the API shim: every load writes the copy's manifest from the
 *   saved source manifest and the person's choice (`applySiteAccessToManifest`). A changed choice reloads the extension
 *   at once, and a restart applies the saved choice.
 * - A load failure leaves nothing behind: the working copy and record are removed, and the error carries a reason
 *   in plain words.
 * - The id Electron reports must equal the id derived from the key; a mismatch unloads the extension.
 */

/* oxlint-disable no-await-in-loop -- loads and unloads for one profile session run in order */

import {
  extensionIdFromKey,
  generateExtensionKey,
  prepareWorkingCopy,
  readManifestFile,
  readSourceManifest,
  removeWorkingCopy,
  verifyWorkingCopy,
  workingDirectoryFor,
  WorkingCopyError,
  writeCopyManifest,
} from '@process/integrations/browserExtensions/workingCopy';
import type { ExtensionShimPort } from '@process/integrations/browserExtensions/api/types';
import type { ExtensionStore, LoadedExtensionRecord } from '@process/integrations/browserExtensions/store';
import { readExtensionIconDataUrl } from '@process/integrations/browserExtensions/state/extensionIcon';
import { inspectManifest } from '@process/integrations/browserExtensions/manifest';
import { applySiteAccessToManifest, declaredSiteAccessOf } from '@/common/integrations/extensions/contentAccess';
import { defaultSiteAccessConfig, type SiteAccessConfig } from '@/common/integrations/extensions/siteAccess';

export type LoadedExtensionInfo = Readonly<{ id: string; name: string; version: string }>;

type LoadResult = LoadedExtensionInfo & Readonly<{ notes: readonly string[] }>;

/** The part of `session.extensions` the host needs. */
export type ExtensionLoaderPort = Readonly<{
  /** Loads an unpacked extension folder. Rejects with Electron's message when it cannot. */
  load: (directory: string) => Promise<LoadedExtensionInfo>;
  /** Unloads by id. Unloading something that is not loaded must not throw. */
  unload: (extensionId: string) => Promise<void>;
}>;

export class ExtensionHostError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtensionHostError';
  }
}

export type EnableExtensionInput = Readonly<{
  packageId: string;
  connectionId: string;
  /** Absolute folder inside the package that holds `manifest.json`. Resolved by the caller. */
  sourceRoot: string;
  publicKey?: string;
  /** Header surfaces of the connection, saved with the record for the header strip. */
  surfaces?: readonly string[];
  /** Site access of the manifest and the optional site access, saved for the header strip (not a grant). */
  siteAccess?: readonly string[];
  optionalSiteAccess?: readonly string[];
}>;

export type ExtensionHostManagerDeps = Readonly<{
  loader: ExtensionLoaderPort;
  store: ExtensionStore;
  /** `<userData>/tomny-extensions`; working copies live below it. */
  workingRoot: string;
  /**
   * The `chrome.*` shim (T4.3). Its permissions for an extension are registered before the extension is loaded, so
   * they exist when its service worker reaches `starting`, and removed when it is unloaded. Without it the extension
   * runs with Electron's own APIs only.
   */
  shim?: ExtensionShimPort;
  /**
   * The person's site access choice for an extension, applied when it is loaded. `declared` is the sites the manifest
   * declares (host permissions and content script matches). Without it every extension gets the default for its
   * manifest (broad access waits for a choice).
   */
  siteAccessOf?: (extensionId: string, declared: readonly string[]) => SiteAccessConfig;
  /** Called when an extension that should be on could not be loaded at startup, with a human-readable reason. */
  onLoadError?: (packageId: string, connectionId: string, reason: string) => void | Promise<void>;
  log?: (message: string, error: unknown) => void;
}>;

export type ExtensionHostManager = Readonly<{
  /** Builds the working copy and loads it. Replaces a copy that is already loaded. Returns the stable extension id. */
  enable: (input: EnableExtensionInput) => Promise<Readonly<{ extensionId: string }>>;
  /** Unloads and deletes the working copy. Safe when it was never enabled. */
  disable: (packageId: string, connectionId: string) => Promise<void>;
  /**
   * At startup (and after a package goes away): loads the extensions in `keep` that are not loaded yet, and removes
   * the ones that are not in `keep`. `keep` holds `${packageId}\u0000extension:${connectionId}`.
   */
  reconcile: (keep: ReadonlySet<string>) => Promise<void>;
  /** Extension ids loaded by this process, for the Browser UI and tests. */
  loadedIds: () => readonly string[];
  /** Records of the extensions loaded by this process, for the header strip. Read-only copies. */
  loadedRecords: () => readonly LoadedExtensionRecord[];
  /**
   * Applies a site access choice. A loaded extension is reloaded at once with the new manifest and shim permissions; an
   * extension that is not loaded takes the choice when it next loads. Not stored here: the caller stores the choice.
   * Rejects with an `ExtensionHostError` when the reload fails (the record then carries the reason).
   */
  setSiteAccess: (extensionId: string, siteAccess: SiteAccessConfig) => Promise<void>;
  /** Unloads every extension this process loaded. Working copies stay on disk and load again at the next start. Never rejects. */
  dispose: () => Promise<void>;
}>;

/** The registry's key for an extension connection. */
export const extensionKeepKey = (packageId: string, connectionId: string): string =>
  `${packageId}\u0000extension:${connectionId}`;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Notes from the manifest rewrite as one line for the record (at most 500 characters). */
const noteText = (notes: readonly string[]): string => notes.join(' ').slice(0, 500);

export const createExtensionHostManager = (deps: ExtensionHostManagerDeps): ExtensionHostManager => {
  const log = deps.log ?? ((message: string, error: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  const loadedNow = new Map<string, string>(); // extensionId -> `${packageId}\0${connectionId}`
  let chain: Promise<unknown> = Promise.resolve();

  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.catch((): undefined => undefined).then(task);
    chain = next.catch((): undefined => undefined);
    return next;
  };

  const unloadQuietly = async (extensionId: string): Promise<void> => {
    try {
      await deps.loader.unload(extensionId);
    } catch (error) {
      log(`Could not unload extension ${extensionId}.`, error);
    }
    loadedNow.delete(extensionId);
    deps.shim?.detach(extensionId);
  };

  /** Registers what the extension may call, from its source manifest, before it is loaded. */
  const attachShim = (
    packageId: string,
    connectionId: string,
    manifest: Record<string, unknown>,
    extensionId: string,
    siteAccess: SiteAccessConfig
  ): void => {
    if (deps.shim === undefined) return;
    try {
      deps.shim.attach({ extensionId, packageId, connectionId, manifest, siteAccess });
    } catch (error) {
      throw new ExtensionHostError(`Không gắn được lớp API Chrome cho tiện ích: ${messageOf(error)}`, {
        cause: error,
      });
    }
  };

  /**
   * Loads the working copy under a site access choice: `configOverride` when a change is applied now, otherwise the
   * saved choice. The copy's manifest is rewritten from the saved source manifest first, so the copy never keeps a
   * broader state than the choice allows and a wider choice can be restored.
   */
  const loadFolder = async (
    packageId: string,
    connectionId: string,
    expectedId: string,
    configOverride?: SiteAccessConfig
  ): Promise<LoadResult> => {
    const directory = workingDirectoryFor(deps.workingRoot, packageId, connectionId);
    // Refuses a damaged or re-keyed copy before anything is rewritten or loaded.
    const summary = await verifyWorkingCopy(directory, expectedId);
    if (summary.key === undefined) {
      throw new WorkingCopyError('Bản làm việc của tiện ích không còn khớp với mã đã lưu.');
    }
    const copyManifest = (await readManifestFile(directory)) as Record<string, unknown>;
    const source = await readSourceManifest(deps.workingRoot, packageId, connectionId, copyManifest);
    const verdict = inspectManifest(source);
    if (verdict.ok === false) throw new WorkingCopyError(verdict.reason);
    const declared = declaredSiteAccessOf(verdict.summary);
    const config = configOverride ?? deps.siteAccessOf?.(expectedId, declared) ?? defaultSiteAccessConfig(declared);
    const applied = applySiteAccessToManifest(source, config);
    await writeCopyManifest(directory, { ...applied.manifest, key: summary.key });
    // The shim sees the declared sites, content script matches included, so its grants match what gets injected.
    attachShim(
      packageId,
      connectionId,
      { ...source, key: summary.key, host_permissions: declared },
      expectedId,
      config
    );

    let info: LoadedExtensionInfo;
    try {
      info = await deps.loader.load(directory);
    } catch (error) {
      deps.shim?.detach(expectedId);
      throw new ExtensionHostError(`Không nạp được tiện ích: ${messageOf(error)}`, { cause: error });
    }
    if (info.id !== expectedId) {
      await unloadQuietly(info.id);
      deps.shim?.detach(expectedId);
      throw new ExtensionHostError('Không nạp được tiện ích: mã tiện ích Electron trả về không khớp với khóa đã ghim.');
    }
    loadedNow.set(info.id, `${packageId}\u0000${connectionId}`);
    return { ...info, notes: applied.notes };
  };

  const enableNow = async (input: EnableExtensionInput): Promise<Readonly<{ extensionId: string }>> => {
    const { packageId, connectionId } = input;
    // A loaded extension holds its files, and a new copy must not be swapped in under it.
    const previous = deps.store.getLoaded(packageId, connectionId);
    if (previous) await unloadQuietly(previous.extensionId);

    const copy = await prepareWorkingCopy({
      sourceRoot: input.sourceRoot,
      workingRoot: deps.workingRoot,
      packageId,
      connectionId,
      ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
      generateKey: async () => {
        const existing = deps.store.getKey(packageId, connectionId);
        if (existing !== undefined) {
          try {
            extensionIdFromKey(existing);
            return existing;
          } catch {
            // A damaged remembered key is replaced.
          }
        }
        const created = generateExtensionKey();
        await deps.store.setKey(packageId, connectionId, created);
        return created;
      },
    });

    try {
      const { notes, ...info } = await loadFolder(packageId, connectionId, copy.extensionId);
      const iconDataUrl = await readExtensionIconDataUrl(copy.directory);
      await deps.store.saveLoaded({
        packageId,
        connectionId,
        extensionId: copy.extensionId,
        name: info.name.slice(0, 200),
        version: info.version.slice(0, 64),
        ...(input.surfaces === undefined ? {} : { surfaces: [...input.surfaces] }),
        ...(input.siteAccess === undefined ? {} : { siteAccess: [...input.siteAccess] }),
        ...(input.optionalSiteAccess === undefined ? {} : { optionalSiteAccess: [...input.optionalSiteAccess] }),
        ...(iconDataUrl === undefined ? {} : { iconDataUrl }),
        ...(notes.length === 0 ? {} : { lastError: noteText(notes) }),
      });
    } catch (error) {
      await removeWorkingCopy(deps.workingRoot, packageId, connectionId).catch((): undefined => undefined);
      await deps.store.removeLoaded(packageId, connectionId).catch((): undefined => undefined);
      throw error;
    }
    return { extensionId: copy.extensionId };
  };

  const disableNow = async (packageId: string, connectionId: string): Promise<void> => {
    const record = deps.store.getLoaded(packageId, connectionId);
    if (record) await unloadQuietly(record.extensionId);
    await removeWorkingCopy(deps.workingRoot, packageId, connectionId);
    await deps.store.removeLoaded(packageId, connectionId);
  };

  const setSiteAccessNow = async (extensionId: string, siteAccess: SiteAccessConfig): Promise<void> => {
    const record = deps.store.listLoaded().find((candidate) => candidate.extensionId === extensionId);
    // Not loaded: nothing is running with the old choice, and the new one applies when it loads.
    if (record === undefined || !loadedNow.has(extensionId)) return;
    await unloadQuietly(extensionId);
    const { lastError: _previous, ...base } = record;
    try {
      const { notes } = await loadFolder(record.packageId, record.connectionId, extensionId, siteAccess);
      await deps.store.saveLoaded({ ...base, ...(notes.length === 0 ? {} : { lastError: noteText(notes) }) });
    } catch (error) {
      const reason = messageOf(error);
      log(`Could not apply the site access of ${record.packageId}/${record.connectionId}.`, error);
      await deps.store.saveLoaded({ ...base, lastError: reason.slice(0, 500) }).catch((): undefined => undefined);
      throw error instanceof ExtensionHostError ? error : new ExtensionHostError(reason, { cause: error });
    }
  };

  const reconcileNow = async (keep: ReadonlySet<string>): Promise<void> => {
    for (const record of deps.store.listLoaded()) {
      const { packageId, connectionId } = record;
      if (!keep.has(extensionKeepKey(packageId, connectionId))) {
        await disableNow(packageId, connectionId).catch((error: unknown) =>
          log(`Could not remove extension of ${packageId}/${connectionId}.`, error)
        );
        continue;
      }
      if (loadedNow.has(record.extensionId)) continue;
      try {
        const directory = workingDirectoryFor(deps.workingRoot, packageId, connectionId);
        const { notes } = await loadFolder(packageId, connectionId, record.extensionId);
        // Records saved before icons existed get theirs now; a stale error is replaced by this load's notes.
        const iconDataUrl = record.iconDataUrl ?? (await readExtensionIconDataUrl(directory));
        const { lastError: _cleared, ...clean } = record;
        await deps.store.saveLoaded({
          ...clean,
          ...(iconDataUrl === undefined ? {} : { iconDataUrl }),
          ...(notes.length === 0 ? {} : { lastError: noteText(notes) }),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Không nạp được tiện ích.';
        log(`Could not load extension of ${packageId}/${connectionId}.`, error);
        await deps.store.saveLoaded({ ...record, lastError: reason.slice(0, 500) }).catch((): undefined => undefined);
        try {
          await deps.onLoadError?.(packageId, connectionId, reason);
        } catch (callbackError) {
          log('Load error callback failed.', callbackError);
        }
      }
    }
  };

  const disposeNow = async (): Promise<void> => {
    for (const extensionId of Array.from(loadedNow.keys())) await unloadQuietly(extensionId);
  };

  return {
    dispose: () => serialized(disposeNow),
    enable: (input) => serialized(() => enableNow(input)),
    disable: (packageId, connectionId) => serialized(() => disableNow(packageId, connectionId)),
    reconcile: (keep) => serialized(() => reconcileNow(keep)),
    loadedIds: () => [...loadedNow.keys()],
    loadedRecords: () => deps.store.listLoaded().filter((record) => loadedNow.has(record.extensionId)),
    setSiteAccess: (extensionId, siteAccess) => serialized(() => setSiteAccessNow(extensionId, siteAccess)),
  };
};
