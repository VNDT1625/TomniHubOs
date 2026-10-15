/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  LIBRARY_CHANNELS,
  type HubFileResult,
  type LibraryEntrySummary,
} from '@/common/integrations/library/libraryContracts';
import { HubFileError, toFileError } from '../fileViewer/safeFile';
import type { ViewGrants } from '../fileViewer/viewGrants';
import type { LibraryService } from './libraryService';

const boundedId = z.string().min(1).max(128);
const entrySchema = z.object({ entryId: boundedId }).strict();
const viewSchema = z.object({ viewId: boundedId }).strict();
const emptySchema = z.undefined();

export type LibraryBridgeOptions = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  /** Only the trusted application window may call. */
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  service: LibraryService;
  grants: ViewGrants;
  /**
   * Native file picker owned by Main. The person's choice in that dialog is the only way a path enters the Library from
   * outside Explorer, so the renderer can never nominate one. Resolves null when cancelled.
   */
  pickFiles: (event: IpcMainInvokeEvent, multiple: boolean) => Promise<string[] | null>;
};

export const registerLibraryBridge = (options: LibraryBridgeOptions): (() => void) => {
  const execute = async <T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<HubFileResult<T>> => {
    try {
      if (!options.verifySender(event)) throw new HubFileError('DENIED');
      return { ok: true, data: await operation() };
    } catch (error) {
      return { ok: false, code: toFileError(error).code };
    }
  };

  options.ipcMain.handle(LIBRARY_CHANNELS.list, (event, raw: unknown) =>
    execute(event, async () => {
      if (!emptySchema.safeParse(raw).success) throw new HubFileError('INVALID_REQUEST');
      return options.service.list();
    })
  );

  options.ipcMain.handle(LIBRARY_CHANNELS.add, (event, raw: unknown) =>
    execute(event, async (): Promise<LibraryEntrySummary[]> => {
      if (!emptySchema.safeParse(raw).success) throw new HubFileError('INVALID_REQUEST');
      const picked = await options.pickFiles(event, true);
      return picked && picked.length > 0 ? options.service.addPicked(picked) : [];
    })
  );

  options.ipcMain.handle(LIBRARY_CHANNELS.addFromView, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = viewSchema.safeParse(raw);
      if (!parsed.success) throw new HubFileError('INVALID_REQUEST');
      const target = options.grants.resolve(parsed.data.viewId);
      if (!target) throw new HubFileError('NOT_FOUND');
      const [added] = await options.service.addPicked([target]);
      if (!added) throw new HubFileError('IO_ERROR');
      return added;
    })
  );

  options.ipcMain.handle(LIBRARY_CHANNELS.repick, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = entrySchema.safeParse(raw);
      if (!parsed.success) throw new HubFileError('INVALID_REQUEST');
      if (!(await options.service.get(parsed.data.entryId))) throw new HubFileError('NOT_FOUND');
      const picked = await options.pickFiles(event, false);
      const first = picked?.[0];
      if (!first) throw new HubFileError('CANCELLED');
      return options.service.repick(parsed.data.entryId, first);
    })
  );

  options.ipcMain.handle(LIBRARY_CHANNELS.remove, (event, raw: unknown) =>
    execute(event, async (): Promise<null> => {
      const parsed = entrySchema.safeParse(raw);
      if (!parsed.success) throw new HubFileError('INVALID_REQUEST');
      await options.service.remove(parsed.data.entryId);
      return null;
    })
  );

  return () => {
    for (const channel of Object.values(LIBRARY_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
