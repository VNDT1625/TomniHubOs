/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opens a `web-embed` app in a Browser tab that Main creates (docs/platform/repotopackage-design.md section 10.9,
 * gap G8).
 *
 * - The request is a strict `{ packageId, connectionId }`; a `partition`, a URL or any other field is refused before
 *   anything is looked up.
 * - Main asks the app service for the address and the allowed origins, then chooses the session itself: the Browser
 *   profile partition (the same one every Browser tab uses; its web permissions are denied by default). Agent mode of
 *   the new tab stays off, because the bridge only turns it on when the person asks.
 * - The tab is guarded before it loads anything: a navigation or `window.open` to an origin the app did not declare is
 *   not followed in the app tab. An http(s) target opens in a normal Browser tab instead; any other scheme
 *   (`file:`, `javascript:`, `data:`, a custom protocol) is dropped. A tab that cannot be guarded is destroyed.
 * - The tab is created hidden; the renderer shows it through the usual tab calls, as for any Browser tab.
 */

import { openAppRequestSchema, WebEmbedError, type OpenAppResult } from '@/common/integrations/webEmbed/webEmbed';
import { BROWSER_PROFILE_PARTITION } from '@process/integrations/browserExtensions/profile';
import type { WebEmbedAppService, WebEmbedLaunch } from './webEmbedApps';

/** The only session an app tab runs in. The renderer has no say; change it here if apps get their own. */
export const WEB_EMBED_PARTITION = BROWSER_PROFILE_PARTITION;

export type AppNavigationDecision = 'allow' | 'normal-tab' | 'deny';

/** Pure policy: stay on declared origins, hand other web addresses to a normal tab, drop everything else. */
export const decideAppNavigation = (target: string, allowedOrigins: readonly string[]): AppNavigationDecision => {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return 'deny';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'deny';
  if (url.username !== '' || url.password !== '') return 'deny';
  return allowedOrigins.includes(url.origin) ? 'allow' : 'normal-tab';
};

export type AppNavigationEvent = {
  url?: string;
  isMainFrame?: boolean;
  preventDefault: () => void;
};

/** The few `WebContents` members the guard uses; the bridge narrows the real object to this. */
export type GuardedWebContents = {
  on: (
    event: 'will-navigate' | 'will-redirect',
    listener: (event: AppNavigationEvent, legacyUrl?: string) => void
  ) => unknown;
  setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void;
  loadURL: (url: string) => Promise<void>;
};

/** Installs the origin guard. Navigations of sub-frames are left alone: only the app page itself is confined. */
export const guardAppWebContents = (
  contents: GuardedWebContents,
  allowedOrigins: readonly string[],
  openNormalTab: (url: string) => void
): void => {
  const follow = (event: AppNavigationEvent, legacyUrl?: string): void => {
    if (event.isMainFrame === false) return;
    const target = event.url ?? legacyUrl ?? '';
    const decision = decideAppNavigation(target, allowedOrigins);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'normal-tab') openNormalTab(target);
  };
  contents.on('will-navigate', follow);
  contents.on('will-redirect', follow);
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideAppNavigation(url, allowedOrigins);
    if (decision === 'allow') void contents.loadURL(url).catch((): undefined => undefined);
    else if (decision === 'normal-tab') openNormalTab(url);
    return { action: 'deny' };
  });
};

/** The tab operations the opener needs; `IBrowserViewManager` provides them. */
export type WebEmbedTabManager = Readonly<{
  createTab: (options?: { partition?: string; visible?: boolean; background?: boolean; url?: string }) => string;
  destroyTab: (id: string) => void;
  loadURL: (id: string, url: string) => Promise<void>;
  listTabs: () => readonly { id: string }[];
  /** Narrowed from Electron's `WebContents` by the caller. */
  getGuardedContents: (id: string) => GuardedWebContents | undefined;
}>;

export type WebEmbedTabOpener = Readonly<{
  open: (rawRequest: unknown) => Promise<OpenAppResult>;
}>;

export type WebEmbedTabOpenerDeps = Readonly<{
  /** Resolved lazily: the connection runtime may not exist yet when the Browser bridge registers. */
  apps: () => Promise<Pick<WebEmbedAppService, 'launch'> | undefined>;
  tabs: WebEmbedTabManager;
}>;

const failure = (error: unknown): OpenAppResult => {
  if (error instanceof WebEmbedError) {
    return error.code === 'UNAVAILABLE' || error.message === error.code
      ? { ok: false, error: error.code }
      : { ok: false, error: error.code, detail: error.message.slice(0, 300) };
  }
  return { ok: false, error: 'UNAVAILABLE' };
};

export const createWebEmbedTabOpener = (deps: WebEmbedTabOpenerDeps): WebEmbedTabOpener => {
  /** One tab per app: opening it again focuses the existing tab instead of piling up copies. */
  const openTabs = new Map<string, string>();

  const createGuarded = async (launch: WebEmbedLaunch): Promise<string> => {
    const id = deps.tabs.createTab({ partition: WEB_EMBED_PARTITION, visible: false, background: false });
    const contents = deps.tabs.getGuardedContents(id);
    if (contents === undefined) {
      deps.tabs.destroyTab(id);
      throw new WebEmbedError('UNAVAILABLE');
    }
    guardAppWebContents(contents, launch.allowedOrigins, (url) => {
      // A normal tab: the default (profile) session, no partition, no guard.
      deps.tabs.createTab({ url, visible: false, background: false });
    });
    try {
      await deps.tabs.loadURL(id, launch.url);
    } catch (error) {
      deps.tabs.destroyTab(id);
      throw error;
    }
    return id;
  };

  return {
    open: async (rawRequest) => {
      const parsed = openAppRequestSchema.safeParse(rawRequest);
      if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
      try {
        const apps = await deps.apps();
        if (apps === undefined) return { ok: false, error: 'UNAVAILABLE' };
        const launch = await apps.launch(parsed.data);
        const key = `${parsed.data.packageId}\u0000${parsed.data.connectionId}`;
        const existing = openTabs.get(key);
        if (existing !== undefined && deps.tabs.listTabs().some((tab) => tab.id === existing)) {
          return { ok: true, tabId: existing };
        }
        const tabId = await createGuarded(launch);
        openTabs.set(key, tabId);
        return { ok: true, tabId };
      } catch (error) {
        return failure(error);
      }
    },
  };
};
