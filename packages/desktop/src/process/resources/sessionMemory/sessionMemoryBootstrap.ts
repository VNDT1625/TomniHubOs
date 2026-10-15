import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import i18n, { i18nReady } from '@process/services/i18n';
import { getSessionMemoryStore } from '@process/userUnderstanding/sessionMemoryStore';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import type { TChatConversation } from '@/common/config/storage';
import { registerSessionMemoryBridge } from './sessionMemoryBridge';

type Options = {
  getWindow: () => BrowserWindow | null;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  accountId: () => string;
  getConversation: (id: string) => Promise<TChatConversation | undefined>;
};
/** Native approvals and private content-free receipts for Core session-memory changes. */
export const registerDesktopSessionMemory = (options: Options): (() => void) => {
  const journal = new JsonlDurableEventStore(
    path.join(app.getPath('userData'), 'tomny-core', 'runs', 'session-memory.jsonl')
  );
  const ready = journal.initialize().then(() => {
    if (journal.getIntegrityIssues().length) throw new Error('Memory audit unavailable.');
  });
  void ready.catch((): undefined => undefined);
  let tail: Promise<unknown> = ready;
  const owners = new WeakMap<IpcMainInvokeEvent, string>();
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    let account: string;
    try {
      account = options.accountId();
    } catch {
      return false;
    }
    if (!account || (owners.has(event) && owners.get(event) !== account)) return false;
    owners.set(event, account);
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
  return registerSessionMemoryBridge({
    ipcMain,
    verifySender: trusted,
    memory: getSessionMemoryStore(),
    resolve: async (id) => {
      const conversation = await options.getConversation(id);
      const value = conversation?.extra?.ide_memory_id;
      return typeof value === 'string' && value.length > 0
        ? { memoryId: value, running: conversation?.status === 'running' }
        : undefined;
    },
    confirm: async (event, operation) => {
      await i18nReady;
      const window = options.getWindow();
      if (!window || !trusted(event)) return false;
      const result = await dialog.showMessageBox(window, {
        type: operation === 'remember' ? 'question' : 'warning',
        title: i18n.t('guid.hubHome.memory.title'),
        message: i18n.t(
          'guid.hubHome.memory.' +
            (operation === 'clear' ? 'confirmClear' : operation === 'forget' ? 'confirmForget' : 'confirmRemember')
        ),
        buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    audit: async (record) => {
      const next = tail.then(async () => {
        await journal.append({
          sessionId: record.conversationId,
          requestId: record.requestId,
          kind: 'custom',
          visibility: 'private',
          payload: { origin: 'human-session-memory', operation: record.operation, status: record.status },
        });
      });
      tail = next;
      await next;
    },
  });
};
