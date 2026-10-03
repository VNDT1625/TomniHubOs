/**
 * Account identity is established only in the Main process. Renderer callers
 * receive {@link AccountSessionSnapshot}; OAuth tokens never cross preload.
 */
export type AccountSessionSnapshot = Readonly<{
  phase: 'authenticated' | 'unauthenticated';
  accountId?: string;
  displayName?: string;
  expiresAt?: string;
  verifiedAt?: string;
  offlineLocalOnly?: boolean;
}>;

/** Complete encrypted-at-rest session record; Main-process only. */
export type AuthenticatedAccountSession = Readonly<{
  schemaVersion: 1;
  accountId: string;
  subjectId: string;
  issuer: string;
  clientId: string;
  displayName?: string;
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: string;
  verifiedAt: string;
  /** A previously online-verified session may only use non-egress local work until this time. */
  offlineLocalOnlyUntil?: string;
}>;

export type AccountSessionErrorCode =
  | 'ACCOUNT_SESSION_INVALID'
  | 'ACCOUNT_SESSION_PROTECTED_STORAGE_UNAVAILABLE'
  | 'ACCOUNT_SESSION_STORAGE_UNAVAILABLE'
  | 'ACCOUNT_SESSION_STORAGE_CORRUPT'
  | 'ACCOUNT_SESSION_UNAUTHENTICATED'
  | 'ACCOUNT_SESSION_ONLINE_REQUIRED';

/**
 * Secret-free state change emitted by the Main-owned account authority. The
 * execution deadline is present only while online validation is usable.
 */
export type AccountSessionChange = Readonly<{
  reason: 'recorded' | 'restored' | 'signed_out' | 'invalidated';
  snapshot: AccountSessionSnapshot;
  onlineExecutionDeadline?: string;
}>;

/** Stable, secret-free error surface for account persistence. */
export class AccountSessionError extends Error {
  public constructor(
    public readonly code: AccountSessionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AccountSessionError';
  }
}

const validDate = (value: string | undefined): boolean =>
  value === undefined || (typeof value === 'string' && Number.isFinite(Date.parse(value)));

const nonEmpty = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/\p{Cc}/u.test(value);

/** Converts an encrypted Main-only record to the only session state a renderer may observe. */
export const toAccountSessionSnapshot = (
  session: AuthenticatedAccountSession | undefined,
  nowMs: number = Date.now()
): AccountSessionSnapshot =>
  session === undefined
    ? { phase: 'unauthenticated' }
    : {
        phase: 'authenticated',
        accountId: session.accountId,
        ...(session.displayName === undefined ? {} : { displayName: session.displayName }),
        expiresAt: session.expiresAt,
        verifiedAt: session.verifiedAt,
        ...(session.offlineLocalOnlyUntil === undefined
          ? {}
          : { offlineLocalOnly: Date.parse(session.offlineLocalOnlyUntil) > nowMs }),
      };

/** Rejects malformed records before they are persisted or trusted after decryption. */
export const assertAuthenticatedAccountSession: (value: unknown) => asserts value is AuthenticatedAccountSession = (
  value
) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Account session is invalid.');
  }

  const record = value as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion',
    'accountId',
    'subjectId',
    'issuer',
    'clientId',
    'displayName',
    'accessToken',
    'refreshToken',
    'idToken',
    'expiresAt',
    'verifiedAt',
    'offlineLocalOnlyUntil',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Account session contains unknown fields.');
  }
  if (
    record.schemaVersion !== 1 ||
    !nonEmpty(record.accountId) ||
    !nonEmpty(record.subjectId) ||
    !nonEmpty(record.issuer, 2_048) ||
    !nonEmpty(record.clientId) ||
    !nonEmpty(record.accessToken, 32_768) ||
    !nonEmpty(record.idToken, 32_768) ||
    (record.refreshToken !== undefined && !nonEmpty(record.refreshToken, 32_768)) ||
    (record.displayName !== undefined && !nonEmpty(record.displayName)) ||
    !validDate(record.expiresAt as string | undefined) ||
    !validDate(record.verifiedAt as string | undefined) ||
    !validDate(record.offlineLocalOnlyUntil as string | undefined)
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Account session fields are invalid.');
  }
};
