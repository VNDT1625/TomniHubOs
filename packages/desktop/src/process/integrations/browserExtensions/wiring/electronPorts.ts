/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the ports of the `chrome.*` shim from the Hub's real services (docs/platform/repotopackage-design.md
 * section 12.3), once, when the extension host starts.
 *
 * {@link createShimPorts} is pure: everything it touches arrives through {@link ShimPortsDeps}, so the composition runs
 * under Node in tests. {@link createDefaultShimPorts} supplies the real Electron objects. Each port is built on its own:
 * one that cannot be built is left out (its API then answers UNSUPPORTED) and the others still work.
 */

import path from 'node:path';
import type { ShimPorts } from '@process/integrations/browserExtensions/api/shim';
import {
  createBrowserTabsAdapter,
  type BrowserTabsAdapter,
  type TabsViewManager,
} from '@process/integrations/browserExtensions/wiring/browserTabsPort';
import {
  createContextMenusPort,
  type MenuTemplateItem,
} from '@process/integrations/browserExtensions/wiring/contextMenusPort';
import {
  createProfileCookiesPort,
  type CookieJarSession,
} from '@process/integrations/browserExtensions/wiring/profileCookiesPort';
import {
  subscribeBrowserTabLifecycle,
  type BrowserTabLifecycleEvent,
} from '@process/integrations/browserExtensions/wiring/tabLifecycle';
import {
  createDownloadsPort,
  type DownloadSessionLike,
} from '@process/integrations/browserExtensions/wiring/downloadsPort';
import {
  createNotificationsPort,
  createWindowsPort,
  type HubWindow,
  type NativeNotification,
  type NotificationsDeps,
} from '@process/integrations/browserExtensions/wiring/hubPorts';
import {
  createFileSyncStoragePort,
  SYNC_STORAGE_DIRECTORY,
} from '@process/integrations/browserExtensions/wiring/syncStoragePort';
import { createTabEventsPorts } from '@process/integrations/browserExtensions/wiring/tabEventsPort';

export type ShimPortsDeps = Readonly<{
  /** The Browser profile session. */
  profileSession: unknown;
  /** Electron's default session, so the cookies port can refuse it. */
  defaultSession: unknown;
  viewManager: TabsViewManager;
  popup: (contents: unknown, template: MenuTemplateItem[]) => void;
  subscribeLifecycle?: (listener: (event: BrowserTabLifecycleEvent) => void) => () => void;
  /** The Hub window, for `chrome.windows`. Absent: that API answers UNSUPPORTED. */
  getWindow?: () => HubWindow | undefined;
  /** Native notifications, for `chrome.notifications`. Absent: that API answers UNSUPPORTED. */
  notifications?: NotificationsDeps;
  /** Folder of the `chrome.storage.sync` files, one per extension. Absent: that API answers UNSUPPORTED. */
  syncStorageDirectory?: string;
  log?: (message: string, error?: unknown) => void;
}>;

export type BuiltShimPorts = Readonly<{ ports: ShimPorts; dispose: () => void }>;

export const createShimPorts = (deps: ShimPortsDeps): BuiltShimPorts => {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  const disposers: (() => void)[] = [];
  let tabs: BrowserTabsAdapter | undefined;
  let ports: ShimPorts = {};

  try {
    tabs = createBrowserTabsAdapter({
      viewManager: deps.viewManager,
      profileSession: deps.profileSession,
      subscribeLifecycle: deps.subscribeLifecycle ?? subscribeBrowserTabLifecycle,
      log,
    });
    ports = { ...ports, tabs: tabs.port };
    disposers.push(tabs.dispose);
  } catch (error) {
    log('The tabs port could not be built; chrome.tabs is unavailable.', error);
  }

  if (tabs !== undefined) {
    const { port, watch } = tabs;
    try {
      ports = {
        ...ports,
        contextMenus: createContextMenusPort({
          watch,
          popup: (contents, template) => deps.popup(contents, template),
          tab: (tabId) => port.list().find((tab) => tab.id === tabId),
          log,
        }),
      };
    } catch (error) {
      log('The context menu port could not be built; chrome.contextMenus is unavailable.', error);
    }
  }

  try {
    ports = {
      ...ports,
      cookies: createProfileCookiesPort(deps.profileSession as CookieJarSession, deps.defaultSession),
    };
  } catch (error) {
    log('The cookies port could not be built; chrome.cookies is unavailable.', error);
  }

  if (tabs !== undefined) {
    try {
      const events = createTabEventsPorts({ watch: tabs.watch, log });
      disposers.push(events.dispose);
      ports = { ...ports, webNavigation: events.webNavigation, commands: events.commands };
    } catch (error) {
      log('The tab event ports could not be built; chrome.webNavigation and chrome.commands are unavailable.', error);
    }
  }

  if (deps.getWindow !== undefined) ports = { ...ports, windows: createWindowsPort(deps.getWindow) };
  if (deps.notifications !== undefined) {
    ports = { ...ports, notifications: createNotificationsPort(deps.notifications) };
  }

  try {
    const downloads = createDownloadsPort(deps.profileSession as DownloadSessionLike);
    disposers.push(downloads.dispose);
    ports = { ...ports, downloads };
  } catch (error) {
    log('The downloads port could not be built; chrome.downloads is unavailable.', error);
  }

  if (deps.syncStorageDirectory !== undefined) {
    try {
      ports = { ...ports, syncStorage: createFileSyncStoragePort(deps.syncStorageDirectory) };
    } catch (error) {
      log('The sync storage port could not be built; chrome.storage.sync is unavailable.', error);
    }
  }

  return {
    ports,
    dispose: () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch (error) {
          log('A port could not be released.', error);
        }
      }
    },
  };
};

/** The real thing. Resolves to undefined (and logs why) when the Hub services are not available. */
export const createDefaultShimPorts = async (
  log: (message: string, error?: unknown) => void
): Promise<BuiltShimPorts | undefined> => {
  try {
    const { app, BrowserWindow, Menu, Notification, session } = await import('electron');
    const { getBrowserProfileSession } = await import('@process/integrations/browserExtensions/profile');
    const { getBrowserServices } = await import('@process/browser/browserBridge');
    const { getApplicationMainWindow } = await import('@process/bridge/applicationBridge');
    const { viewManager } = getBrowserServices(getApplicationMainWindow);
    return createShimPorts({
      profileSession: getBrowserProfileSession(),
      defaultSession: session.defaultSession,
      viewManager: viewManager as unknown as TabsViewManager,
      popup: (contents, template) => {
        const menu = Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]);
        const owner =
          BrowserWindow.fromWebContents(contents as Electron.WebContents) ?? getApplicationMainWindow() ?? undefined;
        menu.popup(owner === undefined ? undefined : { window: owner });
      },
      getWindow: () => (getApplicationMainWindow() ?? undefined) as unknown as HubWindow | undefined,
      notifications: {
        create: (options) => new Notification(options) as unknown as NativeNotification,
        supported: () => Notification.isSupported(),
      },
      syncStorageDirectory: path.join(app.getPath('userData'), SYNC_STORAGE_DIRECTORY),
      log,
    });
  } catch (error) {
    log('The Hub services for the Chrome API shim are not available; its ports are off.', error);
    return undefined;
  }
};
