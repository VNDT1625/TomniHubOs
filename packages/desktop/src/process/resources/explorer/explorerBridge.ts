import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type { AttachmentQuickView } from '@/common/chat/attachmentQuickView';
import { z } from 'zod';
import {
  EXPLORER_CHANNELS,
  type ExplorerActionRequest,
  type ExplorerActionOutcome,
  type ExplorerListing,
  type ExplorerResult,
  type ExplorerSession,
} from '@/common/types/platform/explorer';
import { ExplorerServiceError } from './explorerService';

const boundedPath = z
  .string()
  .max(4096)
  .refine((value) => !/[\u0000-\u001f]/.test(value));
const sessionId = z.string().min(1).max(128);
const openSchema = z.object({ path: boundedPath.optional(), pick: z.boolean().optional() }).strict();
const listSchema = z.object({ sessionId, relativePath: boundedPath }).strict();
const closeSchema = z.object({ sessionId }).strict();
const quickViewSchema = z.object({ sessionId, relativePath: boundedPath }).strict();
const actionSchema = z
  .object({
    sessionId,
    operation: z.enum([
      'create-file',
      'create-directory',
      'rename',
      'copy',
      'move',
      'delete',
      'open',
      'reveal',
      'block',
      'unblock',
    ]),
    paths: z.array(boundedPath).min(1).max(100),
    destination: boundedPath.optional(),
    name: z.string().min(1).max(255).optional(),
    autoRename: z.boolean().optional(),
  })
  .strict();

export type ExplorerServicePort = {
  openSession(ownerId: number, root: string): Promise<ExplorerSession>;
  list(ownerId: number, sessionId: string, relativePath: string): Promise<ExplorerListing>;
  action(ownerId: number, request: ExplorerActionRequest): Promise<ExplorerActionOutcome>;
  close(ownerId: number, sessionId: string): void;
  quickView(ownerId: number, sessionId: string, relativePath: string): Promise<AttachmentQuickView>;
  closeOwner(ownerId: number): void;
};

export type ExplorerBridgeOptions = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  service: ExplorerServicePort;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Only Main can grant a directory, after a native picker or native consent. */
  chooseRoot: (event: IpcMainInvokeEvent, request: { path?: string; pick?: boolean }) => Promise<string | null>;
  admitRoot?: (root: string) => Promise<void>;
};

/** Dedicated channels retain Electron sender identity; generic providers cannot invoke this port. */
export const registerExplorerBridge = (options: ExplorerBridgeOptions): (() => void) => {
  const owners = new Map<
    number,
    {
      sender: WebContents;
      generation: number;
      onNavigation: (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => void;
      onDestroyed: () => void;
    }
  >();
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!options.verifySender(event)) throw new ExplorerServiceError('DENIED');
    const ownerId = event.sender.id;
    if (owners.has(ownerId)) return;
    const record = {
      sender: event.sender,
      generation: 0,
      onNavigation: (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean): void => {
        if (!isMainFrame) return;
        record.generation += 1;
        options.service.closeOwner(ownerId);
      },
      onDestroyed: (): void => {
        record.generation += 1;
        options.service.closeOwner(ownerId);
        owners.delete(ownerId);
      },
    };
    owners.set(ownerId, record);
    event.sender.on('did-start-navigation', record.onNavigation);
    event.sender.once('destroyed', record.onDestroyed);
  };
  const execute = async <T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<ExplorerResult<T>> => {
    try {
      assertSender(event);
      return { ok: true, data: await operation() };
    } catch (error) {
      if (error instanceof ExplorerServiceError) {
        return {
          ok: false,
          code: error.code,
          ...(error.receiptId ? { receiptId: error.receiptId } : {}),
          ...(error.affectedPaths ? { affectedPaths: error.affectedPaths } : {}),
          ...(error.mayHaveCommitted ? { mayHaveCommitted: true } : {}),
          ...(error.suggestedName ? { suggestedName: error.suggestedName } : {}),
        };
      }
      return { ok: false, code: 'IO_ERROR' };
    }
  };
  options.ipcMain.handle(EXPLORER_CHANNELS.open, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = openSchema.safeParse(raw);
      if (!parsed.success) throw new ExplorerServiceError('INVALID_REQUEST');
      const generation = owners.get(event.sender.id)?.generation;
      const root = await options.chooseRoot(event, parsed.data);
      if (!root) throw new ExplorerServiceError('CANCELLED');
      assertSender(event);
      if (owners.get(event.sender.id)?.generation !== generation) throw new ExplorerServiceError('DENIED');
      await options.admitRoot?.(root);
      assertSender(event);
      if (owners.get(event.sender.id)?.generation !== generation) throw new ExplorerServiceError('DENIED');
      const session = await options.service.openSession(event.sender.id, root);
      try {
        if (owners.get(event.sender.id)?.generation !== generation) throw new ExplorerServiceError('DENIED');
        const listing = await options.service.list(event.sender.id, session.id, '');
        return { session, listing };
      } catch (error) {
        options.service.close(event.sender.id, session.id);
        throw error;
      }
    })
  );
  options.ipcMain.handle(EXPLORER_CHANNELS.list, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = listSchema.safeParse(raw);
      if (!parsed.success) throw new ExplorerServiceError('INVALID_REQUEST');
      return options.service.list(event.sender.id, parsed.data.sessionId, parsed.data.relativePath);
    })
  );
  options.ipcMain.handle(EXPLORER_CHANNELS.action, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = actionSchema.safeParse(raw);
      if (!parsed.success) throw new ExplorerServiceError('INVALID_REQUEST');
      const { sessionId: id, operation, paths, destination, name, autoRename } = parsed.data;
      return options.service.action(event.sender.id, {
        sessionId: id!,
        operation: operation!,
        paths: paths!,
        ...(destination !== undefined ? { destination } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(autoRename !== undefined ? { autoRename } : {}),
      });
    })
  );
  options.ipcMain.handle(EXPLORER_CHANNELS.close, (event, raw: unknown) =>
    execute(event, async (): Promise<null> => {
      const parsed = closeSchema.safeParse(raw);
      if (!parsed.success) throw new ExplorerServiceError('INVALID_REQUEST');
      options.service.close(event.sender.id, parsed.data.sessionId);
      return null;
    })
  );
  options.ipcMain.handle(EXPLORER_CHANNELS.quickView, (event, raw: unknown) =>
    execute(event, async () => {
      const parsed = quickViewSchema.safeParse(raw);
      if (!parsed.success) throw new ExplorerServiceError('INVALID_REQUEST');
      return options.service.quickView(event.sender.id, parsed.data.sessionId, parsed.data.relativePath);
    })
  );
  return () => {
    for (const [ownerId, record] of owners) {
      options.service.closeOwner(ownerId);
      record.sender.removeListener('did-start-navigation', record.onNavigation);
      record.sender.removeListener('destroyed', record.onDestroyed);
    }
    owners.clear();
    for (const channel of Object.values(EXPLORER_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
