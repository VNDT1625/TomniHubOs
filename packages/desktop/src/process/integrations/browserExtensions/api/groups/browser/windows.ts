/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.windows` (docs/platform/repotopackage-design.md sections 12.3 and 12.8). Tomny has one window for the
 * Browser, and this API describes that window: `get`, `getAll`, `getCurrent`, `getLastFocused`, `create` (opens tabs
 * in it), `update` (only `focused`), `remove` (refused) and the `onFocusChanged` event.
 *
 * - Every extension sees the window, as in Chrome. Its tabs are listed only where `tabAccess.ts` lets the extension
 *   see them.
 * - Closing the Browser window is refused: it would close the tabs of every extension and of the person.
 * - Focus and bounds come from {@link WindowsPort}. Without it every method answers UNSUPPORTED.
 * - Options that would change the shape of the window (size, position, state, popup or panel windows, incognito)
 *   are refused, not ignored.
 */

import { z } from 'zod';
import type { TabsPort } from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import { broadcast } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import {
  BROWSER_WINDOW_ID,
  WINDOW_ID_CURRENT,
  canSeeTab,
  isNavigableUrl,
  toChromeTab,
} from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type CallContext,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type WindowBounds = Readonly<{ left: number; top: number; width: number; height: number }>;

/** What the Hub reports about its Browser window. */
export type WindowsPort = Readonly<{
  isFocused: () => boolean;
  bounds: () => WindowBounds;
  /** Brings the window to the front. */
  focus: () => void;
  /** Returns the unsubscribe function. The listener gets true when the window gains focus, false when it loses it. */
  subscribeFocus: (listener: (focused: boolean) => void) => () => void;
}>;

/** `chrome.windows.WINDOW_ID_NONE`: no window has focus. */
const WINDOW_ID_NONE = -1;
const MAX_TABS = 100;
const MAX_CREATE_URLS = 10;
const CREATE_WINDOW_MS = 10_000;
const CREATE_PER_WINDOW = 20;
const WINDOW_TYPES = ['normal', 'popup', 'panel', 'app', 'devtools'] as const;

const windowId = z.number().int().min(-2);
const urlText = z.string().min(1).max(2048);
const infoSchema = z
  .object({
    populate: z.boolean().optional(),
    windowTypes: z.array(z.enum(WINDOW_TYPES)).max(WINDOW_TYPES.length).optional(),
  })
  .strict();
const createSchema = z
  .object({
    url: z.union([urlText, z.array(urlText).min(1).max(MAX_CREATE_URLS)]).optional(),
    focused: z.boolean().optional(),
    type: z.enum(['normal', 'popup', 'panel']).optional(),
    incognito: z.boolean().optional(),
  })
  .strict();
const updateSchema = z.object({ focused: z.boolean().optional() }).strict();

/** An optional last argument: a call may pass nothing or the object. */
const optionalArgument = <T extends z.ZodTypeAny>(schema: T) => z.union([z.tuple([]), z.tuple([schema])]);

const first = <T>(args: readonly unknown[]): T | undefined => args[0] as T | undefined;

export const createWindowsApi = (
  context: GroupContext,
  port: WindowsPort | undefined,
  tabs: TabsPort | undefined
): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;
  const created = new Map<string, number[]>();

  const need = (): WindowsPort => {
    if (port === undefined) {
      throw new ApiError('UNSUPPORTED', 'chrome.windows is not available: the Browser window is not wired.');
    }
    return port;
  };
  const needTabs = (): TabsPort => {
    if (tabs === undefined) {
      throw new ApiError('UNSUPPORTED', 'chrome.windows.create needs the Browser tabs, which are not wired.');
    }
    return tabs;
  };
  const checkId = (id: number): void => {
    if (id !== BROWSER_WINDOW_ID && id !== WINDOW_ID_CURRENT) {
      throw new ApiError('REJECTED', `No window with id: ${id}.`);
    }
  };
  const describe = (call: CallContext, populate: boolean): Record<string, unknown> => {
    const host = need();
    const visible = populate ? (tabs?.list() ?? []).filter((tab) => canSeeTab(call.grants, tab)) : [];
    return {
      id: BROWSER_WINDOW_ID,
      focused: host.isFocused(),
      incognito: false,
      alwaysOnTop: false,
      state: 'normal',
      type: 'normal',
      ...host.bounds(),
      ...(populate ? { tabs: visible.map((tab) => toChromeTab(tab, true)) } : {}),
    };
  };
  const throttle = (extensionId: string): void => {
    const stamp = Date.now();
    const recent = (created.get(extensionId) ?? []).filter((time) => stamp - time < CREATE_WINDOW_MS);
    if (recent.length >= CREATE_PER_WINDOW) throw new ApiError('BUSY', 'Too many windows were opened too quickly.');
    created.set(extensionId, [...recent, stamp]);
  };

  const methods = [
    defineApiMethod({
      name: 'windows.get',
      callers: both,
      args: z.union([z.tuple([windowId]), z.tuple([windowId, infoSchema])]),
      handle: (call, args) => {
        const [id, info] = args as unknown as readonly [number, z.output<typeof infoSchema> | undefined];
        checkId(id);
        return describe(call, info?.populate === true);
      },
    }),
    defineApiMethod({
      name: 'windows.getCurrent',
      callers: both,
      args: optionalArgument(infoSchema),
      handle: (call, args) => describe(call, first<z.output<typeof infoSchema>>(args)?.populate === true),
    }),
    defineApiMethod({
      name: 'windows.getLastFocused',
      callers: both,
      args: optionalArgument(infoSchema),
      handle: (call, args) => describe(call, first<z.output<typeof infoSchema>>(args)?.populate === true),
    }),
    defineApiMethod({
      name: 'windows.getAll',
      callers: both,
      args: optionalArgument(infoSchema),
      handle: (call, args) => {
        const info = first<z.output<typeof infoSchema>>(args);
        if (info?.windowTypes !== undefined && !info.windowTypes.includes('normal')) return [];
        return [describe(call, info?.populate === true)];
      },
    }),
    defineApiMethod({
      name: 'windows.create',
      callers: both,
      args: optionalArgument(createSchema),
      handle: async (call, args) => {
        const options: z.output<typeof createSchema> = first<z.output<typeof createSchema>>(args) ?? {};
        const host = needTabs();
        if (options.type !== undefined && options.type !== 'normal') {
          throw new ApiError('UNSUPPORTED', 'Only normal windows can be opened in Tomny.');
        }
        if (options.incognito === true) throw new ApiError('UNSUPPORTED', 'Incognito windows are not supported.');
        const urls: readonly string[] =
          options.url === undefined ? [] : typeof options.url === 'string' ? [options.url] : options.url;
        for (const url of urls) {
          if (!isNavigableUrl(call.grants, url)) {
            throw new ApiError('REJECTED', 'This URL cannot be opened by an extension.');
          }
        }
        if (host.list().length + Math.max(urls.length, 1) > MAX_TABS) {
          throw new ApiError('REJECTED', 'Too many tabs are open.');
        }
        throttle(call.extensionId);
        const focused = options.focused !== false;
        if (urls.length === 0) await host.create({ active: focused });
        // Tabs open one after another, in the order the extension listed them.
        for (const [index, url] of urls.entries()) {
          // oxlint-disable-next-line no-await-in-loop -- each tab is created before the next one
          await host.create({ url, active: focused && index === 0 });
        }
        return describe(call, false);
      },
    }),
    defineApiMethod({
      name: 'windows.update',
      callers: both,
      args: z.tuple([windowId, updateSchema]),
      handle: (call, [id, update]) => {
        checkId(id);
        if (update.focused === true) need().focus();
        return describe(call, false);
      },
    }),
    defineApiMethod({
      name: 'windows.remove',
      callers: both,
      args: z.tuple([windowId]),
      handle: (_call, [id]) => {
        checkId(id);
        throw new ApiError('REJECTED', 'The Browser window cannot be closed by an extension.');
      },
    }),
  ];

  const unsubscribe = port?.subscribeFocus((focused) => {
    broadcast(context, 'windows.onFocusChanged', [focused ? BROWSER_WINDOW_ID : WINDOW_ID_NONE], () => true);
  });

  return { methods, ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }) };
};
