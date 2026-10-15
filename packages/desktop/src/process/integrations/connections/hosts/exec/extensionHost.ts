/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `extension` (docs/platform/repotopackage-design.md sections 9.3, 10.8, 12.2, 12.8, 15.1).
 *
 * - Enabling copies the extension from the package `source/` folder to a working copy under `userData`, pins a
 *   manifest `key` so the extension id never changes, and loads it into the Browser profile session. Disabling,
 *   removing the package and `reconcile` unload it; `reconcile` also loads the enabled ones again at startup
 *   because Electron forgets them. The work is done by `browserExtensions/host.ts`; this file maps the connection
 *   contract onto it.
 * - Only Manifest V3 runs. An MV2 extension with a background script is `unsupported` with the reason "cần bản
 *   Manifest V3" (spike S-3). Userscripts and extensions that need a build are `unsupported` for now.
 * - The approval shows the permissions, host permissions (site access), content script matches and the Chrome APIs
 *   the host cannot provide. Its hash covers `manifest.json` and every file in the extension that can run
 *   (scripts, pages, styles, wasm), so any change to code needs a new approval.
 * - No `chrome.*` shims here (T4.3). Nothing is read from a path the renderer sent: the folder comes from the
 *   connection's `root`, checked to be below the package's `source/` folder after symlinks are resolved.
 */

import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { inspectManifest, type ManifestSummary } from '@process/integrations/browserExtensions/manifest';
import type { ExtensionHostManager } from '@process/integrations/browserExtensions/host';
import type { LoadedExtensionRecord } from '@process/integrations/browserExtensions/store';
import { declaredSiteAccessOf } from '@/common/integrations/extensions/contentAccess';
import type { StripRecord } from '@/common/integrations/extensions/stripItems';
import {
  MANIFEST_FILE,
  WorkingCopyError,
  extensionIdFromKey,
  readManifestFile,
  scanExtensionSource,
} from '@process/integrations/browserExtensions/workingCopy';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type ExtensionConnection = ConnectionOf<'extension'>;

const SOURCE_PREFIX = 'source/';

export type ExtensionHostDeps = Readonly<{
  /**
   * The manager that loads extensions. Defaults to the real one (Electron, `userData`), created on first use so
   * building the registry never needs Electron. `onLoadError` is given to it for startup failures.
   */
  manager?: () => Promise<ExtensionHostManager>;
  /** Reports an extension that should be on but could not be loaded at startup (shown as the connection status). */
  onLoadError?: (packageId: string, connectionId: string, reason: string) => void | Promise<void>;
}>;

type Inspected = Readonly<{ ok: true; sourceRoot: string; summary: ManifestSummary; codeFiles: readonly string[] }>;
type Problem = Readonly<{ ok: false; reason: string }>;

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Resolves the extension folder of a connection, below the package's `source/` folder. */
const resolveSourceRoot = async (context: HostContext, connection: ExtensionConnection): Promise<string | Problem> => {
  const root = connection.root.replace(/\/+$/, '');
  if (!root.startsWith(SOURCE_PREFIX)) {
    return { ok: false, reason: 'Thư mục tiện ích phải nằm trong thư mục source của gói.' };
  }
  try {
    const packageReal = await realpath(context.packageDirectory);
    const sourceReal = await realpath(path.join(packageReal, 'source'));
    const target = await realpath(path.join(packageReal, ...root.split('/')));
    return isInside(sourceReal, target) || target === sourceReal
      ? target
      : { ok: false, reason: 'Thư mục tiện ích nằm ngoài gói.' };
  } catch {
    return { ok: false, reason: 'Không tìm thấy thư mục tiện ích trong gói.' };
  }
};

const inspectSource = async (context: HostContext, connection: ExtensionConnection): Promise<Inspected | Problem> => {
  if (connection.format === 'userscript') {
    return { ok: false, reason: 'Userscript chưa được hỗ trợ ở phiên bản này.' };
  }
  if (connection.needsBuild === true) {
    return { ok: false, reason: 'Tiện ích này cần được build trước khi nạp; bản này chưa tự build.' };
  }
  const sourceRoot = await resolveSourceRoot(context, connection);
  if (typeof sourceRoot !== 'string') return sourceRoot;
  try {
    const scan = await scanExtensionSource(sourceRoot);
    const verdict = inspectManifest(await readManifestFile(sourceRoot));
    if (verdict.ok === false) return { ok: false, reason: verdict.reason };
    return { ok: true, sourceRoot, summary: verdict.summary, codeFiles: scan.codeFiles };
  } catch (error) {
    if (error instanceof WorkingCopyError) return { ok: false, reason: error.message };
    return { ok: false, reason: 'Không đọc được tiện ích trong gói.' };
  }
};

const list = (items: readonly string[]): string => (items.length > 0 ? items.join(', ') : 'none');

/** The id the extension will have, when the key is already known (connection or manifest); else undefined. */
const knownId = (connection: ExtensionConnection, summary: ManifestSummary): string | undefined => {
  const key = connection.publicKey ?? summary.key;
  if (key === undefined) return undefined;
  try {
    return extensionIdFromKey(key);
  } catch {
    return undefined;
  }
};

