/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.action` state (docs/platform/repotopackage-design.md sections 12.3 and 12.5): title, popup, badge text and
 * badge color, kept in Main per extension (and per tab, as Chrome does), plus `openPopup` and `onClicked`.
 *
 * Nothing is drawn here. The toolbar (T4.5) reads {@link ActionStore.get}, listens to {@link ActionStore.subscribe}
 * for changes and popup requests, and calls {@link ActionStore.click} when the person presses the button. Electron
 * draws no toolbar, so its own `chrome.action` setters have nowhere to put the state; these members therefore replace
 * them (`replace` in the namespace spec).
 *
 * - A popup path is relative to the extension: no scheme, no `..`, no leading slash. The store hands out the
 *   resolved `chrome-extension://<id>/<path>` URL, so a popup can never point outside its own extension.
 * - State is per calling extension; an id in an argument is not looked at.
 * - Per-tab overrides are bounded and dropped with their tab.
 * - `setIcon` takes paths only, inside the extension. The state carries the resolved URL of each icon size (key
 *   `default` for a single path), and the toolbar loads and sizes them. `imageData` answers UNSUPPORTED.
 */

import { z } from 'zod';
import { emitTo } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import { toChromeTab, type PortTab } from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import type { TabsPort } from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type BadgeColor = readonly [number, number, number, number];

/** The resolved state the toolbar shows. `popup` is a full extension URL, or empty when the button has none. */
export type ActionState = Readonly<{
  extensionId: string;
  title: string;
  popup: string;
  badgeText: string;
  badgeBackgroundColor: BadgeColor;
  /** Icon URLs by size (`default` for a single path). Empty when the extension set none. */
  icon: Readonly<Record<string, string>>;
}>;

export type ActionChange =
  | Readonly<{ type: 'state'; extensionId: string; tabId?: number; state: ActionState }>
  | Readonly<{ type: 'open-popup'; extensionId: string; windowId?: number }>;

export type ActionStore = Readonly<{
  /** The state for a tab (its overrides over the extension's own), or undefined for an extension that is not loaded. */
  get: (extensionId: string, tabId?: number) => ActionState | undefined;
  /** Returns the unsubscribe function. */
  subscribe: (listener: (change: ActionChange) => void) => () => void;
  /** The person pressed the extension's button on this tab: sends `action.onClicked` to that extension. */
  click: (extensionId: string, tabId: number) => void;
  /** The tab is gone: drops its overrides. */
  forgetTab: (tabId: number) => void;
}>;

type Fields = {
  title?: string;
  popup?: string;
  badgeText?: string;
  badgeBackgroundColor?: BadgeColor;
  icon?: Readonly<Record<string, string>>;
};

const MAX_TAB_OVERRIDES = 200;
const MAX_ICON_SIZES = 8;
const DEFAULT_COLOR: BadgeColor = [0, 0, 0, 0];

const tabId = z.number().int().min(0).max(2_147_483_647);
const detailsOf = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, tabId: tabId.optional() }).strict();
const getDetails = z.object({ tabId: tabId.optional() }).strict();

/** A path inside the extension: no scheme, no leading slash, no `..` segment, no backslash, query or control character. */
const isRelativePath = (value: string): boolean =>
  !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) &&
  !value.startsWith('/') &&
  !value.split('/').includes('..') &&
  ![...value].some((char) => char === '\\' || char === '?' || char === '#' || char.charCodeAt(0) < 32);
const popupPath = z.string().max(512).refine(isRelativePath);
/** One icon path, or one path per size such as `{ "16": "a.png", "32": "b.png" }`. */
const iconSizes = z
  .record(z.string().regex(/^[1-9][0-9]{0,2}$/), popupPath)
  .refine((value) => Object.keys(value).length <= MAX_ICON_SIZES, 'too many icon sizes');

