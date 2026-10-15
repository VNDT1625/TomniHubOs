/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The header extension strip's contract (docs/platform/repotopackage-design.md sections 12.5 and 14 S2/S5). The
 * renderer sends ids and choices only: it never sends an origin, a path, a manifest or a key. Main reads the active
 * tab itself. A response carries no path, manifest, key or grant; the icon is a data URL of the extension's own file.
 */

import type { SiteAccessMode } from './siteAccess';

export const EXTENSION_STRIP_CHANNELS = {
  list: 'core.extension-strip.list',
  setPinned: 'core.extension-strip.set-pinned',
  setSiteAccess: 'core.extension-strip.set-site-access',
  allowSite: 'core.extension-strip.allow-site',
  uninstall: 'core.extension-strip.uninstall',
} as const;

export type ExtensionStripErrorCode =
  | 'DENIED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'NO_ACTIVE_SITE'
  | 'NOT_ALLOWED'
  | 'CANCELLED'
  | 'IO_ERROR';

export type ExtensionStripItem = {
  /** Extension id (32 letters a-p), stable across restarts. */
  id: string;
  /** The package and connection the extension belongs to (used by the Store tab and uninstall). */
  packageId: string;
  connectionId: string;
  name: string;
  version?: string;
  /** Normalised surfaces; `['none']` shows on every surface. */
  surfaces: string[];
  /** The active tab's site is one the extension may ask for and does not have yet. */
  needsAccess: boolean;
  /** Pinned to the header strip (stored by Main). */
  pinned: boolean;
  /** The site access level the person chose. */
  siteAccess: SiteAccessMode;
  /** The popup may offer "allow on this site" (access is requested and the mode is not all sites). */
  canAllowSite: boolean;
  /** `data:` URL of the extension's icon, when the manifest has a usable one. */
  iconDataUrl?: string;
};

export type ExtensionStripResult =
  | { ok: true; data: ExtensionStripItem[] }
  | { ok: false; error: ExtensionStripErrorCode };

export type ExtensionStripActionResult = { ok: true } | { ok: false; error: ExtensionStripErrorCode };

export type ExtensionStripNativeAPI = {
  list: (payload: Record<string, never>) => Promise<ExtensionStripResult>;
  setPinned: (payload: { id: string; pinned: boolean }) => Promise<ExtensionStripActionResult>;
  setSiteAccess: (payload: { id: string; mode: SiteAccessMode }) => Promise<ExtensionStripActionResult>;
  /** Allows the active tab's site for one extension (saved for "on specific sites", this run only for "on click"). */
  allowSite: (payload: { id: string }) => Promise<ExtensionStripActionResult>;
  /** Removes the package that holds the extension, after a native confirmation. */
  uninstall: (payload: { packageId: string }) => Promise<ExtensionStripActionResult>;
};
