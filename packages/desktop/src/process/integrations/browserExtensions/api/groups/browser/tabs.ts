/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.tabs` (docs/platform/repotopackage-design.md section 12.3): `create`, `query`, `update`, `remove`, `get`
 * and the `onCreated`, `onUpdated`, `onRemoved`, `onActivated` events, mapped onto the Browser's tabs through
 * {@link TabsPort}.
 *
 * - The port lists only tabs of the Browser profile session that are not hidden research tabs, so an extension never
 *   reaches the Hub window, a web-embed app or an agent's scraping tab.
 * - What an extension may know or touch is decided in `tabAccess.ts`: a tab it cannot see behaves as absent, for
 *   reads, writes and events alike.
 * - A tab may be opened or navigated only to a web URL, `about:blank` or a page of the calling extension.
 * - `sendMessage` is not shimmed: it needs Electron's content-script channel, which Main cannot reach. Electron's own
 *   version stays in place (it uses the same `webContents` ids).
 * - Opening tabs is limited per extension so a loop cannot flood the Browser.
 *
 * Events go to service workers that are running; a page of an extension (a popup) receives methods only.
 */

import { z } from 'zod';
import { parseMatchPattern, urlCoveredBy } from '@process/integrations/browserExtensions/api/matchPattern';
import { broadcast } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import {
  BROWSER_WINDOW_ID,
  WINDOW_ID_CURRENT,
  canSeeTab,
  isNavigableUrl,
  toChromeTab,
  type PortTab,
} from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type CallContext,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type TabChanges = Readonly<{
  status?: 'loading' | 'complete';
  url?: string;
  title?: string;
  favIconUrl?: string;
  audible?: boolean;
  muted?: boolean;
}>;

export type TabsPortEvent =
  | Readonly<{ type: 'created'; tab: PortTab }>
  | Readonly<{ type: 'updated'; tab: PortTab; changes: TabChanges }>
  | Readonly<{ type: 'removed'; tabId: number; windowId: number }>
  | Readonly<{ type: 'activated'; tabId: number; windowId: number }>;

/** What the Browser offers. Every method concerns Browser profile tabs only; an unknown id is a quiet no-op. */
export type TabsPort = Readonly<{
  list: () => readonly PortTab[];
  create: (input: Readonly<{ url?: string; active: boolean }>) => Promise<PortTab>;
  navigate: (tabId: number, url: string) => Promise<void>;
  activate: (tabId: number) => void;
  setMuted: (tabId: number, muted: boolean) => void;
  remove: (tabId: number) => void;
  /** Returns the unsubscribe function. */
  subscribe: (listener: (event: TabsPortEvent) => void) => () => void;
}>;

const MAX_TABS = 100;
const MAX_REMOVE = 50;
const CREATE_WINDOW_MS = 10_000;
const CREATE_PER_WINDOW = 20;
const MAX_SEEN = 2000;

const tabId = z.number().int().min(0).max(2_147_483_647);
const urlPattern = z
  .string()
  .max(500)
  .refine((value) => parseMatchPattern(value) !== undefined);
const flag = z.boolean().optional();

const querySchema = z
  .object({
    active: flag,
    audible: flag,
    currentWindow: flag,
    lastFocusedWindow: flag,
    muted: flag,
    status: z.enum(['loading', 'complete', 'unloaded']).optional(),
    title: z.string().max(500).optional(),
    url: z.union([urlPattern, z.array(urlPattern).max(50)]).optional(),
    windowId: z.number().int().min(-2).optional(),
    windowType: z.enum(['normal', 'popup', 'panel', 'app', 'devtools']).optional(),
    index: z.number().int().min(0).optional(),
    pinned: flag,
    highlighted: flag,
    discarded: flag,
    autoDiscardable: flag,
    groupId: z.number().int().min(-1).optional(),
  })
  .strict();

const createSchema = z
  .object({
    url: z.string().min(1).max(2048).optional(),
    active: flag,
    selected: flag,
    windowId: z.number().int().min(-2).optional(),
    index: z.number().int().min(0).optional(),
    pinned: flag,
    openerTabId: tabId.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    url: z.string().min(1).max(2048).optional(),
    active: flag,
    highlighted: flag,
    muted: flag,
    autoDiscardable: flag,
  })
  .strict();

/** `*` wildcard match without regular expressions, so a hostile pattern cannot cost more than its length. */
const globMatches = (pattern: string, text: string): boolean => {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === text;
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (!text.startsWith(first) || !text.endsWith(last) || text.length < first.length + last.length) return false;
  let at = first.length;
  const end = text.length - last.length;
  for (const part of parts.slice(1, -1)) {
    const found = text.indexOf(part, at);
    if (found === -1 || found + part.length > end) return false;
    at = found + part.length;
  }
  return true;
};

const matchesQuery = (tab: PortTab, query: z.output<typeof querySchema>): boolean => {
  if (query.active !== undefined && tab.active !== query.active) return false;
  if (query.highlighted !== undefined && tab.active !== query.highlighted) return false;
  if (query.audible !== undefined && tab.audible !== query.audible) return false;
  if (query.muted !== undefined && tab.muted !== query.muted) return false;
  if (query.status === 'unloaded') return false;
  if (query.status !== undefined && (query.status === 'loading') !== tab.loading) return false;
  if (query.currentWindow === false || query.lastFocusedWindow === false) return false;
  if (query.windowId !== undefined && query.windowId !== WINDOW_ID_CURRENT && query.windowId !== tab.windowId) {
    return false;
  }
  if (query.windowType !== undefined && query.windowType !== 'normal') return false;
  if (query.index !== undefined && query.index !== tab.index) return false;
  if (query.pinned === true || query.discarded === true || (query.groupId ?? -1) !== -1) return false;
  if (query.autoDiscardable === false) return false;
  if (query.title !== undefined && !globMatches(query.title, tab.title)) return false;
  if (query.url !== undefined) {
    const patterns = typeof query.url === 'string' ? [query.url] : query.url;
    if (!urlCoveredBy(patterns, tab.url)) return false;
  }
  return true;
};

const notFound = (id: number): ApiError => new ApiError('REJECTED', `No tab with id: ${id}.`);

export const createTabsApi = (
  context: GroupContext,
  port: TabsPort | undefined,
  now: () => number = Date.now
): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;
  const seen = new Map<string, Set<number>>();
  const created = new Map<string, number[]>();

  const need = (): TabsPort => {
    if (port === undefined)
      throw new ApiError('UNSUPPORTED', 'chrome.tabs is not available: the Browser is not wired.');
    return port;
  };
  const markSeen = (extensionId: string, id: number): void => {
    let ids = seen.get(extensionId);
    if (ids === undefined) {
      ids = new Set();
      seen.set(extensionId, ids);
    }
    if (ids.size >= MAX_SEEN) ids.clear();
    ids.add(id);
  };
  const visibleTabs = (call: CallContext): PortTab[] => {
    const tabs = need()
      .list()
      .filter((tab) => canSeeTab(call.grants, tab));
    for (const tab of tabs) markSeen(call.extensionId, tab.id);
    return tabs;
  };
  const visibleTab = (call: CallContext, id: number): PortTab => {
    const tab = visibleTabs(call).find((candidate) => candidate.id === id);
    if (tab === undefined) throw notFound(id);
    return tab;
  };
  const checkUrl = (call: CallContext, url: string | undefined): void => {
    if (url !== undefined && !isNavigableUrl(call.grants, url)) {
      throw new ApiError('REJECTED', 'This URL cannot be opened by an extension.');
    }
  };
  const throttle = (extensionId: string): void => {
    const stamp = now();
    const recent = (created.get(extensionId) ?? []).filter((time) => stamp - time < CREATE_WINDOW_MS);
    if (recent.length >= CREATE_PER_WINDOW) throw new ApiError('BUSY', 'Too many tabs were opened too quickly.');
    created.set(extensionId, [...recent, stamp]);
  };

  const methods = [
    defineApiMethod({
      name: 'tabs.get',
      callers: both,
      args: z.tuple([tabId]),
      handle: (call, [id]) => toChromeTab(visibleTab(call, id), true),
    }),
    defineApiMethod({
      name: 'tabs.query',
      callers: both,
      args: z.tuple([querySchema]),
      handle: (call, [query]) =>
        visibleTabs(call)
          .filter((tab) => matchesQuery(tab, query))
          .map((tab) => toChromeTab(tab, true)),
    }),
    defineApiMethod({
      name: 'tabs.create',
      callers: both,
      args: z.tuple([createSchema]),
      handle: async (call, [properties]) => {
        const host = need();
        if (
          properties.windowId !== undefined &&
          properties.windowId !== BROWSER_WINDOW_ID &&
          properties.windowId !== WINDOW_ID_CURRENT
        ) {
          throw new ApiError('REJECTED', `No window with id: ${properties.windowId}.`);
        }
        if (properties.pinned === true) throw new ApiError('UNSUPPORTED', 'Pinned tabs are not supported.');
        checkUrl(call, properties.url);
        if (host.list().length >= MAX_TABS) throw new ApiError('REJECTED', 'Too many tabs are open.');
        throttle(call.extensionId);
        const tab = await host.create({
          ...(properties.url === undefined ? {} : { url: properties.url }),
          active: properties.active ?? properties.selected ?? true,
        });
        const reveal = canSeeTab(call.grants, tab);
        if (reveal) markSeen(call.extensionId, tab.id);
        return toChromeTab(tab, reveal);
      },
    }),
    defineApiMethod({
      name: 'tabs.update',
      callers: both,
      args: z.union([z.tuple([tabId, updateSchema]), z.tuple([updateSchema])]),
      handle: async (call, args) => {
        const host = need();
        const properties = (args.length === 2 ? args[1] : args[0]) as z.output<typeof updateSchema>;
        const target =
          args.length === 2
            ? visibleTab(call, args[0] as number)
            : (visibleTabs(call).find((tab) => tab.active) ?? undefined);
        if (target === undefined) throw new ApiError('REJECTED', 'No active tab.');
        checkUrl(call, properties.url);
        if (properties.url !== undefined) await host.navigate(target.id, properties.url);
        if (properties.muted !== undefined) host.setMuted(target.id, properties.muted);
        if (properties.active === true || properties.highlighted === true) host.activate(target.id);
        const after = host.list().find((tab) => tab.id === target.id) ?? target;
        return toChromeTab(after, canSeeTab(call.grants, after));
      },
    }),
    defineApiMethod({
      name: 'tabs.remove',
      callers: both,
      args: z.tuple([z.union([tabId, z.array(tabId).min(1).max(MAX_REMOVE)])]),
      handle: (call, [ids]) => {
        const host = need();
        const wanted = [...new Set(typeof ids === 'number' ? [ids] : ids)];
        // Check every id first so a refusal never leaves the request half done.
        for (const id of wanted) visibleTab(call, id);
        for (const id of wanted) host.remove(id);
        return null;
      },
    }),
  ];

  const unsubscribe = port?.subscribe((event) => {
    if (event.type === 'created') {
      broadcast(context, 'tabs.onCreated', [toChromeTab(event.tab, true)], (grants) => {
        const visible = canSeeTab(grants, event.tab);
        if (visible) markSeen(grants.extensionId, event.tab.id);
        return visible;
      });
    } else if (event.type === 'updated') {
      const { changes, tab } = event;
      const info: Record<string, unknown> = {
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.url === undefined ? {} : { url: changes.url }),
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...(changes.favIconUrl === undefined ? {} : { favIconUrl: changes.favIconUrl }),
        ...(changes.audible === undefined ? {} : { audible: changes.audible }),
        ...(changes.muted === undefined ? {} : { mutedInfo: { muted: changes.muted } }),
      };
      broadcast(context, 'tabs.onUpdated', [tab.id, info, toChromeTab(tab, true)], (grants) => {
        const visible = canSeeTab(grants, tab);
        if (visible) markSeen(grants.extensionId, tab.id);
        return visible;
      });
    } else if (event.type === 'removed') {
      broadcast(
        context,
        'tabs.onRemoved',
        [event.tabId, { windowId: event.windowId, isWindowClosing: false }],
        (grants) => seen.get(grants.extensionId)?.has(event.tabId) === true
      );
      for (const ids of seen.values()) ids.delete(event.tabId);
    } else {
      const tab = port.list().find((candidate) => candidate.id === event.tabId);
      if (tab === undefined) return;
      broadcast(context, 'tabs.onActivated', [{ tabId: event.tabId, windowId: event.windowId }], (grants) =>
        canSeeTab(grants, tab)
      );
    }
  });

  return {
    methods,
    ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }),
  };
};
