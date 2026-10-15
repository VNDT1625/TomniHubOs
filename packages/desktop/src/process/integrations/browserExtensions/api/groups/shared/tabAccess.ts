/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What an extension may see and touch of the Browser's tabs (docs/platform/repotopackage-design.md sections 12.3
 * and 15). The port only ever lists tabs of the Browser profile session that a person could be looking at; this file
 * decides, per extension, which of those it may know about.
 *
 * A tab is visible to an extension when it holds the `tabs` permission, or a host permission (required, or granted
 * later) covers the tab's URL, or the tab shows a page of the extension itself. A tab that is not visible is treated
 * as absent: it is left out of `query`, answers "No tab with id" to `get`, `update` and `remove`, and no event
 * about it is sent, so the answer is the same whether the tab exists or not. This is stricter than Chrome, which
 * lets any extension close or navigate a tab it cannot read. `activeTab` is not honored here: the temporary grant
 * belongs to the toolbar (T4.5).
 */

import type { ExtensionGrants } from '@process/integrations/browserExtensions/api/grants';
import { urlCoveredBy } from '@process/integrations/browserExtensions/api/matchPattern';

/** The one virtual window of the Browser. */
export const BROWSER_WINDOW_ID = 1;
/** `chrome.windows.WINDOW_ID_CURRENT`. */
export const WINDOW_ID_CURRENT = -2;

/** A tab as the host reports it. `id` is the id of its `webContents`, the id Electron uses for tabs. */
export type PortTab = Readonly<{
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl?: string;
  active: boolean;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  width: number;
  height: number;
}>;

export const canSeeTab = (grants: ExtensionGrants, tab: PortTab): boolean =>
  grants.hasPermission('tabs') ||
  tab.url.startsWith(`chrome-extension://${grants.extensionId}/`) ||
  urlCoveredBy(grants.granted().origins, tab.url);

/** The `chrome.tabs.Tab` object. `reveal` false removes the address, title and icon. */
export const toChromeTab = (tab: PortTab, reveal: boolean): Record<string, unknown> => ({
  id: tab.id,
  index: tab.index,
  windowId: tab.windowId,
  groupId: -1,
  active: tab.active,
  highlighted: tab.active,
  pinned: false,
  incognito: false,
  discarded: false,
  autoDiscardable: true,
  audible: tab.audible,
  mutedInfo: { muted: tab.muted },
  status: tab.loading ? 'loading' : 'complete',
  width: tab.width,
  height: tab.height,
  ...(reveal ? { url: tab.url, title: tab.title } : {}),
  ...(reveal && tab.favIconUrl !== undefined && tab.favIconUrl !== '' ? { favIconUrl: tab.favIconUrl } : {}),
});

/** URLs an extension may open a tab on: the web, a blank page, and its own pages. Nothing else (no `javascript:`). */
export const isNavigableUrl = (grants: ExtensionGrants, value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.username === '' && url.password === '';
  if (url.protocol === 'about:') return value === 'about:blank';
  if (url.protocol === 'chrome-extension:') return url.hostname === grants.extensionId;
  return false;
};
