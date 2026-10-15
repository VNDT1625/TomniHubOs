/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  FILE_VIEWER_CHANNELS,
  type FileViewerRef,
  type HubFileErrorCode,
  type HubFileResult,
} from '@/common/integrations/library/libraryContracts';
import { canOpenExternally, extensionOf } from './fileKinds';
import { readViewerDocument } from './fileReader';
import { HubFileError, openRegularFile, toFileError } from './safeFile';
import type { ViewGrants } from './viewGrants';

const boundedId = z.string().min(1).max(128);
const boundedRelativePath = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => ![...value].some((character) => character.charCodeAt(0) < 32));
const refSchema = z.union([
  z.object({ kind: z.literal('view'), id: boundedId }).strict(),
  z.object({ kind: z.literal('library'), id: boundedId }).strict(),
]);
const openFromExplorerSchema = z.object({ sessionId: boundedId, relativePath: boundedRelativePath }).strict();
const readSchema = z.object({ ref: refSchema }).strict();

export type FileViewerBridgeOptions = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  /** Only the trusted application window may call. */
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  grants: ViewGrants;
  /** Explorer resolves a session-relative path inside the root it granted (links refused). */
  resolveExplorerFile: (ownerId: number, sessionId: string, relativePath: string) => Promise<string>;
  /** Path of a Library entry, or undefined when there is no such entry. */
  resolveLibraryPath: (entryId: string) => Promise<string | undefined>;
  /** Operating-system hand-off; resolves with an error text, or empty on success (Electron `shell.openPath`). */
  openPath: (absolutePath: string) => Promise<string>;
};

const EXPLORER_PASS_THROUGH: ReadonlySet<string> = new Set<HubFileErrorCode>([
  'INVALID_REQUEST',
  'DENIED',
  'NOT_FOUND',
  'CANCELLED',
  'LIMIT_EXCEEDED',
]);

/** Explorer codes that have no viewer meaning (an expired session, a busy service) read as a refusal. */
const fromExplorerError = (error: unknown): HubFileError => {
  if (error instanceof HubFileError) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && EXPLORER_PASS_THROUGH.has(code)) return new HubFileError(code as HubFileErrorCode);
  if (code === 'SESSION_EXPIRED' || code === 'UNAVAILABLE') return new HubFileError('DENIED');
  return toFileError(error);
};

/** Dedicated, sender-bound channels. No handler accepts or returns a renderer-chosen path. */
export const registerFileViewerBridge = (options: FileViewerBridgeOptions): (() => void) => {
  const execute = async <T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<HubFileResult<T>> => {
    try {
      if (!options.verifySender(event)) throw new HubFileError('DENIED');
      return { ok: true, data: await operation() };
    } catch (error) {
      return { ok: false, code: toFileError(error).code };
    }
  };

  const resolveRef = async (ref: FileViewerRef): Promise<string> => {
    const target = ref.kind === 'view' ? options.grants.resolve(ref.id) : await options.resolveLibraryPath(ref.id);
    if (!target) throw new HubFileError('NOT_FOUND');
    return target;
  };

  options.ipcMain.handle(FILE_VIEWER_CHANNELS.openFromExplorer, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = openFromExplorerSchema.safeParse(raw);
      if (!parsed.success) throw new HubFileError('INVALID_REQUEST');
      const absolute = await options
        .resolveExplorerFile(event.sender.id, parsed.data.sessionId, parsed.data.relativePath)
        .catch((error: unknown) => {
          throw fromExplorerError(error);
        });
      // Only a regular file is issued an id; a folder or a link never gets one.
      const file = await openRegularFile(absolute);
      await file.handle.close().catch((): undefined => undefined);
      return { viewId: options.grants.issue(file.path), name: file.name };
    })
  );

  options.ipcMain.handle(FILE_VIEWER_CHANNELS.read, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = readSchema.safeParse(raw);
      if (!parsed.success) throw new HubFileError('INVALID_REQUEST');
      return readViewerDocument(await resolveRef(parsed.data.ref as FileViewerRef));
    })
  );

  options.ipcMain.handle(FILE_VIEWER_CHANNELS.openExternal, (event, raw: unknown) =>
    execute(event, async (): Promise<null> => {
      const parsed = readSchema.safeParse(raw);
      if (!parsed.success) throw new HubFileError('INVALID_REQUEST');
      const file = await openRegularFile(await resolveRef(parsed.data.ref as FileViewerRef));
      await file.handle.close().catch((): undefined => undefined);
      // The operating system would run a script or program; only data types are handed off.
      if (!canOpenExternally(extensionOf(file.name))) throw new HubFileError('DENIED');
      if (await options.openPath(file.path)) throw new HubFileError('IO_ERROR');
      return null;
    })
  );

  return () => {
    for (const channel of Object.values(FILE_VIEWER_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
