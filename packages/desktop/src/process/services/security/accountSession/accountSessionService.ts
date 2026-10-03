import {
  AccountSessionError,
  assertAuthenticatedAccountSession,
  toAccountSessionSnapshot,
  type AccountSessionChange,
  type AccountSessionSnapshot,
  type AuthenticatedAccountSession,
} from './types';
import type { AccountSessionVault } from './accountSessionVault';

export type OnlineSessionValidation = Readonly<{ status: 'valid' | 'revoked' }>;

/** Trusted Main-only adapter for the future OIDC refresh/introspection endpoint. */
export type OnlineSessionValidator = (
  session: AuthenticatedAccountSession,
  signal: AbortSignal
) => Promise<OnlineSessionValidation>;

export type AccountSessionServiceOptions = Readonly<{
  vault: AccountSessionVault;
  validateOnline: OnlineSessionValidator;
  now?: () => Date;
  /** Maximum age of a successful online validation before protected actions revalidate. */
  onlineValidationMaxAgeMs?: number;
}>;

export type AccountSessionService = Readonly<{
  restore(signal?: AbortSignal): Promise<AccountSessionSnapshot>;
  recordVerifiedSession(session: AuthenticatedAccountSession): Promise<AccountSessionSnapshot>;
  signOut(): Promise<void>;
  snapshot(): AccountSessionSnapshot;
  requireOnlineSession(): AuthenticatedAccountSession;
  /** Observe secret-free Main-process session changes. */
  subscribe?(listener: (change: AccountSessionChange) => void): () => void;
  /** Earliest exact timestamp at which online execution must be re-evaluated. */
  onlineExecutionDeadline?(): string | undefined;
}>;

const isFuture = (isoDate: string, now: Date): boolean => Date.parse(isoDate) > now.getTime();

const isOnlineValidationFresh = (verifiedAt: string, now: Date, maximumAgeMs: number | undefined): boolean => {
  if (maximumAgeMs === undefined) return true;
  const verifiedAtMs = Date.parse(verifiedAt);
  return Number.isFinite(verifiedAtMs) && verifiedAtMs <= now.getTime() && now.getTime() - verifiedAtMs < maximumAgeMs;
};

const onlineValidationDeadline = (verifiedAt: string, maximumAgeMs: number | undefined): number | undefined => {
  if (maximumAgeMs === undefined) return undefined;
  const verifiedAtMs = Date.parse(verifiedAt);
  return Number.isFinite(verifiedAtMs) ? verifiedAtMs + maximumAgeMs : undefined;
};

/** Legacy synthetic sessions are never eligible for restoration or online validation. */
const isLegacySyntheticSession = (session: AuthenticatedAccountSession): boolean =>
  session.issuer === 'tomny://local-account' ||
  session.clientId === 'tomny-desktop-local' ||
  /^(?:local|sovereign-local)-/.test(session.accountId) ||
  /^(?:local|sovereign-local)-/.test(session.subjectId);

/**
 * Main-owned account authority. A saved session does not become trusted merely
 * by loading it: it must be online-validated, except for its strictly local
 * grace mode. Callers may never provide an account ID to this service.
 */
