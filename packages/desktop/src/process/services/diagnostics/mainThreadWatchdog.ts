/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-thread watchdog (diagnostics only). A worker thread expects a heartbeat from the Electron main thread every
 * 250 ms. When the last heartbeat is more than 2 s old, the worker attaches to the main thread's inspector, pauses it,
 * logs the top call frames with the block time, then resumes it. Each blocked stretch is reported once. Event-loop lag
 * above 500 ms is logged with the last breadcrumb (the tool, hook or permission step that ran most recently).
 *
 * Enabled in development, or with TOMNY_WATCHDOG=1 (TOMNY_WATCHDOG=0 disables it). Overhead is one message per 250 ms.
 * Limitation: a main thread blocked inside a native synchronous call can only be paused when that call returns, so the
 * report then names the JavaScript frames around it. The watchdog never throws and never blocks the caller.
 * Process boundary: Main-process module, no DOM APIs.
 */

import { Worker } from 'node:worker_threads';

export const WATCHDOG_HEARTBEAT_MS = 250;
export const WATCHDOG_BLOCK_MS = 2_000;
export const WATCHDOG_LAG_LOG_MS = 500;
const MAX_FRAMES = 15;
const MAX_BREADCRUMB_CHARS = 120;

/** One paused call frame, already mapped to 1-based line and column. */
export type WatchdogFrame = Readonly<{ functionName: string; url: string; line: number; column: number }>;

export type MainThreadWatchdog = Readonly<{ stop: () => void }>;

let breadcrumb = 'none';

/** Records what the main thread is doing now (a tool name, hook event or permission step). Cheap; never throws. */
export const setWatchdogBreadcrumb = (label: string): void => {
  breadcrumb = label.slice(0, MAX_BREADCRUMB_CHARS);
};

export const currentWatchdogBreadcrumb = (): string => breadcrumb;

/** Log lines for paused frames: at most {@link MAX_FRAMES}, one line each. */
export const formatFrames = (frames: readonly WatchdogFrame[], max: number = MAX_FRAMES): string[] =>
  frames
    .slice(0, Math.max(0, max))
    .map(
      (frame) => `  at ${frame.functionName || '(anonymous)'} (${frame.url || 'native'}:${frame.line}:${frame.column})`
    );

/** True when the last heartbeat is older than the block threshold. */
export const isBlocked = (lastBeatAt: number, now: number, blockMs: number = WATCHDOG_BLOCK_MS): boolean =>
  now - lastBeatAt > blockMs;

/** Milliseconds a timer ran late beyond its expected interval. Never negative. */
export const lagOf = (lastTickAt: number, now: number, expectedMs: number = WATCHDOG_HEARTBEAT_MS): number =>
  Math.max(0, now - lastTickAt - expectedMs);

/** Enabled in development by default; TOMNY_WATCHDOG=1 forces it on and TOMNY_WATCHDOG=0 forces it off. */
export const shouldEnableWatchdog = (env: NodeJS.ProcessEnv, isPackaged: boolean): boolean => {
  if (env.TOMNY_WATCHDOG === '0') return false;
  return env.TOMNY_WATCHDOG === '1' || !isPackaged;
};

