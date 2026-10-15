/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real {@link TabsPort}: Browser tabs seen through the `BrowserViewManager` (docs/platform/repotopackage-design.md
 * section 12.3). Electron is reached through small structural types, so the behavior runs under Node in tests.
 *
 * What counts as a tab for an extension: a managed tab whose `webContents` belongs to the Browser profile session
 * and that is not a hidden research tab. A web-embed tab (its own partition) or an agent's scraping tab never
 * appears. The tab id is the id of its `webContents`, which is the id Electron itself uses for tabs.
 *
 * Limits of this version, kept visible: a tab opened for an extension is created and shown by the manager, but the
 * Browser page of the renderer has no tab-strip entry for it until the toolbar work (T4.5) tells the renderer about
 * Main-created tabs; and `activeTab` style temporary access is not modeled.
 */

import type { BrowserTabId, BrowserTabInfo } from '@process/browser/browserViewManager';
import type { PortTab } from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import { BROWSER_WINDOW_ID } from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import type {
  TabChanges,
  TabsPort,
  TabsPortEvent,
} from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import type { BrowserTabLifecycleEvent } from '@process/integrations/browserExtensions/wiring/tabLifecycle';

/** The part of `webContents` this wiring uses. */
export type TabContents = Readonly<{
  id: number;
  session: unknown;
  getURL: () => string;
  getTitle: () => string;
  isLoading: () => boolean;
  isDestroyed: () => boolean;
  isAudioMuted: () => boolean;
  isCurrentlyAudible: () => boolean;
  setAudioMuted: (muted: boolean) => void;
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  removeListener: (event: string, listener: (...args: never[]) => void) => unknown;
}>;

/** The part of the view manager this wiring uses. */
export type TabsViewManager = Readonly<{
  listTabs: () => BrowserTabInfo[];
  getWebContents: (id: BrowserTabId) => unknown;
  createTab: (options: { url?: string; visible: boolean; background: boolean }) => BrowserTabId;
  destroyTab: (id: BrowserTabId) => void;
  loadURL: (id: BrowserTabId, url: string) => Promise<void>;
  show: (id: BrowserTabId) => void;
}>;

export type BrowserTabsPortDeps = Readonly<{
  viewManager: TabsViewManager;
  /** The Browser profile session; a tab in any other session is not a tab for extensions. */
  profileSession: unknown;
  subscribeLifecycle: (listener: (event: BrowserTabLifecycleEvent) => void) => () => void;
  log?: (message: string, error?: unknown) => void;
}>;

/** A tab being watched: the extension-facing id, and the contents to attach more listeners to. */
export type WatchedTab = Readonly<{ tabId: number; contents: TabContents }>;

export type BrowserTabsAdapter = Readonly<{
  port: TabsPort;
  /**
   * Calls `attach` for every current and future user tab; its return value runs when the tab goes away. Returns the
   * function that stops watching. Used by the context menu wiring so there is one tab registry.
   */
  watch: (attach: (tab: WatchedTab) => (() => void) | void) => () => void;
  dispose: () => void;
}>;

type Entry = { key: BrowserTabId; contents: TabContents; favIconUrl?: string; cleanups: (() => void)[] };

const isContents = (value: unknown): value is TabContents =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'number' &&
  typeof (value as { on?: unknown }).on === 'function' &&
  typeof (value as { getURL?: unknown }).getURL === 'function';

