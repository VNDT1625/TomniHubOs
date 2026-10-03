import type { AccountSessionService } from './accountSessionService';

const MAX_TIMEOUT_MS = 2_147_483_647;

export type AccountExecutionLease = Readonly<{
  /** Stable, unique Main-owned identifier used solely for lifecycle ownership. */
  name: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}>;

export type AccountExecutionTimer = Readonly<{
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}>;

export type AccountExecutionLifecycleOptions = Readonly<{
  accountSession: AccountSessionService;
  leases: readonly AccountExecutionLease[];
  now?: () => Date;
  timer?: AccountExecutionTimer;
}>;

export type AccountExecutionLifecycle = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  reconcile(): Promise<void>;
}>;

const defaultTimer: AccountExecutionTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const assertLeases = (leases: readonly AccountExecutionLease[]): void => {
  const names = new Set<string>();
  for (const lease of leases) {
    if (typeof lease.name !== 'string' || lease.name.length === 0 || names.has(lease.name)) {
      throw new Error('Account execution lease names must be non-empty and unique.');
    }
    names.add(lease.name);
  }
};

/**
 * Main-only lifecycle gate for background execution. A lease can run only when
 * the account session is currently online-validated; local grace never opens it.
 */
export const createAccountExecutionLifecycle = (
  options: AccountExecutionLifecycleOptions
): AccountExecutionLifecycle => {
  assertLeases(options.leases);
  const now = options.now ?? (() => new Date());
  const timer = options.timer ?? defaultTimer;
  const activeLeases = new Set<AccountExecutionLease>();
  let enabled = false;
  let deadlineTimer: unknown;
  let unsubscribe: (() => void) | undefined;
  let serial = Promise.resolve();

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const next = serial.then(operation, operation);
    serial = next.catch((): void => {});
    return next;
  };

  const clearDeadline = (): void => {
    if (deadlineTimer !== undefined) {
      timer.clear(deadlineTimer);
      deadlineTimer = undefined;
    }
  };

  const stopActiveLeases = (): Promise<void> => {
    const leases = [...activeLeases];
    const stopAt = (index: number, firstError?: unknown): Promise<void> => {
      if (index < 0) return firstError === undefined ? Promise.resolve() : Promise.reject(firstError);
      const lease = leases[index];
      if (lease === undefined) return stopAt(index - 1, firstError);
      return Promise.resolve(lease.stop()).then(
        () => {
          activeLeases.delete(lease);
          return stopAt(index - 1, firstError);
        },
        (error: unknown) => stopAt(index - 1, firstError ?? error)
      );
    };
    return stopAt(leases.length - 1);
  };

  const startLeases = (): Promise<void> => {
    const startAt = (index: number): Promise<void> => {
      const lease = options.leases[index];
      if (lease === undefined) return Promise.resolve();
      if (activeLeases.has(lease)) return startAt(index + 1);
      return Promise.resolve(lease.start()).then(() => {
        activeLeases.add(lease);
        return startAt(index + 1);
      });
    };
    return startAt(0).catch((error: unknown) => stopActiveLeases().then(() => Promise.reject(error)));
  };

  const scheduleDeadline = (isoDeadline: string): void => {
    clearDeadline();
    const deadlineMs = Date.parse(isoDeadline);
    if (!Number.isFinite(deadlineMs)) return;
    const delayMs = Math.max(0, Math.min(MAX_TIMEOUT_MS, deadlineMs - now().getTime()));
    deadlineTimer = timer.set(() => {
      deadlineTimer = undefined;
      void reconcile().catch((): void => {});
    }, delayMs);
  };

  const reconcileNow = async (): Promise<void> => {
    if (!enabled) {
      clearDeadline();
      await stopActiveLeases();
      return;
    }

    let deadline: string | undefined;
    try {
      options.accountSession.requireOnlineSession();
      deadline = options.accountSession.onlineExecutionDeadline?.();
      if (deadline === undefined) throw new Error('Online execution deadline is unavailable.');
    } catch {
      clearDeadline();
      await stopActiveLeases();
      return;
    }

    await startLeases();
    scheduleDeadline(deadline);
  };

  const reconcile = (): Promise<void> => enqueue(reconcileNow);

  const start = async (): Promise<void> => {
    if (!enabled) {
      enabled = true;
      unsubscribe = options.accountSession.subscribe?.(() => {
        if (enabled) void reconcile().catch((): void => {});
      });
    }
    await reconcile();
  };

  const stop = async (): Promise<void> => {
    enabled = false;
    unsubscribe?.();
    unsubscribe = undefined;
    await reconcile();
  };

  return { start, stop, reconcile };
};
