import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SESSION_MEMORY_CHANNELS } from '@/common/types/platform/sessionMemory';
import type { ISessionMemoryStore } from '@process/userUnderstanding/sessionMemoryStore';

const SESSION = z
  .object({
    sessionId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9._:-]+$/),
  })
  .strict();
const REMEMBER = SESSION.extend({
  text: z.string().trim().min(1).max(16000),
  kind: z.enum(['fact', 'decision', 'todo', 'snippet', 'note']).optional(),
  pinned: z.boolean().optional(),
}).strict();
const FORGET = SESSION.extend({
  itemId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_.:-]+$/),
}).strict();
type Audit = { conversationId: string; requestId: string; operation: string; status: string };
type Options = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  resolve: (conversationId: string) => Promise<{ memoryId: string; running: boolean } | undefined>;
  memory: ISessionMemoryStore;
  confirm: (event: IpcMainInvokeEvent, operation: 'remember' | 'clear' | 'forget') => Promise<boolean>;
  audit: (record: Audit) => Promise<void>;
};
/** Sender-bound human controls, independent of IDE. Store ids and secrets remain in Main. */
export const registerSessionMemoryBridge = (options: Options): (() => void) => {
  let active = true;
  const pending = new Set<string>();
  const safeText = (memoryId: string, text: string): string => {
    let value = text;
    for (const key of options.memory.listSecretKeys(memoryId)) {
      const secret = options.memory.getSecret(memoryId, key);
      if (secret) value = value.split(secret).join('[redacted]');
    }
    return value
      .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
      .replace(/\b(api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  };
  for (const [operation, channel] of Object.entries(SESSION_MEMORY_CHANNELS)) {
    options.ipcMain.handle(channel, async (event, raw: unknown) => {
      let locked: string | undefined;
      let receipt: Audit | undefined;
      try {
        if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
        const parsed = (operation === 'remember' ? REMEMBER : operation === 'forget' ? FORGET : SESSION).safeParse(raw);
        if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
        const { sessionId } = parsed.data;
        const identity = await options.resolve(sessionId);
        if (!identity) return { ok: false, error: 'NOT_FOUND' };
        if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
        if (operation === 'snapshot') {
          const snapshot = options.memory.snapshot(identity.memoryId);
          let remaining = 256000;
          const items = snapshot.items
            .slice(-500)
            .map((item) => {
              const text = safeText(identity.memoryId, item.text).slice(0, Math.min(16000, remaining));
              remaining -= text.length;
              return { ...item, text };
            })
            .filter((item) => item.text.length > 0);
          return {
            ok: true,
            data: {
              ...snapshot,
              sessionId,
              items,
              secretKeys: [],
              truncated:
                items.length < snapshot.items.length || snapshot.items.some((item) => item.text.length > 16000),
            },
          };
        }
        if (pending.has(sessionId) || pending.size >= 8) return { ok: false, error: 'BUSY' };
        pending.add(sessionId);
        locked = sessionId;
        if (operation === 'clear' && identity.running) return { ok: false, error: 'BUSY' };
        if (
          !(await options.confirm(
            event,
            operation === 'clear' ? 'clear' : operation === 'forget' ? 'forget' : 'remember'
          ))
        )
          return { ok: false, error: 'CANCELLED' };
        if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
        const current = await options.resolve(sessionId);
        if (!current || current.memoryId !== identity.memoryId) return { ok: false, error: 'NOT_FOUND' };
        if (operation === 'clear' && current.running) return { ok: false, error: 'BUSY' };
        receipt = { conversationId: sessionId, requestId: randomUUID(), operation, status: 'approved' };
        await options.audit(receipt);
        const admitted = await options.resolve(sessionId);
        if (!active || !options.verifySender(event) || !admitted || admitted.memoryId !== identity.memoryId) {
          await options.audit({ ...receipt, status: 'denied-before-mutation' });
          return { ok: false, error: 'DENIED' };
        }
        if (operation === 'clear' && admitted.running) {
          await options.audit({ ...receipt, status: 'busy-before-mutation' });
          return { ok: false, error: 'BUSY' };
        }
        if (operation === 'clear') {
          options.memory.clearSession(identity.memoryId);
          await options.audit({ ...receipt, status: 'completed' });
          if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
          return { ok: true, data: true };
        }
        if (operation === 'forget') {
          const removed = options.memory.forget(identity.memoryId, FORGET.parse(parsed.data).itemId);
          await options.audit({ ...receipt, status: 'completed' });
          if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
          return { ok: true, data: removed };
        }
        const request = REMEMBER.parse(parsed.data);
        const data = await options.memory.remember(identity.memoryId, {
          text: safeText(identity.memoryId, request.text),
          kind: request.kind,
          pinned: request.pinned,
        });
        await options.audit({ ...receipt, status: 'completed' });
        if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
        return {
          ok: true,
          data: { ...data, item: { ...data.item, text: safeText(identity.memoryId, data.item.text).slice(0, 16000) } },
        };
      } catch {
        if (receipt) await options.audit({ ...receipt, status: 'failed-or-partial' }).catch((): undefined => undefined);
        return { ok: false, error: 'IO_ERROR' };
      } finally {
        if (locked) pending.delete(locked);
      }
    });
  }
  return () => {
    active = false;
    for (const channel of Object.values(SESSION_MEMORY_CHANNELS)) options.ipcMain.removeHandler(channel);
  };
};
