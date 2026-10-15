/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.contextMenus` (docs/platform/repotopackage-design.md section 12.3): `create`, `update`, `remove`,
 * `removeAll`, `onClicked`, mapped onto the right-click menu of Browser tabs.
 *
 * Main keeps each extension's items in memory; the menu itself is drawn by the host through
 * {@link ContextMenusPort}: on a right click it asks {@link ContextMenuHost.sectionsFor} what to show, and reports
 * a choice through {@link ContextMenuHost.select}. The items are keyed by the calling extension, so one extension
 * can never create, change, remove or click another one's items, and the host learns an extension's items only
 * through its sections. Items of an extension that is not loaded any more are never shown.
 *
 * Not supported (the schemas refuse them): `onclick` and `command` (not allowed in Manifest V3), launcher and
 * browser-action contexts. Every item needs the `contextMenus` permission.
 */

import { z } from 'zod';
import { parseMatchPattern, urlCoveredBy } from '@process/integrations/browserExtensions/api/matchPattern';
import { emitTo } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import { toChromeTab, type PortTab } from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type ContextKind = 'page' | 'selection' | 'link' | 'editable' | 'image' | 'video' | 'audio' | 'frame';

/** What the person right-clicked. Built by the host from the page, never by the extension. */
export type ContextMenuRequest = Readonly<{
  tabId: number;
  pageUrl: string;
  frameUrl?: string;
  linkUrl?: string;
  srcUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
  selectionText?: string;
  editable: boolean;
  contexts: readonly ContextKind[];
}>;

export type MenuNode = Readonly<{
  itemId: string;
  title: string;
  type: 'normal' | 'checkbox' | 'radio' | 'separator';
  checked: boolean;
  enabled: boolean;
  children: readonly MenuNode[];
}>;

/** The items of one extension that apply to a click. */
export type ContextMenuSection = Readonly<{ extensionId: string; extensionName: string; items: readonly MenuNode[] }>;

export type ContextMenuHost = Readonly<{
  sectionsFor: (request: ContextMenuRequest) => readonly ContextMenuSection[];
  select: (extensionId: string, itemId: string, request: ContextMenuRequest) => void;
}>;

export type ContextMenusPort = Readonly<{
  /** The host starts asking for menus. Returns the function that stops it. */
  register: (host: ContextMenuHost) => () => void;
  /** Optional: lets `onClicked` carry the tab the click happened in. */
  tab?: (tabId: number) => PortTab | undefined;
}>;

const MAX_ITEMS = 100;
const MAX_DEPTH = 4;
const MAX_PATTERNS = 20;
const MENU_PERMISSION = ['contextMenus'] as const;
const CONTEXTS = [
  'all',
  'page',
  'frame',
  'selection',
  'link',
  'editable',
  'image',
  'video',
  'audio',
] as const satisfies readonly string[];

type Item = {
  id: string;
  parentId?: string;
  title: string;
  type: 'normal' | 'checkbox' | 'radio' | 'separator';
  checked: boolean;
  enabled: boolean;
  visible: boolean;
  contexts: readonly string[];
  documentUrlPatterns: readonly string[] | undefined;
  targetUrlPatterns: readonly string[] | undefined;
};

const pattern = z
  .string()
  .max(500)
  .refine((value) => parseMatchPattern(value) !== undefined);
const properties = {
  type: z.enum(['normal', 'checkbox', 'radio', 'separator']).optional(),
  title: z.string().max(256).optional(),
  checked: z.boolean().optional(),
  contexts: z.array(z.enum(CONTEXTS)).min(1).max(CONTEXTS.length).optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  parentId: z.string().min(1).max(256).optional(),
  documentUrlPatterns: z.array(pattern).max(MAX_PATTERNS).optional(),
  targetUrlPatterns: z.array(pattern).max(MAX_PATTERNS).optional(),
};
const itemId = z.string().min(1).max(256);
const createSchema = z.object({ id: itemId.optional(), ...properties }).strict();
const updateSchema = z.object(properties).strict();

const SELECTION_LIMIT = 100;
const titleFor = (item: Item, request: ContextMenuRequest): string => {
  const selection = request.selectionText ?? '';
  const shown = selection.length > SELECTION_LIMIT ? `${selection.slice(0, SELECTION_LIMIT - 1)}…` : selection;
  return item.title.replaceAll('%s', shown);
};

const matches = (item: Item, request: ContextMenuRequest): boolean => {
  if (!item.visible) return false;
  const wanted = item.contexts.includes('all')
    ? request.contexts.length > 0
    : request.contexts.some((kind) => item.contexts.includes(kind));
  if (!wanted) return false;
  if (item.documentUrlPatterns !== undefined && !urlCoveredBy(item.documentUrlPatterns, request.pageUrl)) return false;
  if (item.targetUrlPatterns !== undefined) {
    const target = request.linkUrl ?? request.srcUrl;
    if (target === undefined || !urlCoveredBy(item.targetUrlPatterns, target)) return false;
  }
  return true;
};

const descendants = (store: Map<string, Item>, id: string): string[] => {
  const found: string[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const item of store.values()) {
      if (item.parentId === current) {
        found.push(item.id);
        queue.push(item.id);
      }
    }
  }
  return found;
};

const apply = (item: Item, values: z.output<typeof updateSchema>): void => {
  if (values.type !== undefined) item.type = values.type;
  if (values.title !== undefined) item.title = values.title;
  if (values.checked !== undefined) item.checked = values.checked;
  if (values.contexts !== undefined) item.contexts = [...new Set(values.contexts)];
  if (values.visible !== undefined) item.visible = values.visible;
  if (values.enabled !== undefined) item.enabled = values.enabled;
  if (values.documentUrlPatterns !== undefined) item.documentUrlPatterns = values.documentUrlPatterns;
  if (values.targetUrlPatterns !== undefined) item.targetUrlPatterns = values.targetUrlPatterns;
};

export const createContextMenusApi = (context: GroupContext, port: ContextMenusPort | undefined): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;
  const stores = new Map<string, Map<string, Item>>();
  let counter = 0;

  const storeOf = (extensionId: string): Map<string, Item> => {
    let store = stores.get(extensionId);
    if (store === undefined) {
      store = new Map();
      stores.set(extensionId, store);
    }
    return store;
  };
  const need = (): ContextMenusPort => {
    if (port === undefined) {
      throw new ApiError('UNSUPPORTED', 'chrome.contextMenus is not available: the Browser is not wired.');
    }
    return port;
  };
  const depthOf = (store: Map<string, Item>, item: Item): number => {
    let depth = 1;
    for (let at = item; at.parentId !== undefined && depth <= MAX_DEPTH + 1; depth += 1) {
      const parent = store.get(at.parentId);
      if (parent === undefined) break;
      at = parent;
    }
    return depth;
  };
  const checkParent = (store: Map<string, Item>, id: string, parentId: string | undefined): void => {
    if (parentId === undefined) return;
    if (parentId === id) throw new ApiError('REJECTED', 'An item cannot be its own parent.');
    const parent = store.get(parentId);
    if (parent === undefined) throw new ApiError('REJECTED', `Cannot find menu item with id ${parentId}.`);
    for (let at: Item | undefined = parent; at !== undefined; at = at.parentId ? store.get(at.parentId) : undefined) {
      if (at.id === id) throw new ApiError('REJECTED', 'An item cannot be a child of its own descendant.');
    }
  };

  const methods = [
    defineApiMethod({
      name: 'contextMenus.create',
      callers: both,
      requires: MENU_PERMISSION,
      args: z.tuple([createSchema]),
      handle: (call, [details]) => {
        need();
        const store = storeOf(call.extensionId);
        counter += 1;
        const id = details.id ?? `tomny-menu-${counter}`;
        if (store.has(id)) throw new ApiError('REJECTED', `Cannot create item with duplicate id ${id}.`);
        if (store.size >= MAX_ITEMS) throw new ApiError('REJECTED', 'Too many context menu items.');
        const type = details.type ?? 'normal';
        if (type !== 'separator' && (details.title === undefined || details.title === '')) {
          throw new ApiError('INVALID_ARGUMENTS', 'A context menu item needs a title.');
        }
        checkParent(store, id, details.parentId);
        const item: Item = {
          id,
          ...(details.parentId === undefined ? {} : { parentId: details.parentId }),
          title: details.title ?? '',
          type,
          checked: details.checked ?? false,
          enabled: details.enabled ?? true,
          visible: details.visible ?? true,
          contexts: [...new Set(details.contexts ?? ['page'])],
          documentUrlPatterns: details.documentUrlPatterns,
          targetUrlPatterns: details.targetUrlPatterns,
        };
        if (depthOf(store, item) > MAX_DEPTH) throw new ApiError('REJECTED', 'Context menu items are nested too deep.');
        store.set(id, item);
        return id;
      },
    }),
    defineApiMethod({
      name: 'contextMenus.update',
      callers: both,
      requires: MENU_PERMISSION,
      args: z.tuple([itemId, updateSchema]),
      handle: (call, [id, values]) => {
        need();
        const store = storeOf(call.extensionId);
        const item = store.get(id);
        if (item === undefined) throw new ApiError('REJECTED', `Cannot find menu item with id ${id}.`);
        if (values.parentId !== undefined) {
          checkParent(store, id, values.parentId);
          item.parentId = values.parentId;
          if (depthOf(store, item) > MAX_DEPTH) {
            throw new ApiError('REJECTED', 'Context menu items are nested too deep.');
          }
        }
        apply(item, values);
        return null;
      },
    }),
    defineApiMethod({
      name: 'contextMenus.remove',
      callers: both,
      requires: MENU_PERMISSION,
      args: z.tuple([itemId]),
      handle: (call, [id]) => {
        need();
        const store = storeOf(call.extensionId);
        if (!store.has(id)) throw new ApiError('REJECTED', `Cannot find menu item with id ${id}.`);
        for (const child of descendants(store, id)) store.delete(child);
        store.delete(id);
        return null;
      },
    }),
    defineApiMethod({
      name: 'contextMenus.removeAll',
      callers: both,
      requires: MENU_PERMISSION,
      args: z.tuple([]),
      handle: (call) => {
        need();
        stores.delete(call.extensionId);
        return null;
      },
    }),
  ];

  const tree = (store: Map<string, Item>, request: ContextMenuRequest, parentId: string | undefined): MenuNode[] => {
    const nodes: MenuNode[] = [];
    for (const item of store.values()) {
      if (item.parentId !== parentId || !matches(item, request)) continue;
      nodes.push({
        itemId: item.id,
        title: titleFor(item, request),
        type: item.type,
        checked: item.checked,
        enabled: item.enabled,
        children: tree(store, request, item.id),
      });
    }
    return nodes;
  };

  const host: ContextMenuHost = {
    sectionsFor: (request) => {
      const sections: ContextMenuSection[] = [];
      for (const [extensionId, store] of Array.from(stores)) {
        const grants = context.grants.get(extensionId);
        if (grants === undefined) {
          stores.delete(extensionId);
          continue;
        }
        if (!grants.hasPermission('contextMenus')) continue;
        const items = tree(store, request, undefined);
        if (items.length > 0) sections.push({ extensionId, extensionName: grants.name, items });
      }
      return sections;
    },
    select: (extensionId, id, request) => {
      const store = stores.get(extensionId);
      const item = store?.get(id);
      if (!context.grants.has(extensionId) || store === undefined || item === undefined || !item.enabled) return;
      if (item.type === 'separator') return;
      const wasChecked = item.checked;
      if (item.type === 'checkbox') item.checked = !item.checked;
      if (item.type === 'radio') {
        // A radio group is the run of radio items next to each other under the same parent.
        const siblings = [...store.values()].filter((other) => other.parentId === item.parentId);
        const at = siblings.indexOf(item);
        let from = at;
        let to = at;
        while (from > 0 && siblings[from - 1]?.type === 'radio') from -= 1;
        while (to < siblings.length - 1 && siblings[to + 1]?.type === 'radio') to += 1;
        for (const other of siblings.slice(from, to + 1)) other.checked = other === item;
      }
      const tab = port?.tab?.(request.tabId);
      const info = {
        menuItemId: item.id,
        ...(item.parentId === undefined ? {} : { parentMenuItemId: item.parentId }),
        ...(request.mediaType === undefined ? {} : { mediaType: request.mediaType }),
        ...(request.linkUrl === undefined ? {} : { linkUrl: request.linkUrl }),
        ...(request.srcUrl === undefined ? {} : { srcUrl: request.srcUrl }),
        pageUrl: request.pageUrl,
        ...(request.frameUrl === undefined ? {} : { frameUrl: request.frameUrl }),
        ...(request.selectionText === undefined ? {} : { selectionText: request.selectionText }),
        editable: request.editable,
        ...(item.type === 'checkbox' || item.type === 'radio' ? { checked: item.checked, wasChecked } : {}),
      };
      // The person chose this item of this extension, so the page they clicked on is theirs to share with it.
      const shaped = tab === undefined ? undefined : toChromeTab(tab, true);
      emitTo(context, extensionId, 'contextMenus.onClicked', shaped === undefined ? [info] : [info, shaped]);
    },
  };

  const unregister = port?.register(host);
  return { methods, ...(unregister === undefined ? {} : { dispose: unregister }) };
};
