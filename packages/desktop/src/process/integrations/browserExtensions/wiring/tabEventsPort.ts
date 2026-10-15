/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two sources the extension APIs need from the Browser's tabs (docs/platform/repotopackage-design.md section 12.3): the
 * phases of a tab's main-frame navigation (`webNavigation`) and the key presses in a tab (`commands`). Both come from
 * the `webContents` of the tabs that {@link BrowserTabsAdapter} watches, so a tab the extension APIs cannot see produces
 * nothing here either.
 *
 * A key press that matches an extension command is consumed (`preventDefault`), so the page does not get that key too.
 * Keys pressed in the Hub window are never seen here.
 */

import type {
  NavigationEvent,
  NavigationPhase,
  WebNavigationPort,
} from '@process/integrations/browserExtensions/api/groups/browser/webNavigation';
import type { CommandsPort, KeyPress } from '@process/integrations/browserExtensions/api/groups/ui/commands';
import type { WatchedTab } from '@process/integrations/browserExtensions/wiring/browserTabsPort';

/** The part of Electron's `before-input-event` input this uses. */
export type KeyInput = Readonly<{
  type: string;
  key: string;
  control?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}>;

export type TabEventsDeps = Readonly<{
  watch: (attach: (tab: WatchedTab) => (() => void) | void) => () => void;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
}>;

export type TabEventsPorts = Readonly<{
  webNavigation: WebNavigationPort;
  commands: CommandsPort;
  dispose: () => void;
}>;

type Listener = (...args: never[]) => void;

/** Electron key names that differ from the accelerator grammar of Chrome. */
const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  ['ArrowUp', 'Up'],
  ['ArrowDown', 'Down'],
  ['ArrowLeft', 'Left'],
  ['ArrowRight', 'Right'],
  [' ', 'Space'],
  [',', 'Comma'],
  ['.', 'Period'],
]);

/** The press in accelerator terms, or undefined for anything but a key going down. */
export const pressOf = (input: KeyInput): KeyPress | undefined => {
  if (input.type !== 'keyDown' || input.key === '') return undefined;
  const key = KEY_NAMES.get(input.key) ?? (input.key.length === 1 ? input.key.toUpperCase() : input.key);
  return {
    key,
    ctrl: input.control === true,
    alt: input.alt === true,
    shift: input.shift === true,
    meta: input.meta === true,
  };
};

export const createTabEventsPorts = (deps: TabEventsDeps): TabEventsPorts => {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`[BrowserExtensions] ${message}`, error));
  const now = deps.now ?? Date.now;
  const navigationListeners = new Set<(event: NavigationEvent) => void>();
  const keyListeners = new Set<(press: KeyPress) => boolean>();

  const navigate = (phase: NavigationPhase, tabId: number, url: string, transitionType?: string): void => {
    const event: NavigationEvent = {
      phase,
      tabId,
      url,
      timeStamp: now(),
      ...(transitionType === undefined ? {} : { transitionType }),
    };
    for (const listener of Array.from(navigationListeners)) {
      try {
        listener(event);
      } catch (error) {
        log('A navigation listener failed.', error);
      }
    }
  };

  const handled = (press: KeyPress): boolean => {
    let matched = false;
    for (const listener of Array.from(keyListeners)) {
      try {
        if (listener(press)) matched = true;
      } catch (error) {
        log('A command listener failed.', error);
      }
    }
    return matched;
  };

  const detach = deps.watch((tab) => {
    const { contents, tabId } = tab;
    const currentUrl = (): string => (contents.isDestroyed() ? '' : contents.getURL());
    const onStart = (_event: unknown, url: unknown, _inPlace: unknown, isMainFrame: unknown): void => {
      if (isMainFrame === true && typeof url === 'string') navigate('before', tabId, url);
    };
    const onCommit = (_event: unknown, url: unknown, _code: unknown, _text: unknown, isMainFrame: unknown): void => {
      if (isMainFrame === true && typeof url === 'string') navigate('committed', tabId, url, 'other');
    };
    const onDomReady = (): void => navigate('dom', tabId, currentUrl());
    const onLoaded = (): void => navigate('completed', tabId, currentUrl());
    const onInput = (event: { preventDefault: () => void }, input: KeyInput): void => {
      const press = pressOf(input);
      if (press !== undefined && handled(press)) event.preventDefault();
    };
    const hooks: readonly (readonly [string, Listener])[] = [
      ['did-start-navigation', onStart as unknown as Listener],
      ['did-frame-navigate', onCommit as unknown as Listener],
      ['dom-ready', onDomReady as unknown as Listener],
      ['did-finish-load', onLoaded as unknown as Listener],
      ['before-input-event', onInput as unknown as Listener],
    ];
    for (const [event, listener] of hooks) contents.on(event, listener);
    return () => {
      for (const [event, listener] of hooks) {
        try {
          contents.removeListener(event, listener);
        } catch {
          // The contents may be gone already.
        }
      }
    };
  });

  return {
    webNavigation: {
      subscribe: (listener) => {
        navigationListeners.add(listener);
        return () => {
          navigationListeners.delete(listener);
        };
      },
    },
    commands: {
      subscribeKeys: (listener) => {
        keyListeners.add(listener);
        return () => {
          keyListeners.delete(listener);
        };
      },
    },
    dispose: () => {
      detach();
      navigationListeners.clear();
      keyListeners.clear();
    },
  };
};
