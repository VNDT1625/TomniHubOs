/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Main-side port behind the agent tools `browser_extension_list` and `browser_extension_action`
 * (docs/platform/repotopackage-design.md section 12.7). It reads what the connection registry knows about each
 * extension connection and which extensions the extension host has loaded now. It never switches an extension on or
 * off: enabling needs the person's approval (the registry's approval hash), which the agent cannot give.
 *
 * Every source is injected, so this runs under Node in tests. {@link createDefaultBrowserExtensionControl} binds the
 * real package manager, connection registry and extension host, loading them on first use.
 */

import type {
  BrowserExtensionControl,
  BrowserExtensionPopupResult,
  BrowserExtensionSummary,
} from '@process/browser/browserControlServer';
import type { LoadedExtensionRecord } from '@process/integrations/browserExtensions/store';
import type { ConnectionView } from '@process/integrations/connections/core/registry';

export type BrowserExtensionControlDeps = Readonly<{
  /** Ids of the installed packages. */
  listPackageIds: () => Promise<readonly string[]>;
  /** Connection views of one package, as the connection registry reports them. */
  viewsOf: (packageId: string) => Promise<readonly ConnectionView[]>;
  /** Extensions this process has loaded now, with their stable ids. */
  loaded: () => Promise<readonly LoadedExtensionRecord[]>;
  /** Whether the person pinned the extension to the header strip. Absent: the pin state is unknown (null). */
  isPinned?: (extensionId: string) => Promise<boolean>;
  /** Asks the Browser toolbar to open an extension popup. Reports a reason when it cannot. */
  requestPopup: (extensionId: string, tabId: string | undefined) => Promise<BrowserExtensionPopupResult>;
}>;

/**
 * Builds the agent view of the extensions. A package whose state cannot be read is left out of the list rather than
 * reported with guessed values.
 */
export const createBrowserExtensionControl = (deps: BrowserExtensionControlDeps): BrowserExtensionControl => ({
  list: async (): Promise<readonly BrowserExtensionSummary[]> => {
    const loaded = await deps.loaded();
    const found: BrowserExtensionSummary[] = [];
    for (const packageId of await deps.listPackageIds()) {
      let views: readonly ConnectionView[];
      try {
        views = await deps.viewsOf(packageId);
      } catch {
        continue;
      }
      for (const view of views) {
        const { connection, state } = view;
        if (connection.kind !== 'extension') continue;
        const record = loaded.find((item) => item.packageId === packageId && item.connectionId === connection.id);
        found.push({
          extensionId: record?.extensionId ?? null,
          packageId,
          connectionId: connection.id,
          name: connection.title,
          version: connection.version ?? record?.version ?? null,
          enabled: state.enabled,
          loaded: record !== undefined,
          // oxlint-disable-next-line no-await-in-loop -- one read of the small pin state per extension, in order
          pinned: record === undefined || deps.isPinned === undefined ? null : await deps.isPinned(record.extensionId),
          permissions: [...connection.permissions],
          hostPermissions: [...connection.hostPermissions],
          lastError: state.lastError ?? record?.lastError ?? null,
        });
      }
    }
    return found;
  },
  openPopup: (extensionId: string, tabId: string | undefined) => deps.requestPopup(extensionId, tabId),
});

/**
 * The production port. The package manager, the connection registry and the extension host are loaded on first use
 * (a dynamic import), so building the Browser tools never starts them.
 */
export const createDefaultBrowserExtensionControl = (): BrowserExtensionControl =>
  createBrowserExtensionControl({
    listPackageIds: async () => {
      const bridge = await import('@process/extensions/package-manager/packageBridge');
      const listings = await bridge.getPackageManagerService().list({ installedOnly: true });
      return listings.map((listing) => listing.manifest.id);
    },
    viewsOf: async (packageId) => {
      const bridge = await import('@process/extensions/package-manager/packageBridge');
      return bridge.getConnectionRegistry().view(packageId);
    },
    loaded: async () => {
      const host = await import('@process/integrations/connections/hosts/exec/extensionHost');
      return host.loadedExtensionRecords();
    },
    isPinned: async (extensionId) => {
      const { app } = await import('electron');
      const path = await import('node:path');
      const state = await import('@process/integrations/browserExtensions/state/userState');
      const pinned = await state.sharedExtensionUserState(
        path.default.join(app.getPath('userData'), state.EXTENSION_PREFS_FILE)
      );
      return pinned.isPinned(extensionId);
    },
    // The Browser toolbar that draws extension buttons (T4.5) does not exist yet; nothing listens for popup requests.
    requestPopup: async () => ({
      ok: false,
      reason: 'The Browser toolbar that shows extension buttons is not built yet, so no popup can be opened.',
    }),
  });
