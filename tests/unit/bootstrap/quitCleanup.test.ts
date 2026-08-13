/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installQuitCleanup } from '@/process/startup/quitCleanup';

const appMocks = vi.hoisted(() => ({
  exit: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('electron', () => ({ app: appMocks }));

import {
  __resetAppTerminationForTests,
  completeAppTermination,
  requestAppActionAfterCleanup,
  requestAppExit,
  requestAppRestart,
} from '@/process/startup/appTermination';

type BeforeQuitEvent = {
  preventDefault: () => void;
};

const flushMicrotasks = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  __resetAppTerminationForTests();
  appMocks.exit.mockReset();
  appMocks.quit.mockReset();
  appMocks.relaunch.mockReset();
});

describe('app termination coordination', () => {
  it('deduplicates restart requests and relaunches only after cleanup completes', () => {
    requestAppRestart();
    requestAppRestart();

    expect(appMocks.quit).toHaveBeenCalledOnce();
    expect(appMocks.relaunch).not.toHaveBeenCalled();

    completeAppTermination();
    completeAppTermination();

    expect(appMocks.relaunch).toHaveBeenCalledOnce();
    expect(appMocks.quit).toHaveBeenCalledTimes(2);
  });

  it('defers a coded app exit until cleanup completes', () => {
    requestAppExit(7);

    expect(appMocks.exit).not.toHaveBeenCalled();

    completeAppTermination();

    expect(appMocks.exit).toHaveBeenCalledWith(7);
  });

  it('runs an update-install action only after cleanup completes', () => {
    const install = vi.fn();
    requestAppActionAfterCleanup(install);

    expect(install).not.toHaveBeenCalled();

    completeAppTermination();

    expect(install).toHaveBeenCalledOnce();
  });
});

describe('installQuitCleanup', () => {
  it('prevents the first quit until cleanup finishes, then requests quit again', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    let resolveStopBackend: (() => void) | undefined;

    const quitApp = vi.fn(() => calls.push('quit-app'));
    const stopBackend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push('stop-backend-start');
          resolveStopBackend = resolve;
        })
    );

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp,
      setIsQuitting: (value) => calls.push(`set-quitting:${value}`),
      markExplicitQuit: () => calls.push('mark-explicit-quit'),
      destroyTray: () => calls.push('destroy-tray'),
      disposeCronResumeListener: () => calls.push('dispose-cron'),
      shutdownModelGateway: async () => calls.push('shutdown-model-gateway'),
      stopBackend,
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });
    await flushMicrotasks();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'dispose-cron',
      'shutdown-model-gateway',
      'stop-backend-start',
    ]);

    resolveStopBackend?.();
    await flushMicrotasks();

    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'dispose-cron',
      'shutdown-model-gateway',
      'stop-backend-start',
      'destroy-pet',
      'quit-app',
    ]);
  });

  it('continues backend cleanup when model gateway cleanup fails', async () => {
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    const stopBackend = vi.fn(async () => undefined);
    const logError = vi.fn();

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: vi.fn(),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      shutdownModelGateway: async () => {
        throw new Error('restore failed');
      },
      stopBackend,
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError,
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    expect(stopBackend).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      '[App] Failed to stop model gateway or restore CLI configs:',
      expect.any(Error)
    );
  });

  it('allows the second before-quit after cleanup has completed', async () => {
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp: vi.fn(),
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      shutdownModelGateway: async () => {},
      stopBackend: async () => {},
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await flushMicrotasks();

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
