/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserTabInfo, TabUpdate } from '@/common/packages/browserHost';
import type { LiveSession, LiveSessionActions } from '@/common/liveSessions/model';
import type { LiveSessionRegistry } from './liveSessionRegistry';

export const BROWSER_APP_ID = 'com.tomni.browser';
const DEFAULT_POLL_MS = 2_000;
/** The sidebar opens and closes tabs through the existing browser IPC. */
const BROWSER_ACTIONS: LiveSessionActions = { create: true, close: true };

/** An untitled tab is named by its host only: a full address can carry tokens and must not reach the sidebar. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname || url.slice(0, 40);
  } catch {
    return url.slice(0, 40);
  }
};

type BrowserSource = {
  listTabs: () => BrowserTabInfo[];
  onTabUpdate: (listener: (update: TabUpdate) => void) => () => void;
};

/**
 * Reports every browser tab under the Browser app. Tabs live in Main and outlive the Browser screen, and
 * agent tools can open them without going through the bridge handlers, so the tab list is polled (it is
 * in-memory) and tab updates refresh a tab at once. v1 reports every tab as `idle`: there is no audio or
 * load-error signal yet.
 */
export const attachBrowserLiveSessions = (
  registry: LiveSessionRegistry,
  browser: BrowserSource,
  options: { now?: () => number; pollMs?: number } = {}
): (() => void) => {
  const now = options.now ?? Date.now;
  const lastActive = new Map<string, number>();
  let signature = '';

  const sync = (): void => {
    try {
      const tabs = browser.listTabs();
      if (!Array.isArray(tabs)) return;
      const at = now();
      // Hidden research tabs opened by agents (`background`) never belong to a live user surface.
      const visible = tabs.filter((tab) => tab.background !== true);
      const sessions: LiveSession[] = visible.map((tab) => {
        if (!lastActive.has(tab.id)) lastActive.set(tab.id, at);
        return { id: tab.id, title: tab.title || hostOf(tab.url), status: 'idle', lastActiveAt: lastActive.get(tab.id) };
      });
      for (const id of lastActive.keys()) {
        if (!visible.some((tab) => tab.id === id)) lastActive.delete(id);
      }
      const next = JSON.stringify({ sessions, actions: BROWSER_ACTIONS });
      if (next === signature) return;
      signature = next;
      registry.report(BROWSER_APP_ID, sessions, BROWSER_ACTIONS);
    } catch {
      // An unreadable tab list leaves the previous report in place.
    }
  };

  const stopUpdates = browser.onTabUpdate((update) => {
    lastActive.set(update.id, now());
    sync();
  });
  const timer = setInterval(sync, options.pollMs ?? DEFAULT_POLL_MS);
  timer.unref?.();
  sync();

  return () => {
    stopUpdates();
    clearInterval(timer);
    registry.clear(BROWSER_APP_ID);
  };
};
