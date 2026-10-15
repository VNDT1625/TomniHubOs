/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import i18n, { i18nReady } from '@process/services/i18n';
import { registerFileViewerBridge } from '../fileViewer/fileViewerBridge';
import { createViewGrants } from '../fileViewer/viewGrants';
import { registerLibraryBridge } from './libraryBridge';
import { createLibraryPort, setActiveLibraryPort, type LibraryPort } from './libraryPort';
import { createLibraryService } from './libraryService';
import { createJsonLibraryStore } from './libraryStore';

export type DesktopLibraryOptions = {
  getWindow: () => BrowserWindow | null;
  /** Origin check shared with the other native ports. */
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Explorer's own session-bound resolver; the viewer never walks a renderer path itself. */
  resolveExplorerFile: (ownerId: number, sessionId: string, relativePath: string) => Promise<string>;
};

export type DesktopLibraryHandle = Readonly<{
  port: LibraryPort;
  unregister: () => void;
}>;

/**
 * Composition root of the file viewer (S12) and the Library (S11). Both share one table of Explorer view grants, so a
 * file opened from Explorer can be added to the Library without the renderer ever naming its path.
 */
export const registerDesktopLibrary = (options: DesktopLibraryOptions): DesktopLibraryHandle => {
  const store = createJsonLibraryStore(path.join(app.getPath('userData'), 'tomny-core', 'library', 'library.json'));
  const ready = store.initialize();
  void ready.catch((): undefined => undefined);
  // Every service call waits for the store to load, so an early call never sees a Library that is still being read.
  const service = createLibraryService(store, ready);
  const grants = createViewGrants();
  const port = createLibraryPort(service);

  const verifySender = (event: IpcMainInvokeEvent): boolean => {
    const window = options.getWindow();
    return Boolean(
      window &&
      !window.isDestroyed() &&
      window.webContents === event.sender &&
      event.senderFrame === event.sender.mainFrame &&
      options.verifySender(event)
    );
  };
  const unregisterViewer = registerFileViewerBridge({
    ipcMain,
    verifySender,
    grants,
    resolveExplorerFile: options.resolveExplorerFile,
    resolveLibraryPath: (entryId) => service.resolvePath(entryId),
    openPath: (absolutePath) => shell.openPath(absolutePath),
  });
  const unregisterLibrary = registerLibraryBridge({
    ipcMain,
    verifySender,
    service,
    grants,
    pickFiles: async (event, multiple) => {
      await i18nReady;
      const window = options.getWindow();
      if (!window || window.isDestroyed() || window.webContents !== event.sender) return null;
      const result = await dialog.showOpenDialog(window, {
        title: i18n.t('guid.hubHome.library.pickTitle'),
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      });
      return result.canceled ? null : result.filePaths;
    },
  });
  setActiveLibraryPort(port);

  return {
    port,
    unregister: () => {
      setActiveLibraryPort(undefined);
      unregisterLibrary();
      unregisterViewer();
    },
  };
};
