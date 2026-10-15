/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { buildExtensionStripItems, type StripRecord } from '@/common/integrations/extensions/stripItems';
import { EXTENSION_STRIP_CHANNELS, type ExtensionStripResult } from '@/common/integrations/extensions/stripContract';
import { SITE_ACCESS_MODES } from '@/common/integrations/extensions/siteAccess';
import type { ExtensionStripActions } from './extensionStripActions';
import type { ExtensionUserState } from '@process/integrations/browserExtensions/state/userState';

const EXTENSION_ID = /^[a-p]{32}$/u;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

// `.strict()` everywhere: a request that carries anything else (an origin, a URL, a path) is refused whole.
const LIST_REQUEST = z.object({ tabId: z.string().min(1).max(200).optional() }).strict();
const PIN_REQUEST = z.object({ id: z.string().regex(EXTENSION_ID), pinned: z.boolean() }).strict();
const MODE_REQUEST = z.object({ id: z.string().regex(EXTENSION_ID), mode: z.enum(SITE_ACCESS_MODES) }).strict();
const ID_REQUEST = z.object({ id: z.string().regex(EXTENSION_ID) }).strict();
const UNINSTALL_REQUEST = z.object({ packageId: z.string().regex(PACKAGE_ID) }).strict();

export type ExtensionStripBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** The loaded extensions, read from Main's extension host. */
  records: () => Promise<readonly StripRecord[]>;
  userState: () => Promise<ExtensionUserState>;
  /** Origin of the active web tab (or of the tab the request names, if it names one). Read by Main only. */
  activeOrigin: (requestedTabId?: string) => string | undefined;
  actions: ExtensionStripActions;
}>;

/**
 * Registers the header strip's channels. Only the main window's top frame may call them. The sender is checked before
 * and after each read, and every response carries no path, manifest, key, grant or URL.
 */
export const registerExtensionStripBridge = (options: ExtensionStripBridgeOptions): (() => void) => {
  let active = true;
  const allowed = (event: IpcMainInvokeEvent): boolean => active && options.verifySender(event);

  const handleRequest = <T>(channel: string, schema: z.ZodType<T>, run: (request: T) => Promise<unknown>): void => {
    options.ipcMain.handle(channel, async (event: IpcMainInvokeEvent, raw: unknown): Promise<unknown> => {
      try {
        if (!allowed(event)) return { ok: false, error: 'DENIED' };
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
        const result = await run(parsed.data);
        if (!allowed(event)) return { ok: false, error: 'DENIED' };
        return result;
      } catch {
        return { ok: false, error: 'IO_ERROR' };
      }
    });
  };

  handleRequest(EXTENSION_STRIP_CHANNELS.list, LIST_REQUEST, async ({ tabId }): Promise<ExtensionStripResult> => {
    const records = await options.records();
    const state = await options.userState();
    const declared = new Map(records.map((record) => [record.extensionId, record.siteAccess ?? []] as const));
    return {
      ok: true,
      data: buildExtensionStripItems(records, {
        activeOrigin: options.activeOrigin(tabId),
        configOf: (extensionId) => state.configOf(extensionId, declared.get(extensionId) ?? []),
        isPinned: (extensionId) => state.isPinned(extensionId),
      }),
    };
  });

  handleRequest(EXTENSION_STRIP_CHANNELS.setPinned, PIN_REQUEST, (request) =>
    options.actions.setPinned(request.id, request.pinned)
  );
  handleRequest(EXTENSION_STRIP_CHANNELS.setSiteAccess, MODE_REQUEST, (request) =>
    options.actions.setSiteAccess(request.id, request.mode)
  );
  handleRequest(EXTENSION_STRIP_CHANNELS.allowSite, ID_REQUEST, (request) => options.actions.allowSite(request.id));
  handleRequest(EXTENSION_STRIP_CHANNELS.uninstall, UNINSTALL_REQUEST, (request) =>
    options.actions.uninstall(request.packageId)
  );

  return () => {
    active = false;
    for (const channel of Object.values(EXTENSION_STRIP_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
