import type { AccountSessionService } from './accountSessionService';
import { AccountSessionError, type AuthenticatedAccountSession } from './types';
import type { SupabaseAccountConfiguration } from './oidcConfiguration';
import { createSystemEgressAuthority, type SystemEgressAuthority } from '../systemEgressAuthority';

const MAX_TOKEN_LENGTH = 32_768;
const MAX_RESPONSE_BYTES = 128 * 1024;

export type SupabaseSessionAdmission = Readonly<{
  accessToken: string;
  refreshToken?: string;
}>;

type SupabaseSubject = Readonly<{ id: string; email?: string }>;

type SupabaseValidation = Readonly<{ status: 'valid'; subject: SupabaseSubject }> | Readonly<{ status: 'revoked' }>;

const parseBoundedJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user request failed.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user response exceeds its size limit.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user response is invalid.', { cause: error });
  }
};

const parseSubject = (value: unknown): SupabaseSubject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user response is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 512 || /\p{Cc}/u.test(record.id)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user subject is invalid.');
  }
  if (
    record.email !== undefined &&
    (typeof record.email !== 'string' || record.email.length > 512 || /\p{Cc}/u.test(record.email))
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user email is invalid.');
  }
  const email = typeof record.email === 'string' ? record.email : undefined;
  return email === undefined ? { id: record.id } : { id: record.id, email };
};

const expiryFromAccessToken = (accessToken: string, now: Date): string => {
  const parts = accessToken.split('.');
  if (parts.length !== 3) throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase access token is invalid.');
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp * 1_000 <= now.getTime()) {
      throw new Error('expired');
    }
    return new Date(claims.exp * 1_000).toISOString();
  } catch (error) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase access token is invalid or expired.', {
      cause: error,
    });
  }
};

const userEndpoint = (configuration: SupabaseAccountConfiguration): string =>
  new URL('auth/v1/user', configuration.origin).toString();

/**
 * Main owns the Supabase destination and validates every token before it enters
 * the encrypted account vault. The renderer cannot select an origin or account.
 */
export const createSupabaseSessionAdmission = (
  options: Readonly<{
    configuration: SupabaseAccountConfiguration;
    accountSession: AccountSessionService;
    fetch?: typeof fetch;
    egressAuthority?: SystemEgressAuthority;
    now?: () => Date;
  }>
): Readonly<{
  admit(session: SupabaseSessionAdmission): Promise<void>;
  validateOnline(session: AuthenticatedAccountSession, signal: AbortSignal): Promise<{ status: 'valid' | 'revoked' }>;
}> => {
  const request = options.fetch ?? fetch;
  const authority = options.egressAuthority ?? createSystemEgressAuthority();
  const now = options.now ?? (() => new Date());

  const validate = async (accessToken: string, signal: AbortSignal): Promise<SupabaseValidation> => {
    const endpoint = userEndpoint(options.configuration);
    const decision = authority.authorize({
      egressClass: 'oidc-auth',
      destination: endpoint,
      oidcIssuer: options.configuration.origin,
    });
    if (decision.decision !== 'allow') {
      throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `Supabase account egress denied: ${decision.code}.`);
    }
    const response = await request(endpoint, {
      headers: {
        apikey: options.configuration.anonKey,
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
      redirect: 'error',
      signal,
    });
    if (response.status === 401 || response.status === 403) return { status: 'revoked' };
    return { status: 'valid', subject: parseSubject(await parseBoundedJson(response)) };
  };

  return {
    validateOnline: async (session, signal) => {
      if (session.issuer !== options.configuration.origin) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase session issuer is invalid.');
      }
      const result = await validate(session.accessToken, signal);
      if (result.status === 'revoked') return result;
      if (result.subject.id !== session.subjectId) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase user subject does not match the session.');
      }
      return { status: 'valid' };
    },
    admit: async (session) => {
      if (
        typeof session.accessToken !== 'string' ||
        session.accessToken.length === 0 ||
        session.accessToken.length > MAX_TOKEN_LENGTH
      ) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase access token is invalid.');
      }
      if (
        session.refreshToken !== undefined &&
        (typeof session.refreshToken !== 'string' ||
          session.refreshToken.length === 0 ||
          session.refreshToken.length > MAX_TOKEN_LENGTH)
      ) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase refresh token is invalid.');
      }
      const verifiedAt = now();
      const result = await validate(session.accessToken, new AbortController().signal);
      if (result.status === 'revoked') {
        throw new AccountSessionError('ACCOUNT_SESSION_UNAUTHENTICATED', 'Supabase session is not valid.');
      }
      await options.accountSession.recordVerifiedSession({
        schemaVersion: 1,
        accountId: result.subject.id,
        subjectId: result.subject.id,
        issuer: options.configuration.origin,
        clientId: 'tomni-supabase',
        ...(result.subject.email === undefined ? {} : { displayName: result.subject.email }),
        accessToken: session.accessToken,
        ...(session.refreshToken === undefined ? {} : { refreshToken: session.refreshToken }),
        idToken: session.accessToken,
        expiresAt: expiryFromAccessToken(session.accessToken, verifiedAt),
        verifiedAt: verifiedAt.toISOString(),
      });
    },
  };
};
