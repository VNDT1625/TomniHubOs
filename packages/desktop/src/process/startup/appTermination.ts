/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';

type AppTerminationIntent = { kind: 'exit'; code: number } | { kind: 'restart' } | { kind: 'action'; run: () => void };

let intent: AppTerminationIntent | undefined;
let quitSignalled = false;
let completed = false;

const signalQuitOnce = (): void => {
  if (quitSignalled || completed) return;
  quitSignalled = true;
  app.quit();
};

/** Route a coded exit through the shared before-quit cleanup first. */
export const requestAppExit = (code: number): void => {
  if (intent?.kind !== 'action' && intent?.kind !== 'restart') {
    intent = { kind: 'exit', code };
  }
  signalQuitOnce();
};

/** Route relaunch through cleanup and deduplicate repeated restart requests. */
export const requestAppRestart = (): void => {
  if (intent?.kind !== 'action') intent = { kind: 'restart' };
  signalQuitOnce();
};

/** Defer an updater or other terminal action until shared cleanup completes. */
export const requestAppActionAfterCleanup = (run: () => void): void => {
  if (intent?.kind !== 'action') intent = { kind: 'action', run };
  signalQuitOnce();
};

/** Finalize the one pending termination intent. Must only be called by quit cleanup. */
export const completeAppTermination = (): void => {
  if (completed) return;
  completed = true;
  if (intent?.kind === 'action') {
    intent.run();
    return;
  }
  if (intent?.kind === 'restart') {
    app.relaunch();
    app.quit();
    return;
  }
  if (intent?.kind === 'exit') {
    app.exit(intent.code);
    return;
  }
  app.quit();
};

export const __resetAppTerminationForTests = (): void => {
  intent = undefined;
  quitSignalled = false;
  completed = false;
};
