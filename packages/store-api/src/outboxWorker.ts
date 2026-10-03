import type { Pool } from 'pg';
import { claimOutbox, completeOutboxRow, failOutboxRow, type DurableOutboxRow } from './outboxRepository.js';
export type OutboxHandler = (event: DurableOutboxRow) => Promise<void>;
export type OutboxWorker = Readonly<{ runOnce: () => Promise<number>; start: () => void; stop: () => void }>;
export const createOutboxWorker = (
  pool: Pool,
  handlers: Readonly<Record<string, OutboxHandler>>,
  workerId: string,
  intervalMs = 5_000
): OutboxWorker => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const runOnce = async (): Promise<number> => {
    if (stopped) return 0;
    const events = await claimOutbox(pool, workerId);
    for (const event of events) {
      try {
        const handler = handlers[event.topic];
        if (!handler) throw new Error('OUTBOX_HANDLER_NOT_FOUND');
        await handler(event);
        await completeOutboxRow(pool, event.outbox_id);
      } catch (error) {
        await failOutboxRow(pool, event.outbox_id, error instanceof Error ? error.message : 'OUTBOX_DELIVERY_FAILED');
      }
    }
    return events.length;
  };
  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runOnce().finally(schedule);
    }, intervalMs);
    timer.unref?.();
  };
  return {
    runOnce,
    start: () => {
      if (!stopped && !timer) {
        void runOnce().finally(schedule);
      }
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
};
