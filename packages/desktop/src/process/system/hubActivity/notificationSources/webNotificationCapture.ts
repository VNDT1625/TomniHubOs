/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebConnector } from '@/common/types/platform/notificationHub';
import { matchWebConnector } from '../notifications/webTitleWatcher';

/**
 * Web notifications from sites the user allowed (ChatGPT, Claude, Gemini,
 * Messenger, Zalo Web…) in the built-in browser.
 *
 * For a page on an allowed origin with capture on, a small script replaces the
 * page's `Notification` constructor (and `ServiceWorkerRegistration#showNotification`
 * called from the page) so the site's own notification is handed to the hub,
 * ranked, and only alerts when it is important. The script reports through a
 * console line with a fixed marker; Main accepts it only from a page whose
 * current URL still matches an enabled connector, bounds its size and rate,
 * and treats it as untrusted text. Pushes a site's service worker shows while
 * no page is open are not seen.
 */

export const WEB_NOTIFICATION_MARKER = '__TOMNY_WEB_NOTIFICATION__:';

/** Runs in the page; must stay self-contained. */
export const WEB_NOTIFICATION_SHIM = `(() => {
  if (window.__tomnyNotificationShim || typeof window.Notification !== 'function') return;
  window.__tomnyNotificationShim = true;
  const Original = window.Notification;
  const report = (title, options) => {
    try {
      const body = options && typeof options.body === 'string' ? options.body : '';
      const tag = options && typeof options.tag === 'string' ? options.tag : '';
      console.debug(${JSON.stringify(WEB_NOTIFICATION_MARKER)} + JSON.stringify({ title: String(title).slice(0, 300), body: body.slice(0, 600), tag: tag.slice(0, 120) }));
    } catch (_error) {}
  };
  class TomnyNotification extends EventTarget {
    constructor(title, options) {
      super();
      report(title, options);
      this.title = String(title);
      this.body = (options && options.body) || '';
      this.tag = (options && options.tag) || '';
      this.data = options ? options.data : undefined;
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;
    }
    close() {}
    static get permission() { return Original.permission; }
    static requestPermission(callback) { return Original.requestPermission(callback); }
    static get maxActions() { return Original.maxActions || 0; }
  }
  window.Notification = TomnyNotification;
  const registration = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
  if (registration && typeof registration.showNotification === 'function') {
    registration.showNotification = function (title, options) { report(title, options); return Promise.resolve(); };
  }
})();`;

export type CapturedWebNotification = {
  connector: WebConnector;
  title: string;
  body: string;
  tag: string;
  url: string;
};

/** Parses one console line; anything without the marker or with a malformed payload is ignored. */
export const parseCapturedMessage = (message: string): { title: string; body: string; tag: string } | undefined => {
  if (!message.startsWith(WEB_NOTIFICATION_MARKER) || message.length > 4_000) return undefined;
  try {
    const value: unknown = JSON.parse(message.slice(WEB_NOTIFICATION_MARKER.length));
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim().slice(0, 300) : '';
    if (!title) return undefined;
    return {
      title,
      body: typeof record.body === 'string' ? record.body.trim().slice(0, 600) : '',
      tag: typeof record.tag === 'string' ? record.tag.trim().slice(0, 120) : '',
    };
  } catch {
    return undefined;
  }
};

/** The Electron WebContents surface capture needs. */
export type CapturableContents = {
  id: number;
  getURL: () => string;
  isDestroyed: () => boolean;
  executeJavaScript: (code: string) => Promise<unknown>;
  on: (event: 'dom-ready' | 'console-message', listener: (...args: unknown[]) => void) => unknown;
  once: (event: 'destroyed', listener: () => void) => unknown;
};

const MAX_PER_MINUTE = 20;

/** Console text across Electron versions: the event's `message`, or the positional argument of older releases. */
const consoleText = (args: readonly unknown[]): string => {
  const [event, , message] = args;
  if (typeof message === 'string') return message;
  if (event && typeof event === 'object' && typeof (event as { message?: unknown }).message === 'string') {
    return (event as { message: string }).message;
  }
  return '';
};

export const createWebNotificationCapture = (
  connectors: () => readonly WebConnector[],
  onNotification: (notification: CapturedWebNotification) => void,
  now: () => number = Date.now
) => {
  const observed = new Set<number>();
  const counts = new Map<string, { minute: number; count: number }>();

  const capturing = (url: string): WebConnector | undefined => {
    const connector = matchWebConnector(url, connectors());
    return connector?.captureNotifications ? connector : undefined;
  };

  const withinRate = (connectorId: string): boolean => {
    const minute = Math.floor(now() / 60_000);
    const entry = counts.get(connectorId);
    if (!entry || entry.minute !== minute) {
      counts.set(connectorId, { minute, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_PER_MINUTE;
  };

  return {
    observe: (contents: CapturableContents): void => {
      if (observed.has(contents.id)) return;
      observed.add(contents.id);
      contents.on('dom-ready', () => {
        if (contents.isDestroyed() || !capturing(contents.getURL())) return;
        void contents.executeJavaScript(WEB_NOTIFICATION_SHIM).catch((): void => undefined);
      });
      contents.on('console-message', (...args: unknown[]) => {
        const text = consoleText(args);
        if (!text.startsWith(WEB_NOTIFICATION_MARKER) || contents.isDestroyed()) return;
        const url = contents.getURL();
        const connector = capturing(url);
        const parsed = parseCapturedMessage(text);
        if (!connector || !parsed || !withinRate(connector.id)) return;
        onNotification({ connector, ...parsed, url });
      });
      contents.once('destroyed', () => observed.delete(contents.id));
    },
  };
};
