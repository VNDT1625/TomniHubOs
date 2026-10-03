import { AccountSessionError } from './types';

export type SupabaseAccountConfiguration = Readonly<{
  /** Deployment-owned Supabase project origin; renderer input never selects it. */
  origin: string;
  anonKey: string;
  onlineValidationMaxAgeMs: number;
}>;

export type DesktopOidcConfiguration = Readonly<{
  issuer: string;
  clientId: string;
  scopes: readonly string[];
  /** OIDC callback is loopback only; general purpose app deep links are not accepted. */
  redirectUri: string;
  onlineValidationMaxAgeMs: number;
  offlineLocalGraceMs: number;
}>;

const MAX_URL_LENGTH = 2_048;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const parseHttpsUrl = (value: unknown, field: string): URL => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${field} is invalid.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${field} is invalid.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${field} must be an HTTPS URL without credentials.`);
  }
  return parsed;
};

const parseRedirectUri = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC redirect URI is invalid.');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC redirect URI is invalid.');
  }
  if (
    parsed.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search ||
    parsed.pathname !== '/oauth/callback' ||
    Number(parsed.port) < 1 ||
    Number(parsed.port) > 65_535
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC redirect URI must be a loopback callback.');
  }
  return parsed.toString();
};

const parsePositiveDuration = (value: unknown, field: string, max: number): number => {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${field} is invalid.`);
  }
  return value as number;
};

/**
 * Strict Main-only OIDC configuration. The renderer never chooses issuer,
 * client ID, callback, scope, or offline policy.
 */
export const parseDesktopOidcConfiguration = (value: unknown): DesktopOidcConfiguration => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC configuration is invalid.');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    'issuer',
    'clientId',
    'scopes',
    'redirectUri',
    'onlineValidationMaxAgeMs',
    'offlineLocalGraceMs',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC configuration contains unknown fields.');
  }
  const issuer = parseHttpsUrl(record.issuer, 'OIDC issuer');
  if (issuer.pathname !== '/' && !issuer.pathname.endsWith('/')) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC issuer must not include a document path.');
  }
  if (typeof record.clientId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/u.test(record.clientId)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC client ID is invalid.');
  }
  if (
    !Array.isArray(record.scopes) ||
    record.scopes.length === 0 ||
    record.scopes.length > 16 ||
    record.scopes.some((scope) => typeof scope !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/u.test(scope)) ||
    new Set(record.scopes).size !== record.scopes.length ||
    !record.scopes.includes('openid')
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC scopes are invalid.');
  }
  return {
    issuer: issuer.toString(),
    clientId: record.clientId,
    scopes: [...record.scopes].toSorted(),
    redirectUri: parseRedirectUri(record.redirectUri),
    onlineValidationMaxAgeMs: parsePositiveDuration(
      record.onlineValidationMaxAgeMs,
      'Online validation age',
      86_400_000
    ),
    offlineLocalGraceMs: parsePositiveDuration(record.offlineLocalGraceMs, 'Offline local grace', 604_800_000),
  };
};

/**
 * Reads deployment-owned desktop configuration. Returning `undefined` means
 * the build deliberately has no Account provider and must remain signed out.
 */
export const readDesktopOidcConfigurationFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>> = process.env
): DesktopOidcConfiguration | undefined => {
  const issuer = environment.TOMNI_OIDC_ISSUER;
  const clientId = environment.TOMNI_OIDC_CLIENT_ID;
  const redirectUri = environment.TOMNI_OIDC_REDIRECT_URI;
  if (issuer === undefined && clientId === undefined && redirectUri === undefined) return undefined;
  return parseDesktopOidcConfiguration({
    issuer,
    clientId,
    redirectUri,
    scopes: (environment.TOMNI_OIDC_SCOPES ?? 'openid profile offline_access').split(/\s+/u).filter(Boolean),
    onlineValidationMaxAgeMs: Number(environment.TOMNI_OIDC_ONLINE_VALIDATION_MAX_AGE_MS ?? '300000'),
    offlineLocalGraceMs: Number(environment.TOMNI_OIDC_OFFLINE_LOCAL_GRACE_MS ?? '86400000'),
  });
};

/** Reads the deployment-owned Supabase project identity for Main account validation. */
export const readSupabaseAccountConfigurationFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>> = process.env
): SupabaseAccountConfiguration | undefined => {
  const origin = environment.TOMNI_SUPABASE_URL ?? environment.VITE_SUPABASE_URL;
  const anonKey = environment.TOMNI_SUPABASE_ANON_KEY ?? environment.VITE_SUPABASE_ANON_KEY;
  if (origin === undefined && anonKey === undefined) return undefined;
  const parsed = parseHttpsUrl(origin, 'Supabase origin');
  if (parsed.pathname !== '/' || parsed.search || parsed.port) {
    throw new AccountSessionError(
      'ACCOUNT_SESSION_INVALID',
      'Supabase origin must not include a path, query, or port.'
    );
  }
  if (typeof anonKey !== 'string' || anonKey.length === 0 || anonKey.length > 8_192 || /\p{Cc}/u.test(anonKey)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Supabase anonymous key is invalid.');
  }
  return {
    origin: parsed.toString(),
    anonKey,
    onlineValidationMaxAgeMs: parsePositiveDuration(
      Number(environment.TOMNI_SUPABASE_ONLINE_VALIDATION_MAX_AGE_MS ?? '300000'),
      'Supabase online validation age',
      86_400_000
    ),
  };
};