/** The resolved URL of each icon size. A single path is filed under `default`. */
const iconUrls = (
  extensionId: string,
  path: string | Readonly<Record<string, string>>
): Readonly<Record<string, string>> => {
  const bySize: Readonly<Record<string, string>> = typeof path === 'string' ? { default: path } : path;
  return Object.fromEntries(
    Object.entries(bySize).map(([size, relative]) => [size, `chrome-extension://${extensionId}/${relative}`])
  );
};

const colorSchema = z.union([
  z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
  z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]),
  z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
]);

const toColor = (value: z.output<typeof colorSchema>): BadgeColor => {
  if (typeof value !== 'string') {
    const rgba = value as readonly number[];
    return [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0, rgba[3] ?? 255];
  }
  let hex = value.slice(1);
  if (hex.length <= 4) hex = [...hex].map((digit) => digit + digit).join('');
  const byte = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return [byte(0), byte(2), byte(4), hex.length === 8 ? byte(6) : 255];
};

export const createActionApi = (
  context: GroupContext,
  tabs: TabsPort | undefined
): ApiGroup & Readonly<{ store: ActionStore }> => {
  const both = ['service-worker', 'frame'] as const;
  const own = new Map<string, Fields>();
  const perTab = new Map<string, Map<number, Fields>>();
  const listeners = new Set<(change: ActionChange) => void>();

  const publish = (change: ActionChange): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(change);
      } catch {
        // A toolbar that fails must not break the extension's call.
      }
    }
  };

  const resolve = (extensionId: string, forTab: number | undefined): ActionState | undefined => {
    const grants = context.grants.get(extensionId);
    if (grants === undefined) return undefined;
    const base = own.get(extensionId) ?? {};
    const over = forTab === undefined ? {} : (perTab.get(extensionId)?.get(forTab) ?? {});
    const popup = over.popup ?? base.popup ?? '';
    return {
      extensionId,
      title: over.title ?? base.title ?? grants.name,
      popup: popup === '' ? '' : `chrome-extension://${extensionId}/${popup}`,
      badgeText: over.badgeText ?? base.badgeText ?? '',
      badgeBackgroundColor: over.badgeBackgroundColor ?? base.badgeBackgroundColor ?? DEFAULT_COLOR,
      icon: over.icon ?? base.icon ?? {},
    };
  };

  const checkTab = (forTab: number | undefined): void => {
    if (forTab === undefined || tabs === undefined) return;
    if (!tabs.list().some((tab) => tab.id === forTab)) throw new ApiError('REJECTED', `No tab with id: ${forTab}.`);
  };

  const write = (extensionId: string, forTab: number | undefined, fields: Fields): void => {
    checkTab(forTab);
    if (forTab === undefined) {
      own.set(extensionId, { ...own.get(extensionId), ...fields });
    } else {
      let overrides = perTab.get(extensionId);
      if (overrides === undefined) {
        overrides = new Map();
        perTab.set(extensionId, overrides);
      }
      if (!overrides.has(forTab) && overrides.size >= MAX_TAB_OVERRIDES) {
        const oldest = overrides.keys().next();
        if (oldest.done !== true) overrides.delete(oldest.value);
      }
      overrides.set(forTab, { ...overrides.get(forTab), ...fields });
    }
    const state = resolve(extensionId, forTab);
    if (state !== undefined) {
      publish({ type: 'state', extensionId, ...(forTab === undefined ? {} : { tabId: forTab }), state });
    }
  };

  const read = (extensionId: string, forTab: number | undefined): ActionState => {
    checkTab(forTab);
    const state = resolve(extensionId, forTab);
    if (state === undefined) throw new ApiError('INVALID_CALLER', 'The extension is not loaded.');
    return state;
  };

  const methods = [
    defineApiMethod({
      name: 'action.setTitle',
      callers: both,
      args: z.tuple([detailsOf({ title: z.string().max(256) })]),
      handle: (call, [details]) => {
        write(call.extensionId, details.tabId, { title: details.title });
        return null;
      },
    }),
    defineApiMethod({
      name: 'action.getTitle',
      callers: both,
      args: z.tuple([getDetails]),
      handle: (call, [details]) => read(call.extensionId, details.tabId).title,
    }),
    defineApiMethod({
      name: 'action.setPopup',
      callers: both,
      args: z.tuple([detailsOf({ popup: popupPath })]),
      handle: (call, [details]) => {
        write(call.extensionId, details.tabId, { popup: details.popup });
        return null;
      },
    }),
    defineApiMethod({
      name: 'action.getPopup',
      callers: both,
      args: z.tuple([getDetails]),
      handle: (call, [details]) => read(call.extensionId, details.tabId).popup,
    }),
    defineApiMethod({
      name: 'action.setBadgeText',
      callers: both,
      args: z.tuple([detailsOf({ text: z.string().max(64) })]),
      handle: (call, [details]) => {
        write(call.extensionId, details.tabId, { badgeText: details.text });
        return null;
      },
    }),
    defineApiMethod({
      name: 'action.getBadgeText',
      callers: both,
      args: z.tuple([getDetails]),
      handle: (call, [details]) => read(call.extensionId, details.tabId).badgeText,
    }),
    defineApiMethod({
      name: 'action.setBadgeBackgroundColor',
      callers: both,
      args: z.tuple([detailsOf({ color: colorSchema })]),
      handle: (call, [details]) => {
        write(call.extensionId, details.tabId, { badgeBackgroundColor: toColor(details.color) });
        return null;
      },
    }),
    defineApiMethod({
      name: 'action.getBadgeBackgroundColor',
      callers: both,
      args: z.tuple([getDetails]),
      handle: (call, [details]) => [...read(call.extensionId, details.tabId).badgeBackgroundColor],
    }),
    defineApiMethod({
      name: 'action.setIcon',
      callers: both,
      args: z.tuple([
        detailsOf({ path: z.union([popupPath, iconSizes]).optional(), imageData: z.unknown().optional() }),
      ]),
      handle: (call, [details]) => {
        if (details.imageData !== undefined) {
          throw new ApiError('UNSUPPORTED', 'chrome.action.setIcon with imageData is not supported; use a path.');
        }
        if (details.path === undefined) throw new ApiError('INVALID_ARGUMENTS', 'setIcon needs a path.');
        write(call.extensionId, details.tabId, { icon: iconUrls(call.extensionId, details.path) });
        return null;
      },
    }),
    defineApiMethod({
      name: 'action.openPopup',
      callers: both,
      args: z.union([z.tuple([]), z.tuple([z.object({ windowId: z.number().int().optional() }).strict()])]),
      handle: (call, args) => {
        if (listeners.size === 0) throw new ApiError('UNSUPPORTED', 'There is no toolbar to open the popup in.');
        const first = (args as readonly { windowId?: number }[])[0];
        const windowId = first === undefined ? undefined : first.windowId;
        publish({ type: 'open-popup', extensionId: call.extensionId, ...(windowId === undefined ? {} : { windowId }) });
        return null;
      },
    }),
  ];

  const forgetTab = (id: number): void => {
    for (const overrides of perTab.values()) overrides.delete(id);
  };
  const unsubscribeTabs = tabs?.subscribe((event) => {
    if (event.type === 'removed') forgetTab(event.tabId);
  });

  const store: ActionStore = {
    get: resolve,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    click: (extensionId, forTab) => {
      const tab: PortTab | undefined = tabs?.list().find((candidate) => candidate.id === forTab);
      // The person pressed this extension's button on this tab, which is the gesture that shares the tab with it.
      emitTo(context, extensionId, 'action.onClicked', [tab === undefined ? { id: forTab } : toChromeTab(tab, true)]);
    },
    forgetTab,
  };

  return {
    methods,
    store,
    dispose: () => {
      unsubscribeTabs?.();
      listeners.clear();
    },
  };
};
