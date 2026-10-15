/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.webNavigation` (docs/platform/repotopackage-design.md sections 12.3 and 12.8): the events `onBeforeNavigate`,
 * `onCommitted`, `onDOMContentLoaded` and `onCompleted`, and `getFrame` / `getAllFrames` for the main frame of a tab.
 *
 * - Only the main frame is reported. `frameId` is always 0 and `parentFrameId` is always -1. A call for any other frame
 *   answers null, as Chrome does for a frame that does not exist.
 * - A navigation is reported only to an extension that holds the `webNavigation` permission and a host permission
 *   (required, or granted later) that covers the URL, as Chrome requires. Other extensions do not learn the address.
 * - Events come from {@link WebNavigationPort}. The wiring builds it from the `webContents` of the Browser's tabs.
 */

import { z } from 'zod';
import type { ExtensionGrants } from '@process/integrations/browserExtensions/api/grants';
import { urlCoveredBy } from '@process/integrations/browserExtensions/api/matchPattern';
import type { TabsPort } from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import { broadcast } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type CallContext,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

/** `before`: about to navigate; `committed`: the new page replaced the old one; `dom`; `completed`: loaded. */
export type NavigationPhase = 'before' | 'committed' | 'dom' | 'completed';

export type NavigationEvent = Readonly<{
  phase: NavigationPhase;
  tabId: number;
  url: string;
  timeStamp: number;
  transitionType?: string;
}>;

export type WebNavigationPort = Readonly<{
  /** Returns the unsubscribe function. Only main-frame phases are sent. */
  subscribe: (listener: (event: NavigationEvent) => void) => () => void;
}>;

const EVENT_NAMES: Readonly<Record<NavigationPhase, string>> = {
  before: 'webNavigation.onBeforeNavigate',
  committed: 'webNavigation.onCommitted',
  dom: 'webNavigation.onDOMContentLoaded',
  completed: 'webNavigation.onCompleted',
};
const MAIN_FRAME = 0;
const NO_PARENT_FRAME = -1;
const WEB_NAVIGATION = ['webNavigation'] as const;
const tabIdSchema = z.number().int().min(0).max(2_147_483_647);

/** The `webNavigation` permission and a host permission that covers the URL. */
const permitted = (grants: ExtensionGrants, url: string): boolean =>
  grants.hasPermission('webNavigation') && urlCoveredBy(grants.granted().origins, url);

export const createWebNavigationApi = (
  context: GroupContext,
  navigation: WebNavigationPort | undefined,
  tabs: TabsPort | undefined
): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;

  const needTabs = (): TabsPort => {
    if (tabs === undefined) {
      throw new ApiError('UNSUPPORTED', 'chrome.webNavigation is not available: the Browser tabs are not wired.');
    }
    return tabs;
  };
  /** The main frame of a tab the extension may learn about, or undefined. */
  const mainFrameOf = (call: CallContext, id: number): Record<string, unknown> | undefined => {
    const tab = needTabs()
      .list()
      .find((candidate) => candidate.id === id);
    if (tab === undefined || !permitted(call.grants, tab.url)) return undefined;
    return {
      url: tab.url,
      frameId: MAIN_FRAME,
      parentFrameId: NO_PARENT_FRAME,
      errorOccurred: false,
      processId: 0,
    };
  };

  const frameArgs = z
    .object({
      tabId: tabIdSchema,
      frameId: z.number().int().min(0),
      processId: z.number().int().optional(),
      documentId: z.string().max(256).optional(),
    })
    .strict();

  const methods = [
    defineApiMethod({
      name: 'webNavigation.getFrame',
      callers: both,
      requires: WEB_NAVIGATION,
      args: z.tuple([frameArgs]),
      handle: (call, [details]) => {
        const frame = mainFrameOf(call, details.tabId);
        return details.frameId === MAIN_FRAME && frame !== undefined ? frame : null;
      },
    }),
    defineApiMethod({
      name: 'webNavigation.getAllFrames',
      callers: both,
      requires: WEB_NAVIGATION,
      args: z.tuple([z.object({ tabId: tabIdSchema }).strict()]),
      handle: (call, [details]) => {
        const frame = mainFrameOf(call, details.tabId);
        return frame === undefined ? null : [frame];
      },
    }),
  ];

  const unsubscribe = navigation?.subscribe((event) => {
    const details = {
      tabId: event.tabId,
      url: event.url,
      frameId: MAIN_FRAME,
      parentFrameId: NO_PARENT_FRAME,
      processId: 0,
      timeStamp: event.timeStamp,
      ...(event.phase === 'committed'
        ? { transitionType: event.transitionType ?? 'link', transitionQualifiers: [] as string[] }
        : {}),
    };
    broadcast(context, EVENT_NAMES[event.phase], [details], (grants) => permitted(grants, event.url));
  });

  return { methods, ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }) };
};
