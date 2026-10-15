/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebConnector } from '@/common/types/platform/notificationHub';

/**
 * Sites such as Facebook, Messenger, Gmail, Zalo Web, Discord or Slack put an
 * unread count in the tab title ("(3) Facebook", "Inbox (12) - Gmail"). For
 * sites the user allowed, a rising count in a built-in browser tab becomes a
 * notification. Nothing is injected into the page and no page data is read
 * beyond its title and address.
 */

/** Unread count shown in a page title, or undefined when there is none. */
export const parseUnreadCount = (title: string): number | undefined => {
  const match = /\((\d{1,5})\+?\)/.exec(title) ?? /\b(\d{1,5})\s+(?:unread|new|chưa đọc|mới)\b/i.exec(title);
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : undefined;
};

/** Host of an allowed origin; accepts `https://www.facebook.com`, `facebook.com` or `*.facebook.com`. */
export const normalizeAllowedOrigin = (value: string): string | undefined => {
  const trimmed = value.trim().replace(/^\*\./, '');
  if (!trimmed) return undefined;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

/** The enabled connector whose host is the page host or a parent of it. */
export const matchWebConnector = (pageUrl: string, connectors: readonly WebConnector[]): WebConnector | undefined => {
  let host: string;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    host = url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return connectors.find((connector) => {
    if (!connector.enabled) return false;
    const allowed = normalizeAllowedOrigin(connector.origin);
    return allowed !== undefined && (host === allowed || host.endsWith(`.${allowed}`));
  });
};

export type UnreadChange = {
  connector: WebConnector;
  count: number;
  added: number;
  title: string;
  url: string;
};

/** The parts of an Electron WebContents the watcher needs. */
export type WatchedContents = {
  id: number;
  getURL: () => string;
  isDestroyed: () => boolean;
  on: (event: 'page-title-updated', listener: (event: unknown, title: string) => void) => unknown;
  once: (event: 'destroyed', listener: () => void) => unknown;
};

export type WebTitleWatcher = { observe: (contents: WatchedContents) => void; reset: () => void };

/**
 * Tracks the last count per tab and per site. A tab that opens with an existing
 * count only sets the baseline, so reopening Facebook does not replay old news.
 */
export const createWebTitleWatcher = (
  connectors: () => readonly WebConnector[],
  onChange: (change: UnreadChange) => void
): WebTitleWatcher => {
  const lastCount = new Map<string, number>();
  const observed = new Set<number>();

  const handle = (contents: WatchedContents, title: string): void => {
    if (contents.isDestroyed()) return;
    const url = contents.getURL();
    const connector = matchWebConnector(url, connectors());
    if (!connector) return;
    const count = parseUnreadCount(title) ?? 0;
    const key = `${connector.id}:${contents.id}`;
    const previous = lastCount.get(key);
    lastCount.set(key, count);
    if (previous === undefined || count <= previous) return;
    onChange({ connector, count, added: count - previous, title: title.slice(0, 200), url });
  };

  return {
    observe: (contents) => {
      if (observed.has(contents.id)) return;
      observed.add(contents.id);
      contents.on('page-title-updated', (_event, title) => handle(contents, title));
      contents.once('destroyed', () => {
        observed.delete(contents.id);
        for (const key of lastCount.keys()) if (key.endsWith(`:${contents.id}`)) lastCount.delete(key);
      });
    },
    reset: () => lastCount.clear(),
  };
};
