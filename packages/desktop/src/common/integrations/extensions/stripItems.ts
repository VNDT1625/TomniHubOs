/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns the loaded extension records into the strip's items (Main builds them; the renderer only displays them).
 * Pure: the records come from the extension host, the choices and the active origin from Main's own state.
 */

import type { ExtensionStripItem } from '@/common/integrations/extensions/stripContract';
import { effectiveSiteAccess, needsSiteAccess, type SiteAccessConfig } from './siteAccess';
import { normalizeSurfaces } from './surface';

/** The fields of a loaded extension record that the strip reads. */
export type StripRecord = Readonly<{
  extensionId: string;
  packageId: string;
  connectionId: string;
  name?: string;
  version?: string;
  surfaces?: readonly string[];
  siteAccess?: readonly string[];
  optionalSiteAccess?: readonly string[];
  iconDataUrl?: string;
}>;

export type StripBuildOptions = Readonly<{
  /** Origin of the active web tab, read by Main from the tab's own URL. Undefined when there is none. */
  activeOrigin: string | undefined;
  /** What the person chose for an extension (mode, saved sites, this run's sites). */
  configOf: (extensionId: string) => SiteAccessConfig;
  isPinned: (extensionId: string) => boolean;
}>;

/** Builds one item per extension id, sorted by name. Duplicated ids keep their first record. */
export const buildExtensionStripItems = (
  records: readonly StripRecord[],
  options: StripBuildOptions
): ExtensionStripItem[] => {
  const seen = new Set<string>();
  const items: ExtensionStripItem[] = [];
  for (const record of records) {
    if (seen.has(record.extensionId)) continue;
    seen.add(record.extensionId);
    const name = record.name !== undefined && record.name.trim() !== '' ? record.name : record.extensionId;
    const declared = record.siteAccess ?? [];
    const optional = record.optionalSiteAccess ?? [];
    const config = options.configOf(record.extensionId);
    const view = effectiveSiteAccess({ declared, optional, config });
    const needsAccess = needsSiteAccess({
      activeOrigin: options.activeOrigin,
      siteAccess: view.active,
      optionalSiteAccess: view.requestable,
      grantedOrigins: [],
    });
    items.push({
      id: record.extensionId,
      packageId: record.packageId,
      connectionId: record.connectionId,
      name,
      ...(record.version === undefined ? {} : { version: record.version }),
      surfaces: normalizeSurfaces(record.surfaces),
      needsAccess,
      pinned: options.isPinned(record.extensionId),
      siteAccess: config.mode,
      canAllowSite: needsAccess && config.mode !== 'all-sites',
      ...(record.iconDataUrl === undefined ? {} : { iconDataUrl: record.iconDataUrl }),
    });
  }
  return items.toSorted((left, right) => left.name.localeCompare(right.name));
};
