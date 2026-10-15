/**
 * Main-side handler for the read-only skill viewer. The channel accepts only a skill name and an optional package id,
 * checks the sender before and after the read, and maps every failure to a stable code. The skill catalog decides
 * which files exist; the renderer never supplies a path.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import {
  SKILL_DOCUMENT_CHANNEL,
  type SkillDocumentData,
  type SkillDocumentErrorCode,
  type SkillDocumentResult,
} from '@/common/skills/skillDocument';

const REQUEST = z
  .object({
    name: z.string().trim().min(1).max(200),
    packageId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u)
      .optional(),
  })
  .strict();

/** Codes the catalog may throw. Any other error is reported as UNREADABLE so no internal message leaks. */
const CATALOG_CODES: ReadonlySet<string> = new Set(['NOT_FOUND', 'TOO_LARGE', 'UNREADABLE']);

export type SkillDocumentSource = {
  readDocument: (name: string, packageId?: string) => Promise<SkillDocumentData>;
};

const fail = (code: SkillDocumentErrorCode): SkillDocumentResult => ({ ok: false, code });

const codeOf = (error: unknown): SkillDocumentErrorCode => {
  const message = error instanceof Error ? error.message : '';
  return CATALOG_CODES.has(message) ? (message as SkillDocumentErrorCode) : 'UNREADABLE';
};

/** Registers the read channel. Returns a disposer that removes the handler. */
export const registerSkillDocumentBridge = (options: {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  skills: SkillDocumentSource;
}): (() => void) => {
  let active = true;
  const allowed = (event: IpcMainInvokeEvent): boolean => active && options.verifySender(event);
  options.ipcMain.handle(SKILL_DOCUMENT_CHANNEL, async (event, raw: unknown): Promise<SkillDocumentResult> => {
    if (!allowed(event)) return fail('DENIED');
    const parsed = REQUEST.safeParse(raw);
    if (!parsed.success) return fail('INVALID_REQUEST');
    try {
      const data = await options.skills.readDocument(parsed.data.name, parsed.data.packageId);
      // The sender is checked again after the await: a frame that changed while reading gets nothing.
      if (!allowed(event)) return fail('DENIED');
      return { ok: true, data };
    } catch (error) {
      return fail(codeOf(error));
    }
  });
  return () => {
    active = false;
    options.ipcMain.removeHandler(SKILL_DOCUMENT_CHANNEL);
  };
};