const subjectOf = (connection: ExtensionConnection, inspected: Inspected): ApprovalSubject => {
  const { summary } = inspected;
  const root = connection.root.replace(/\/+$/, '');
  return {
    kind: 'extension',
    title: connection.title,
    lines: [
      { label: 'Type', value: `Browser extension (Manifest V${summary.manifestVersion}), runs in the Browser profile` },
      { label: 'Name', value: `${summary.name} ${summary.version}` },
      { label: 'Extension id', value: knownId(connection, summary) ?? 'fixed on first enable' },
      { label: 'Permissions', value: list(summary.permissions) },
      { label: 'Optional permissions', value: list(summary.optionalPermissions) },
      { label: 'Site access (host permissions)', value: list(summary.hostPermissions) },
      { label: 'Optional site access', value: list(summary.optionalHostPermissions) },
      { label: 'Content scripts run on', value: list(summary.contentScriptMatches) },
      { label: 'Chrome APIs not available here', value: list(connection.unsupported) },
    ],
    // Manifest first, then every file that can run; sorted so the hash does not depend on directory order.
    files: [
      `${root}/${MANIFEST_FILE}`,
      ...inspected.codeFiles.filter((file) => file !== MANIFEST_FILE).map((file) => `${root}/${file}`),
    ].toSorted(),
  };
};

let defaultManager: Promise<ExtensionHostManager> | undefined;
let loadErrorSink: ((packageId: string, connectionId: string, reason: string) => void | Promise<void>) | undefined;

/**
 * The app's extension manager: one per process, since it owns the one Browser session and its state file. The first
 * caller that passes `onLoadError` sets where startup load failures are reported; later callers reuse the manager.
 */
export const defaultExtensionHostManager = (
  onLoadError?: (packageId: string, connectionId: string, reason: string) => void | Promise<void>
): Promise<ExtensionHostManager> => {
  if (onLoadError !== undefined) loadErrorSink = onLoadError;
  defaultManager ??= import('@process/integrations/browserExtensions/electronLoader').then((module) =>
    module.createDefaultExtensionHostManager((packageId, connectionId, reason) =>
      loadErrorSink?.(packageId, connectionId, reason)
    )
  );
  return defaultManager;
};

/** Unloads the browser extensions this process loaded, at quit. A manager that never started has nothing to unload. Never rejects. */
export const disposeDefaultExtensionHostManager = async (): Promise<void> => {
  if (defaultManager === undefined) return;
  try {
    await (await defaultManager).dispose();
  } catch (error) {
    console.error('[ConnectionHosts] Could not unload the browser extensions at quit.', error);
  }
};

/**
 * Records of the extensions loaded in this process, for the header strip. Until something has asked for the default
 * manager (an enable, or the startup reconcile) nothing can be loaded, so this returns an empty list and starts
 * nothing.
 */
export const loadedExtensionRecords = async (): Promise<readonly LoadedExtensionRecord[]> => {
  if (defaultManager === undefined) return [];
  return (await defaultManager).loadedRecords();
};

/** The loaded extensions as the header strip reads them. A record without a usable id is left out. */
export const loadedStripRecords = async (): Promise<readonly StripRecord[]> =>
  (await loadedExtensionRecords()).flatMap((record): StripRecord[] =>
    typeof record.extensionId === 'string'
      ? [
          {
            extensionId: record.extensionId,
            packageId: record.packageId,
            connectionId: record.connectionId,
            name: record.name,
            version: record.version,
            surfaces: record.surfaces,
            siteAccess: record.siteAccess,
            optionalSiteAccess: record.optionalSiteAccess,
            iconDataUrl: record.iconDataUrl,
          },
        ]
      : []
  );

export const createExtensionHost = (deps: ExtensionHostDeps = {}): AnyConnectionHost => {
  const managerOf = deps.manager ?? (() => defaultExtensionHostManager(deps.onLoadError));

  const check = async (context: HostContext, connection: ExtensionConnection): Promise<HostCheck> => {
    const inspected = await inspectSource(context, connection);
    return inspected.ok === false ? { ok: false, reason: inspected.reason } : { ok: true };
  };

  return defineConnectionHost({
    kind: 'extension',
    check,
    describe: async (context, connection: ExtensionConnection) => {
      const inspected = await inspectSource(context, connection);
      if (inspected.ok === false) throw new Error(inspected.reason);
      return subjectOf(connection, inspected);
    },
    enable: async (context, connection: ExtensionConnection) => {
      const inspected = await inspectSource(context, connection);
      if (inspected.ok === false) throw new Error(inspected.reason);
      const { extensionId } = await (
        await managerOf()
      ).enable({
        packageId: context.packageId,
        connectionId: connection.id,
        sourceRoot: inspected.sourceRoot,
        ...(connection.publicKey === undefined ? {} : { publicKey: connection.publicKey }),
        surfaces: connection.surfaces ?? [],
        siteAccess: declaredSiteAccessOf(inspected.summary),
        optionalSiteAccess: inspected.summary.optionalHostPermissions,
      });
      return { installed: [extensionId] };
    },
    disable: async (context, connection: ExtensionConnection, _installed) => {
      await (await managerOf()).disable(context.packageId, connection.id);
    },
    reconcile: async ({ keep }) => {
      await (await managerOf()).reconcile(keep);
    },
  });
};
