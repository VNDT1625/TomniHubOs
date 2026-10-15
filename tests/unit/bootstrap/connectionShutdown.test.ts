/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_SHUTDOWN_TIMEOUT_MS, installQuitCleanup, runBounded } from '@/process/startup/quitCleanup';

type BeforeQuitEvent = { preventDefault: () => void };

const flushTimers = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('runBounded', () => {
  it('resolves quietly when the work finishes in time', async () => {
    const log = vi.fn();
    await runBounded('thing', async () => undefined, 1000, log);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs a failure and still resolves', async () => {
    const log = vi.fn();
    await expect(runBounded('thing', () => Promise.reject(new Error('boom')), 1000, log)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('[Tomny] thing failed during shutdown.', expect.any(Error));
  });

  it('stops waiting at the time limit and says so', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const pending = runBounded('thing', () => new Promise<void>(() => undefined), 500, log);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('[Tomny] thing did not stop within 500 ms; quitting anyway.');
  });
});

describe('quit cleanup and the connection platform', () => {
  it('disposes connections before the other cleanup steps, then quits once', async () => {
    const calls: string[] = [];
    let beforeQuit: ((event: BeforeQuitEvent) => void) | undefined;
    const quitApp = vi.fn(() => calls.push('quit'));
    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuit = handler;
      },
      quitApp,
      setIsQuitting: () => undefined,
      markExplicitQuit: () => undefined,
      destroyTray: () => undefined,
      disposeCronResumeListener: () => calls.push('cron'),
      disposeConnections: async () => {
        calls.push('connections');
      },
      shutdownModelGateway: async () => undefined,
      stopBackend: async () => {
        calls.push('backend');
      },
      destroyPetWindow: () => undefined,
      logInfo: () => undefined,
      logWarn: () => undefined,
      logError: () => undefined,
    });

    const preventDefault = vi.fn();
    beforeQuit?.({ preventDefault });
    await flushTimers();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['connections', 'cron', 'backend', 'quit']);
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('does not let a hung connection disposal hold the quit past its time limit', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let beforeQuit: ((event: BeforeQuitEvent) => void) | undefined;
    const quitApp = vi.fn(() => calls.push('quit'));
    const warnings: string[] = [];
    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuit = handler;
      },
      quitApp,
      setIsQuitting: () => undefined,
      markExplicitQuit: () => undefined,
      destroyTray: () => undefined,
      disposeCronResumeListener: () => calls.push('cron'),
      disposeConnections: () => {
        calls.push('connections');
        return new Promise<void>(() => undefined);
      },
      shutdownModelGateway: async () => undefined,
      stopBackend: async () => {
        calls.push('backend');
      },
      destroyPetWindow: () => undefined,
      logInfo: () => undefined,
      logWarn: (message) => warnings.push(message),
      logError: () => undefined,
    });

    beforeQuit?.({ preventDefault: () => undefined });
    await vi.advanceTimersByTimeAsync(CONNECTION_SHUTDOWN_TIMEOUT_MS + 100);

    expect(calls).toEqual(['connections', 'cron', 'backend', 'quit']);
    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([expect.stringContaining('connection platform did not stop')]);
  });
});
