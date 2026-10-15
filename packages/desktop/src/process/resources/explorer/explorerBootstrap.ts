import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import i18n, { i18nReady } from '@process/services/i18n';
import { getSystemDir } from '@process/utils/initStorage';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import { ExplorerService, ExplorerServiceError } from './explorerService';
import { registerExplorerBridge } from './explorerBridge';
import { ExplorerBlockStore } from './explorerBlockStore';
import { ExplorerGrantStore } from './explorerGrantStore';
import { createChooseRoot } from './explorerChooseRoot';
import { moveExplorerItem, assertLocalExplorerRoot } from './nativeMove';

import { registerDesktopLibrary } from '@process/integrations/library/libraryBootstrap';

export type DesktopExplorerOptions = {
  getWindow: () => BrowserWindow | null;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Main-owned shared block store; the agent mutation seam sees the same blocked trees. */
  blockStore?: ExplorerBlockStore;
};

export type DesktopExplorerHandle = Readonly<{
  /** Shared block store so the agent mutation seam refuses the same blocked trees. */
  blockStore: ExplorerBlockStore;
  /** Detach the IPC handlers and close open sessions. */
  unregister: () => void;
}>;

const releaseBoth = (first: () => void, second: () => void) => () => {
  first();
  second();
};

/** Local human file operations use a separate sender-bound port; no model/tool adapter receives it. */
export const registerDesktopExplorer = (options: DesktopExplorerOptions): DesktopExplorerHandle => {
  const journal = new JsonlDurableEventStore(
    path.join(app.getPath('userData'), 'tomny-core', 'runs', 'explorer.jsonl')
  );
  const ready = journal.initialize().then(() => {
    if (journal.getIntegrityIssues().length > 0) throw new ExplorerServiceError('AUDIT_FAILED');
  });
  void ready.catch((): undefined => undefined);
  let auditTail: Promise<unknown> = ready;
  const blockStore =
    options.blockStore ??
    new ExplorerBlockStore(path.join(app.getPath('userData'), 'tomny-core', 'runs', 'explorer-blocks.json'));
  // Folder grants live in a durable machine-local ledger: a folder the user approved once stays
  // approved across restarts, so opening an agent workspace never asks a second time. The port is
  // sender-bound to the single trusted window, so one app-wide list is the right scope.
  const grantStore = new ExplorerGrantStore(
    path.join(app.getPath('userData'), 'tomny-core', 'runs', 'explorer-grants.json')
  );
  const nativeWindow = (): BrowserWindow => {
    const window = options.getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new ExplorerServiceError('DENIED');
    return window;
  };
  const service = new ExplorerService({
    appendAudit: async (receipt) => {
      const next = auditTail.then(async () => {
        await journal.append({
          sessionId: receipt.sessionId,
          requestId: receipt.receiptId,
          kind: 'custom',
          visibility: 'private',
          payload: {
            origin: 'human-explorer',
            ownerId: receipt.ownerId,
            operation: receipt.operation,
            status: receipt.status,
            paths: [...receipt.paths],
            targets: [...receipt.targets],
            affectedPaths: [...receipt.affectedPaths],
            ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
          },
        });
      });
      auditTail = next;
      await next;
    },
    approveMutation: async (request, canonicalPaths) => {
      await i18nReady;
      // A folder grant covers every operation beneath it. The window must still be
      // authoritative for the folder itself (handoffs/open/reveal keep confirming).
      if (await grantStore.covers(canonicalPaths)) return true;
      const window = nativeWindow();
      const operationKey: Record<string, string> = {
        'create-file': 'newFile',
        'create-directory': 'newFolder',
        rename: 'rename',
        copy: 'copy',
        move: 'cut',
        delete: 'delete',
        open: 'open',
        reveal: 'reveal',
        block: 'block',
        unblock: 'unblock',
      };
      const response = await dialog.showMessageBox(window, {
        type: request.operation === 'delete' ? 'warning' : 'question',
        title: i18n.t('guid.hubHome.explorer.confirmTitle'),
        message: i18n.t('guid.hubHome.explorer.confirmAction', {
          operation: i18n.t('guid.hubHome.explorer.' + operationKey[request.operation]),
          count: request.paths.length,
        }),
        detail: canonicalPaths.join('\n'),
        buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return response.response === 1 && options.getWindow() === window && !window.isDestroyed();
    },
    trashItem: (absolutePath) => shell.trashItem(absolutePath),
    moveItem: moveExplorerItem,
    openItem: async (absolutePath) => {
      const error = await shell.openPath(absolutePath);
      if (error) throw new ExplorerServiceError('IO_ERROR');
    },
    revealItem: async (absolutePath) => {
      shell.showItemInFolder(absolutePath);
    },
    isBlocked: (canonicalPaths) => blockStore.isBlocked(canonicalPaths),
    blockMutation: (operation, canonicalPaths) =>
      operation === 'block' ? blockStore.block(canonicalPaths) : blockStore.unblock(canonicalPaths),
  });
  // Centre file viewer (S12) and Library (S11): Explorer resolves files inside the roots it granted, and the viewer
  // only ever receives opaque ids. "Open in Hub" in the Explorer menu starts here.
  const hubFiles = registerDesktopLibrary({
    getWindow: options.getWindow,
    verifySender: options.verifySender,
    resolveExplorerFile: (ownerId, sessionId, relativePath) => service.resolveForOpen(ownerId, sessionId, relativePath),
  });

  return {
    blockStore,
    unregister: releaseBoth(
      hubFiles.unregister,
      registerExplorerBridge({
        ipcMain,
        service,
        verifySender: (event) => {
          const window = options.getWindow();
          return Boolean(
            window &&
            !window.isDestroyed() &&
            window.webContents === event.sender &&
            event.senderFrame === event.sender.mainFrame &&
            options.verifySender(event)
          );
        },
        admitRoot: assertLocalExplorerRoot,
        chooseRoot: createChooseRoot({
          resolveWindow: (event) => {
            const window = nativeWindow();
            if (window.webContents !== event.sender) throw new ExplorerServiceError('DENIED');
            return window;
          },
          ready: i18nReady,
          defaultRoot: () => getSystemDir().workDir,
          grantStore,
          t: (key, options) => i18n.t(key, options) as string,
          pickFolder: async (window, defaultPath, title) => {
            const result = await dialog.showOpenDialog(window, {
              title,
              defaultPath,
              properties: ['openDirectory'],
            });
            return result.canceled ? null : (result.filePaths[0] ?? null);
          },
          confirmGrant: async (window, target) => {
            const response = await dialog.showMessageBox(window, {
              type: 'question',
              title: i18n.t('guid.hubHome.explorer.confirmTitle'),
              message: i18n.t('guid.hubHome.explorer.grantFolder'),
              detail: target + '\n' + i18n.t('guid.hubHome.explorer.grantDetail'),
              buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            return response.response === 1;
          },
        }),
      })
    ),
  };
};