/**
 * Worker body, run from a string so no separate bundle file is needed. It must stay self-contained (no outer
 * references). Messages in: {type:'beat', at, breadcrumb}. Messages out: {type:'blocked', ...} or {type:'unavailable'}.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const inspector = require('node:inspector');
const { heartbeatMs, blockMs, maxFrames } = workerData;
let lastBeat = Date.now();
let lastBreadcrumb = 'none';
let reportedEpisode = -1;
let pausing = false;
let blockStartedAt = 0;
let session;
try {
  session = new inspector.Session();
  session.connectToMainThread();
} catch (error) {
  session = undefined;
  parentPort.postMessage({ type: 'unavailable', message: String((error && error.message) || error) });
}
parentPort.on('message', (message) => {
  if (message && message.type === 'beat' && typeof message.at === 'number') {
    lastBeat = message.at;
    lastBreadcrumb = typeof message.breadcrumb === 'string' ? message.breadcrumb : lastBreadcrumb;
  }
});
if (session) {
  session.on('Debugger.paused', (event) => {
    const raw = (event && event.params && event.params.callFrames) || [];
    const frames = raw.slice(0, maxFrames).map((frame) => ({
      functionName: frame.functionName || '',
      url: frame.url || '',
      line: ((frame.location && frame.location.lineNumber) || 0) + 1,
      column: ((frame.location && frame.location.columnNumber) || 0) + 1,
    }));
    session.post('Debugger.resume');
    session.post('Debugger.disable');
    parentPort.postMessage({ type: 'blocked', blockedMs: Date.now() - blockStartedAt, breadcrumb: lastBreadcrumb, frames });
    pausing = false;
  });
  setInterval(() => {
    // One pause per blocked stretch: the episode is the last heartbeat seen before the stall.
    if (pausing || reportedEpisode === lastBeat || Date.now() - lastBeat <= blockMs) return;
    reportedEpisode = lastBeat;
    pausing = true;
    blockStartedAt = lastBeat;
    session.post('Debugger.enable', () => session.post('Debugger.pause', (error) => { if (error) pausing = false; }));
  }, heartbeatMs);
}
`;

const NOOP: MainThreadWatchdog = { stop: () => undefined };

/**
 * Starts the watchdog when enabled. Returns a handle whose `stop` ends it. Failures are logged and swallowed, so
 * diagnostics can never stop the app from starting.
 */
export const startMainThreadWatchdog = (options: {
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}): MainThreadWatchdog => {
  const warn = options.warn ?? ((message: string): void => console.warn(message));
  try {
    if (!shouldEnableWatchdog(options.env ?? process.env, options.isPackaged)) return NOOP;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { heartbeatMs: WATCHDOG_HEARTBEAT_MS, blockMs: WATCHDOG_BLOCK_MS, maxFrames: MAX_FRAMES },
    });
    worker.unref();
    let lastTickAt = Date.now();
    const beat = setInterval(() => {
      const now = Date.now();
      const lag = lagOf(lastTickAt, now, WATCHDOG_HEARTBEAT_MS);
      lastTickAt = now;
      if (lag > WATCHDOG_LAG_LOG_MS) {
        warn(`[Watchdog] event loop lag ${lag}ms; last step: ${breadcrumb}`);
      }
      // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin -- Worker.postMessage has no origin.
      worker.postMessage({ type: 'beat', at: now, breadcrumb });
    }, WATCHDOG_HEARTBEAT_MS);
    beat.unref();
    worker.on('message', (message: unknown) => {
      try {
        const data = message as {
          type?: unknown;
          blockedMs?: unknown;
          breadcrumb?: unknown;
          frames?: unknown;
          message?: unknown;
        };
        if (data.type === 'blocked') {
          warn(`[Watchdog] main thread blocked ${String(data.blockedMs)}ms; last step: ${String(data.breadcrumb)}`);
          const frames = Array.isArray(data.frames) ? (data.frames as WatchdogFrame[]) : [];
          for (const line of formatFrames(frames)) warn(`[Watchdog] ${line.trimStart()}`);
        } else if (data.type === 'unavailable') {
          warn(`[Watchdog] inspector unavailable in worker; blocked-thread frames disabled: ${String(data.message)}`);
        }
      } catch {
        // Diagnostics only: a malformed message is dropped.
      }
    });
    worker.on('error', (error: Error) => warn(`[Watchdog] worker failed: ${error.message}`));
    return {
      stop: () => {
        clearInterval(beat);
        void worker.terminate().catch((): undefined => undefined);
      },
    };
  } catch (error) {
    warn(`[Watchdog] not started: ${error instanceof Error ? error.message : String(error)}`);
    return NOOP;
  }
};
