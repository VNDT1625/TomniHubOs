/**
 * App-wide concurrency gate for hook processes (design section 11.6 item 6): at most 8 hooks run at
 * once; extra hooks wait in a FIFO queue. Droppable hooks (Notification, SessionEnd) are discarded
 * instead of queued once the queue is longer than the cap.
 */

import type { HookEventName } from '@/common/integrations/hooks';
import type { HookLimiter, HookLimiterTicket } from './hookTypes';

/** Hooks allowed to run at the same time across the whole app. */
export const DEFAULT_MAX_CONCURRENT_HOOKS = 8;

/** Queue length above which droppable hooks are discarded. */
export const DEFAULT_MAX_QUEUED_DROPPABLE_HOOKS = 64;

/** Events whose hooks only observe and may be dropped under load. */
const DROPPABLE_EVENTS: ReadonlySet<HookEventName> = new Set<HookEventName>(['Notification', 'SessionEnd']);

/** True when the runner may discard this event's hook instead of queueing it. */
export const isDroppableEvent = (event: HookEventName): boolean => DROPPABLE_EVENTS.has(event);

export type HookLimiterOptions = {
  maxConcurrent?: number;
  /** Queue length above which `droppable` requests are refused. */
  maxQueuedDroppable?: number;
  /** Called when a droppable request is refused (for the audit log). */
  onDrop?: () => void;
};

type Waiter = {
  grant: (ticket: HookLimiterTicket) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

/** Creates a limiter. Non-droppable requests always wait; they are never lost. */
export const createHookLimiter = (options: HookLimiterOptions = {}): HookLimiter => {
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_HOOKS));
  const maxQueued = Math.max(0, Math.floor(options.maxQueuedDroppable ?? DEFAULT_MAX_QUEUED_DROPPABLE_HOOKS));
  const queue: Waiter[] = [];
  let running = 0;
  let peakRunning = 0;
  let dropped = 0;

  const pump = (): void => {
    while (running < maxConcurrent && queue.length > 0) {
      const next = queue.shift();
      if (next) start(next);
    }
  };

  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      running -= 1;
      pump();
    };
  };

  const start = (waiter: Waiter): void => {
    running += 1;
    peakRunning = Math.max(peakRunning, running);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.grant({ kind: 'acquired', release: makeRelease() });
  };

  return {
    acquire: ({ droppable, signal }) =>
      new Promise<HookLimiterTicket>((resolve) => {
        if (signal?.aborted) {
          resolve({ kind: 'aborted' });
          return;
        }
        if (running < maxConcurrent && queue.length === 0) {
          start({ grant: resolve });
          return;
        }
        if (droppable && queue.length > maxQueued) {
          dropped += 1;
          options.onDrop?.();
          resolve({ kind: 'dropped' });
          return;
        }
        const waiter: Waiter = { grant: resolve, signal };
        if (signal) {
          waiter.onAbort = () => {
            const index = queue.indexOf(waiter);
            if (index >= 0) queue.splice(index, 1);
            resolve({ kind: 'aborted' });
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }
        queue.push(waiter);
      }),
    stats: () => ({ running, queued: queue.length, peakRunning, dropped }),
  };
};

/** The limiter shared by every caller that does not inject its own. */
export const defaultHookLimiter: HookLimiter = createHookLimiter();
