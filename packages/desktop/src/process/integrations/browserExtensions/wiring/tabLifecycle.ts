/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle of Browser tabs as one-way notifications (docs/platform/repotopackage-design.md section 12.3). The
 * `BrowserViewManager` announces that a tab was created, destroyed or brought to the front; the extension wiring
 * listens. The manager knows nothing about extensions and a listener can neither fail nor slow it: every listener is
 * called inside its own `try`.
 *
 * Module level on purpose: the manager is created lazily somewhere else, and the extension host may start before or
 * after it.
 */

export type BrowserTabLifecycleEvent = Readonly<{ type: 'created' | 'destroyed' | 'shown'; id: string }>;

const listeners = new Set<(event: BrowserTabLifecycleEvent) => void>();

/** Returns the unsubscribe function. */
export const subscribeBrowserTabLifecycle = (listener: (event: BrowserTabLifecycleEvent) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const emitBrowserTabLifecycle = (event: BrowserTabLifecycleEvent): void => {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch {
      // A listener must never break tab handling.
    }
  }
};
