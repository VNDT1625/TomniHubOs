/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

type BeforeQuitEvent = {
  preventDefault: () => void;
};

type QuitCleanupDeps = {
  onBeforeQuit: (handler: (event: BeforeQuitEvent) => void) => void;
  quitApp: () => void;
  setIsQuitting: (value: boolean) => void;
  markExplicitQuit: () => void;
  destroyTray: () => void;
  disposeCronResumeListener: () => void;
  /** Stops the connection platform (web apps, services, extensions, download gate). Bounded and never fails the quit. */
  disposeConnections?: () => Promise<void>;
  shutdownModelGateway: () => Promise<void>;
  stopBackend: () => Promise<void>;
  destroyPetWindow: () => Promise<void> | void;
  logInfo: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string, error: unknown) => void;
  timeoutMs?: number;
};

const DEFAULT_QUIT_CLEANUP_TIMEOUT_MS = 10_000;
/** Time the connection platform gets to stop its processes; the whole cleanup stays within the quit timeout. */
export const CONNECTION_SHUTDOWN_TIMEOUT_MS = 6_000;

/**
 * Runs one shutdown step and waits at most `timeoutMs` for it. Never rejects: a failure or a timeout is logged and
 * the quit goes on, so one stuck part cannot keep the application open.
 */
export async function runBounded(
  name: string,
  work: () => Promise<void>,
  timeoutMs: number,
  log: (message: string, error?: unknown) => void
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const finished = Promise.resolve()
    .then(work)
    .then(
      (): 'done' => 'done',
      (error: unknown): 'done' => {
        log(`[Tomny] ${name} failed during shutdown.`, error);
        return 'done';
      }
    );
  const outcome = await Promise.race([finished, timeout]);
  clearTimeout(timer);
  if (outcome === 'timeout') log(`[Tomny] ${name} did not stop within ${timeoutMs} ms; quitting anyway.`);
}

async function runWithTimeout(
  work: Promise<void>,
  timeoutMs: number,
  logWarn: (message: string) => void
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      logWarn('[Tomny] Cleanup timed out after 10s, forcing quit');
      resolve();
    }, timeoutMs);
  });

  await Promise.race([work, timeout]);
  if (!timedOut && timeoutId) {
    clearTimeout(timeoutId);
  }
}

async function runQuitCleanup(deps: QuitCleanupDeps): Promise<void> {
  deps.logInfo('[Tomny] before-quit');
  deps.setIsQuitting(true);
  deps.markExplicitQuit();
  deps.destroyTray();

  const cleanup = async () => {
    if (deps.disposeConnections !== undefined) {
      await runBounded(
        'connection platform',
        deps.disposeConnections,
        CONNECTION_SHUTDOWN_TIMEOUT_MS,
        (message, error) => (error === undefined ? deps.logWarn(message) : deps.logError(message, error))
      );
    }

    deps.disposeCronResumeListener();

    await deps
      .shutdownModelGateway()
      .catch((err) => deps.logError('[App] Failed to stop model gateway or restore CLI configs:', err));

    await deps.stopBackend().catch((err) => deps.logError('[App] Failed to stop backend:', err));

    try {
      await deps.destroyPetWindow();
    } catch {
      /* pet not initialized */
    }
  };

  await runWithTimeout(cleanup(), deps.timeoutMs ?? DEFAULT_QUIT_CLEANUP_TIMEOUT_MS, deps.logWarn);
}

export function installQuitCleanup(deps: QuitCleanupDeps): void {
  let cleanupStarted = false;
  let cleanupCompleted = false;

  deps.onBeforeQuit((event) => {
    if (cleanupCompleted) {
      return;
    }

    event.preventDefault();
    if (cleanupStarted) {
      return;
    }

    cleanupStarted = true;
    void runQuitCleanup(deps).finally(() => {
      cleanupCompleted = true;
      deps.quitApp();
    });
  });
}
