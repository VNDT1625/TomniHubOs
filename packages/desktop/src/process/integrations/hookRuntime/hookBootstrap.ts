/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import i18n, { i18nReady } from '@process/services/i18n';
import { getHookCoverage, getHookRegistry } from '@process/integrations/hookRuntime/hookDispatcher';
import { registerHookSettingsBridge } from '@process/integrations/hookRuntime/hookBridge';

type Options = Readonly<{
  getWindow: () => BrowserWindow | null;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
}>;

/** The native dialog shows at most this much of the description; the full text stays in the approval hash. */
const MAX_DETAIL_CHARS = 1800;

const detailOf = (lines: readonly { key: string; value: string }[]): string => {
  const text = lines.map((line) => `${i18n.t(`settings.hooks.line.${line.key}`)}: ${line.value}`).join('\n');
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
};

/**
 * Wires the hook controls to the application main frame, a native confirmation and content-free receipts.
 * Only the main window's top frame may call them.
 */
export const registerDesktopHookSettings = (options: Options): (() => void) => {
  const journal = new JsonlDurableEventStore(
    path.join(app.getPath('userData'), 'tomny-core', 'runs', 'hook-settings.jsonl')
  );
  const ready = journal.initialize();
  void ready.catch((): undefined => undefined);
  let tail: Promise<unknown> = ready;

  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const window = options.getWindow();
    return Boolean(
      window &&
      !window.isDestroyed() &&
      !event.sender.isDestroyed() &&
      window.webContents === event.sender &&
      event.senderFrame === event.sender.mainFrame &&
      options.verifySender(event)
    );
  };

  return registerHookSettingsBridge({
    ipcMain,
    verifySender: trusted,
    getRegistry: getHookRegistry,
    coverageOf: getHookCoverage,
    confirmApprove: async (event, detail) => {
      await i18nReady;
      const window = options.getWindow();
      if (!window || !trusted(event)) return false;
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: i18n.t('settings.hooks.confirmTitle'),
        message: i18n.t('settings.hooks.confirmApprove'),
        detail: detailOf(detail.lines),
        buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    audit: async (record) => {
      const next = tail.then(() =>
        journal.append({
          sessionId: record.subjectId,
          requestId: `hook-settings:${record.operation}`,
          kind: 'custom',
          visibility: 'private',
          payload: { origin: 'human-hook-settings', operation: record.operation, status: record.status },
        })
      );
      tail = next.catch((): undefined => undefined);
      await next;
    },
  });
};