export const createAccountSessionService = (options: AccountSessionServiceOptions): AccountSessionService => {
  const now = options.now ?? (() => new Date());
  if (
    options.onlineValidationMaxAgeMs !== undefined &&
    (!Number.isSafeInteger(options.onlineValidationMaxAgeMs) || options.onlineValidationMaxAgeMs <= 0)
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Online validation maximum age is invalid.');
  }
  let current: AuthenticatedAccountSession | undefined;
  let onlineValidated = false;
  const listeners = new Set<(change: AccountSessionChange) => void>();

  const snapshot = (): AccountSessionSnapshot => {
    const base = toAccountSessionSnapshot(current, now().getTime());
    if (base.phase === 'unauthenticated') return base;
    return onlineValidated ? { ...base, offlineLocalOnly: false } : base;
  };

  const onlineExecutionDeadline = (): string | undefined => {
    if (current === undefined || !onlineValidated) return undefined;
    const clock = now();
    const expiresAtMs = Date.parse(current.expiresAt);
    const validationDeadlineMs = onlineValidationDeadline(current.verifiedAt, options.onlineValidationMaxAgeMs);
    const deadlineMs = validationDeadlineMs === undefined ? expiresAtMs : Math.min(expiresAtMs, validationDeadlineMs);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= clock.getTime()) return undefined;
    return new Date(deadlineMs).toISOString();
  };

  const notify = (reason: AccountSessionChange['reason']): void => {
    const deadline = onlineExecutionDeadline();
    const change: AccountSessionChange = {
      reason,
      snapshot: snapshot(),
      ...(deadline === undefined ? {} : { onlineExecutionDeadline: deadline }),
    };
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        // An observer must never alter Main-owned authentication state.
      }
    }
  };

  const invalidateCurrent = (): void => {
    current = undefined;
    onlineValidated = false;
    notify('invalidated');
  };

  const clearInvalidPersistedSession = async (): Promise<void> => {
    invalidateCurrent();
    await options.vault.clear();
  };

  const signOut = async (): Promise<void> => {
    current = undefined;
    onlineValidated = false;
    notify('signed_out');
    await options.vault.clear();
  };

  const recordVerifiedSession = async (
    session: AuthenticatedAccountSession,
    reason: 'recorded' | 'restored' = 'recorded'
  ): Promise<AccountSessionSnapshot> => {
    assertAuthenticatedAccountSession(session);
    const clock = now();
    if (!isFuture(session.expiresAt, clock)) {
      throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Verified account session is expired.');
    }
    const persisted: AuthenticatedAccountSession = {
      ...session,
      verifiedAt: clock.toISOString(),
      ...(session.offlineLocalOnlyUntil === undefined ? {} : { offlineLocalOnlyUntil: session.offlineLocalOnlyUntil }),
    };
    await options.vault.save(persisted);
    current = persisted;
    onlineValidated = true;
    notify(reason);
    return snapshot();
  };

  const restore = async (signal?: AbortSignal): Promise<AccountSessionSnapshot> => {
    current = await options.vault.load();
    onlineValidated = false;
    if (current === undefined) {
      notify('restored');
      return snapshot();
    }
    if (isLegacySyntheticSession(current)) {
      await clearInvalidPersistedSession();
      return snapshot();
    }
    const clock = now();
    if (!isFuture(current.expiresAt, clock)) {
      await clearInvalidPersistedSession();
      return snapshot();
    }
    try {
      const result = await options.validateOnline(current, signal ?? new AbortController().signal);
      if (result.status === 'revoked') {
        await clearInvalidPersistedSession();
        return snapshot();
      }
      return recordVerifiedSession(current, 'restored');
    } catch (error) {
      if (signal?.aborted) throw error;
      if (current.offlineLocalOnlyUntil !== undefined && isFuture(current.offlineLocalOnlyUntil, clock)) {
        notify('restored');
        return snapshot();
      }
      current = undefined;
      notify('invalidated');
      return snapshot();
    }
  };

  const requireOnlineSession = (): AuthenticatedAccountSession => {
    if (current === undefined) {
      throw new AccountSessionError('ACCOUNT_SESSION_UNAUTHENTICATED', 'A verified account session is required.');
    }
    const clock = now();
    if (!isFuture(current.expiresAt, clock)) {
      invalidateCurrent();
      throw new AccountSessionError('ACCOUNT_SESSION_UNAUTHENTICATED', 'The verified account session has expired.');
    }
    if (!onlineValidated) {
      throw new AccountSessionError('ACCOUNT_SESSION_ONLINE_REQUIRED', 'Online account validation is required.');
    }
    if (!isOnlineValidationFresh(current.verifiedAt, clock, options.onlineValidationMaxAgeMs)) {
      onlineValidated = false;
      notify('invalidated');
      throw new AccountSessionError('ACCOUNT_SESSION_ONLINE_REQUIRED', 'Online account validation has expired.');
    }
    return current;
  };

  const subscribe = (listener: (change: AccountSessionChange) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    restore,
    recordVerifiedSession,
    signOut,
    snapshot,
    requireOnlineSession,
    subscribe,
    onlineExecutionDeadline,
  };
};
