/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Hub's own services behind `chrome.windows` and `chrome.notifications` (docs/platform/repotopackage-design.md
 * section 12.3). Electron objects are reached through small structural types, so the behavior runs under Node in tests.
 */

import type { WindowBounds, WindowsPort } from '@process/integrations/browserExtensions/api/groups/browser/windows';
import type {
  NotificationRequest,
  NotificationsPort,
} from '@process/integrations/browserExtensions/api/groups/ui/notifications';

/** The part of the Hub window (`BrowserWindow`) this uses. */
export type HubWindow = Readonly<{
  isDestroyed: () => boolean;
  isFocused: () => boolean;
  focus: () => void;
  getBounds: () => Readonly<{ x: number; y: number; width: number; height: number }>;
  on: (event: 'focus' | 'blur', listener: () => void) => unknown;
  removeListener: (event: 'focus' | 'blur', listener: () => void) => unknown;
}>;

/** The part of Electron's `Notification` this uses. */
export type NativeNotification = Readonly<{
  on: (event: 'click' | 'close', listener: () => void) => unknown;
  show: () => void;
  close: () => void;
}>;

export type NotificationsDeps = Readonly<{
  create: (options: Readonly<{ title: string; body: string; silent: boolean }>) => NativeNotification;
  supported: () => boolean;
}>;

/** Control characters and bidirectional overrides are replaced: they could hide what the notification says. */
const clean = (text: string, limit: number): string =>
  Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    const unsafe =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    return unsafe ? ' ' : char;
  })
    .join('')
    .slice(0, limit);

export const createWindowsPort = (getWindow: () => HubWindow | undefined): WindowsPort => {
  /** The window while it exists; a destroyed or missing window reads as unfocused with no size. */
  const live = (): HubWindow | undefined => {
    const window = getWindow();
    return window === undefined || window.isDestroyed() ? undefined : window;
  };
  return {
    isFocused: () => live()?.isFocused() ?? false,
    bounds: (): WindowBounds => {
      const box = live()?.getBounds();
      return { left: box?.x ?? 0, top: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 };
    },
    focus: () => {
      live()?.focus();
    },
    subscribeFocus: (listener) => {
      const window = live();
      if (window === undefined) return () => undefined;
      const onFocus = (): void => listener(true);
      const onBlur = (): void => listener(false);
      window.on('focus', onFocus);
      window.on('blur', onBlur);
      return () => {
        window.removeListener('focus', onFocus);
        window.removeListener('blur', onBlur);
      };
    },
  };
};

export const createNotificationsPort = (deps: NotificationsDeps): NotificationsPort => {
  const open = new Map<string, NativeNotification>();
  const clicks = new Set<(id: string) => void>();
  return {
    show: (request: NotificationRequest) => {
      if (!deps.supported()) throw new Error('Native notifications are not supported on this system.');
      const native = deps.create({
        // The extension's name leads, so the person can tell where the notification came from.
        title: clean(`${request.source}: ${request.title}`, 300),
        body: clean(request.message, 1200),
        silent: request.silent,
      });
      native.on('click', () => {
        for (const listener of Array.from(clicks)) {
          try {
            listener(request.id);
          } catch {
            // One listener that fails does not stop the others.
          }
        }
      });
      native.on('close', () => {
        open.delete(request.id);
      });
      open.set(request.id, native);
      native.show();
    },
    close: (id) => {
      const native = open.get(id);
      open.delete(id);
      native?.close();
    },
    subscribeClicks: (listener) => {
      clicks.add(listener);
      return () => {
        clicks.delete(listener);
      };
    },
  };
};