export const createBrowserTabsAdapter = (deps: BrowserTabsPortDeps): BrowserTabsAdapter => {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  const entries = new Map<BrowserTabId, Entry>();
  const listeners = new Set<(event: TabsPortEvent) => void>();
  const watchers = new Set<(tab: WatchedTab) => (() => void) | void>();
  let activeKey: BrowserTabId | undefined;

  const emit = (event: TabsPortEvent): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (error) {
        log('A tab listener failed.', error);
      }
    }
  };

  const attachments = new Map<(tab: WatchedTab) => (() => void) | void, Set<() => void>>();
  /** Runs a watcher on one tab; its cleanup runs once, when the tab goes or the watcher is removed. */
  const attachTo = (watcher: (tab: WatchedTab) => (() => void) | void, entry: Entry): void => {
    try {
      const cleanup = watcher({ tabId: entry.contents.id, contents: entry.contents });
      if (typeof cleanup !== 'function') return;
      let done = false;
      const once = (): void => {
        if (done) return;
        done = true;
        cleanup();
      };
      entry.cleanups.push(once);
      const group = attachments.get(watcher) ?? new Set<() => void>();
      group.add(once);
      attachments.set(watcher, group);
    } catch (error) {
      log('A tab watcher failed.', error);
    }
  };

  const toPortTab = (
    info: BrowserTabInfo,
    entry: Entry,
    index: number,
    activeId: BrowserTabId | undefined
  ): PortTab => {
    const { contents } = entry;
    const alive = !contents.isDestroyed();
    return {
      id: contents.id,
      windowId: BROWSER_WINDOW_ID,
      index,
      url: alive ? contents.getURL() : info.url,
      title: alive ? contents.getTitle() : info.title,
      ...(entry.favIconUrl === undefined ? {} : { favIconUrl: entry.favIconUrl }),
      active: info.id === activeId,
      loading: alive && contents.isLoading(),
      audible: alive && contents.isCurrentlyAudible(),
      muted: alive && contents.isAudioMuted(),
      width: info.bounds.width,
      height: info.bounds.height,
    };
  };

  /** Visible user tabs in manager order, with the one that is in front. */
  const snapshot = (): { tab: PortTab; entry: Entry }[] => {
    const infos = deps.viewManager.listTabs().filter((info) => entries.has(info.id));
    const visible = infos.filter((info) => info.visible);
    const activeId = visible.some((info) => info.id === activeKey) ? activeKey : visible[0]?.id;
    return infos.map((info, index) => {
      const entry = entries.get(info.id) as Entry;
      return { tab: toPortTab(info, entry, index, activeId), entry };
    });
  };
  const find = (tabId: number): { tab: PortTab; entry: Entry } | undefined =>
    snapshot().find((item) => item.tab.id === tabId);
  const current = (key: BrowserTabId): PortTab | undefined => snapshot().find((item) => item.entry.key === key)?.tab;

  const hook = (entry: Entry): void => {
    const { contents } = entry;
    const key = entry.key;
    const on = (event: string, listener: (...args: never[]) => void): void => {
      contents.on(event, listener);
      entry.cleanups.push(() => {
        try {
          contents.removeListener(event, listener);
        } catch {
          // The contents may be gone already.
        }
      });
    };
    const changed = (changes: TabChanges): void => {
      const tab = current(key);
      if (tab !== undefined) emit({ type: 'updated', tab, changes });
    };
    on('did-start-loading', () => changed({ status: 'loading' }));
    on('did-stop-loading', () => changed({ status: 'complete' }));
    on('did-navigate', ((_event: unknown, url: string) => changed({ url })) as (...args: never[]) => void);
    on('did-navigate-in-page', ((_event: unknown, url: string) => changed({ url })) as (...args: never[]) => void);
    on('page-title-updated', ((_event: unknown, title: string) => changed({ title })) as (...args: never[]) => void);
    on('page-favicon-updated', ((_event: unknown, favicons: readonly string[]) => {
      const [icon] = favicons;
      if (typeof icon !== 'string') return;
      entry.favIconUrl = icon;
      changed({ favIconUrl: icon });
    }) as (...args: never[]) => void);
    on('audio-state-changed', ((event: { audible?: boolean }) => changed({ audible: event.audible === true })) as (
      ...args: never[]
    ) => void);
  };

  const adopt = (key: BrowserTabId): void => {
    if (entries.has(key)) return;
    const contents = deps.viewManager.getWebContents(key);
    if (!isContents(contents) || contents.session !== deps.profileSession) return;
    const info = deps.viewManager.listTabs().find((candidate) => candidate.id === key);
    if (info === undefined || info.background === true) return;
    const entry: Entry = { key, contents, cleanups: [] };
    entries.set(key, entry);
    hook(entry);
    for (const watcher of Array.from(watchers)) attachTo(watcher, entry);
  };

  const release = (key: BrowserTabId): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    for (const cleanup of entry.cleanups) {
      try {
        cleanup();
      } catch {
        // Cleanup is best effort.
      }
    }
    if (activeKey === key) activeKey = undefined;
    emit({ type: 'removed', tabId: entry.contents.id, windowId: BROWSER_WINDOW_ID });
  };

  for (const info of deps.viewManager.listTabs()) adopt(info.id);
  const unsubscribe = deps.subscribeLifecycle((event) => {
    if (event.type === 'created') {
      adopt(event.id);
      const tab = entries.has(event.id) ? current(event.id) : undefined;
      if (tab !== undefined) emit({ type: 'created', tab });
    } else if (event.type === 'destroyed') {
      release(event.id);
    } else if (entries.has(event.id)) {
      activeKey = event.id;
      const tab = current(event.id);
      if (tab !== undefined) emit({ type: 'activated', tabId: tab.id, windowId: BROWSER_WINDOW_ID });
    }
  });

  const port: TabsPort = {
    list: () => snapshot().map((item) => item.tab),
    create: async ({ url, active }) => {
      // `background: false` keeps the tab a user tab: a hidden tab would otherwise count as research and stay muted.
      const key = deps.viewManager.createTab({
        ...(url === undefined ? {} : { url }),
        visible: active,
        background: false,
      });
      adopt(key);
      if (active) deps.viewManager.show(key);
      const tab = current(key);
      if (tab === undefined) throw new Error('The new tab is not a Browser profile tab.');
      return tab;
    },
    navigate: async (tabId, url) => {
      const found = find(tabId);
      if (found !== undefined) await deps.viewManager.loadURL(found.entry.key, url);
    },
    activate: (tabId) => {
      const found = find(tabId);
      if (found !== undefined) deps.viewManager.show(found.entry.key);
    },
    setMuted: (tabId, muted) => {
      const found = find(tabId);
      if (found !== undefined && !found.entry.contents.isDestroyed()) found.entry.contents.setAudioMuted(muted);
    },
    remove: (tabId) => {
      const found = find(tabId);
      if (found !== undefined) deps.viewManager.destroyTab(found.entry.key);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    port,
    watch: (attach) => {
      watchers.add(attach);
      for (const entry of Array.from(entries.values())) attachTo(attach, entry);
      return () => {
        watchers.delete(attach);
        for (const once of attachments.get(attach) ?? []) once();
        attachments.delete(attach);
      };
    },
    dispose: () => {
      unsubscribe();
      for (const key of Array.from(entries.keys())) release(key);
      listeners.clear();
      watchers.clear();
    },
  };
};
