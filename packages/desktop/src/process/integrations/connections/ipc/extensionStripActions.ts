/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the header strip and the Store tab may change for an extension (docs/platform/repotopackage-design.md sections
 * 12.5 and 14 S2/S5). Each action takes only the ids the renderer may name. Everything else is resolved here, in Main:
 * the loaded record, the manifest's declared site access, and the origin of the active tab. A renderer never supplies
 * an origin, and a grant is refused unless the manifest covers the origin.
 */

import {
  isGrantableOrigin,
  type SiteAccessConfig,
  type SiteAccessMode,
} from '@/common/integrations/extensions/siteAccess';
import type {
  ExtensionStripActionResult,
  ExtensionStripErrorCode,
} from '@/common/integrations/extensions/stripContract';
import type { StripRecord } from '@/common/integrations/extensions/stripItems';
import type { ExtensionUserState } from '@process/integrations/browserExtensions/state/userState';

export type ExtensionStripActionDeps = Readonly<{
  /** The loaded extensions, as the extension host reports them. */
  records: () => Promise<readonly StripRecord[]>;
  userState: () => Promise<ExtensionUserState>;
  /** Origin of the active web tab, read by Main from the tab itself. Undefined when there is no web tab. */
  activeOrigin: () => string | undefined;
  /** Hands the new choice to the extension host, so it applies to a loaded extension at once. */
  applySiteAccess: (extensionId: string, config: SiteAccessConfig) => Promise<void>;
  /** True when the package has at least one extension connection. */
  isExtensionPackage: (packageId: string) => Promise<boolean>;
  /** The native confirmation. False when the person cancels. */
  confirmUninstall: (packageId: string) => Promise<boolean>;
  /** Removes the package through the package manager's own uninstall. */
  uninstallPackage: (packageId: string) => Promise<void>;
  log?: (message: string, error: unknown) => void;
}>;

export type ExtensionStripActions = Readonly<{
  setPinned: (id: string, pinned: boolean) => Promise<ExtensionStripActionResult>;
  setSiteAccess: (id: string, mode: SiteAccessMode) => Promise<ExtensionStripActionResult>;
  allowSite: (id: string) => Promise<ExtensionStripActionResult>;
  uninstall: (packageId: string) => Promise<ExtensionStripActionResult>;
}>;

const failure = (error: ExtensionStripErrorCode): ExtensionStripActionResult => ({ ok: false, error });
const success: ExtensionStripActionResult = { ok: true };

export const createExtensionStripActions = (deps: ExtensionStripActionDeps): ExtensionStripActions => {
  /** Reloads the extension with the choice. False when the reload failed; the choice itself is already saved. */
  const applyOrReport = async (id: string, config: SiteAccessConfig): Promise<boolean> => {
    try {
      await deps.applySiteAccess(id, config);
      return true;
    } catch (error) {
      deps.log?.(`Could not apply the site access of extension ${id}.`, error);
      return false;
    }
  };

  const recordOf = async (id: string): Promise<StripRecord | undefined> =>
    (await deps.records()).find((record) => record.extensionId === id);

  return {
    setPinned: async (id, pinned) => {
      if ((await recordOf(id)) === undefined) return failure('NOT_FOUND');
      await (await deps.userState()).setPinned(id, pinned);
      return success;
    },

    setSiteAccess: async (id, mode) => {
      const record = await recordOf(id);
      if (record === undefined) return failure('NOT_FOUND');
      const state = await deps.userState();
      await state.setMode(id, mode);
      if (!(await applyOrReport(id, state.configOf(id, record.siteAccess ?? [])))) return failure('IO_ERROR');
      return success;
    },

    allowSite: async (id) => {
      const record = await recordOf(id);
      if (record === undefined) return failure('NOT_FOUND');
      const origin = deps.activeOrigin();
      if (origin === undefined) return failure('NO_ACTIVE_SITE');
      const declared = record.siteAccess ?? [];
      // A grant only narrows what the manifest already declares (required or optional): anything else is refused.
      if (!isGrantableOrigin(origin, declared, record.optionalSiteAccess ?? [])) return failure('NOT_ALLOWED');
      const state = await deps.userState();
      await state.allowOrigin(id, origin, declared);
      if (!(await applyOrReport(id, state.configOf(id, declared)))) return failure('IO_ERROR');
      return success;
    },

    uninstall: async (packageId) => {
      if (!(await deps.isExtensionPackage(packageId))) return failure('NOT_FOUND');
      if (!(await deps.confirmUninstall(packageId))) return failure('CANCELLED');
      const extensionIds = (await deps.records())
        .filter((record) => record.packageId === packageId)
        .map((record) => record.extensionId);
      try {
        await deps.uninstallPackage(packageId);
      } catch (error) {
        deps.log?.(`Could not uninstall the package ${packageId}.`, error);
        return failure('IO_ERROR');
      }
      const state = await deps.userState();
      await Promise.all(extensionIds.map((id) => state.forget(id)));
      return success;
    },
  };
};
