import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;
const EXPIRY_SKEW_MS = 30_000;

export type ProviderOAuthDescriptor = Readonly<{
  providerId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: readonly string[];
  revokeEndpoint?: string;
  authorizationParameters?: Readonly<Record<string, string>>;
}>;

export type ProviderOAuthTokenSet = Readonly<{
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  accountId?: string;
}>;

export type ProviderOAuthVault = Readonly<{
  load(providerId: string): Promise<ProviderOAuthTokenSet | undefined>;
  save(tokens: ProviderOAuthTokenSet): Promise<void>;
  remove(providerId: string): Promise<void>;
}>;

export type ProviderOAuthCallback = Readonly<{ code: string; state: string }>;

export type ProviderOAuthTransport = Readonly<{
  openExternal(url: string): Promise<void>;
  waitForCallback(input: Readonly<{ redirectUri: string; state: string }>): Promise<ProviderOAuthCallback>;
  fetch?: typeof fetch;
  authorizeEgress?: (endpoint: string) => void;
  now?: () => number;
  random?: (bytes: number) => Buffer;
}>;

export type ProviderOAuthStatus = 'missing' | 'active' | 'expired' | 'revoked';

export type ProviderOAuthErrorCode =
  | 'PROVIDER_OAUTH_INVALID_DESCRIPTOR'
  | 'PROVIDER_OAUTH_CALLBACK_INVALID'
  | 'PROVIDER_OAUTH_TOKEN_INVALID'
  | 'PROVIDER_OAUTH_REAUTH_REQUIRED'
  | 'PROVIDER_OAUTH_NETWORK_FAILED';

export class ProviderOAuthError extends Error {
  public readonly code: ProviderOAuthErrorCode;

  public constructor(code: ProviderOAuthErrorCode, message: string = code, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderOAuthError';
    this.code = code;
  }
}

export type ProviderOAuthClient = Readonly<{
  beginAuthorization(): Promise<ProviderOAuthTokenSet>;
  getAccessToken(): Promise<string>;
  status(): Promise<ProviderOAuthStatus>;
  disconnect(): Promise<{ remoteRevoked: boolean }>;
}>;

const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/\p{Cc}/u.test(value);

const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

const base64url = (value: Buffer): string => value.toString('base64url');
const pkceChallenge = (verifier: string): string => base64url(createHash('sha256').update(verifier).digest());

const parseHttpsEndpoint = (value: unknown, label: string): string => {
  if (!bounded(value, 2_048)) throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR', `${label} is invalid.`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR', `${label} is invalid.`, { cause: error });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR', `${label} must be HTTPS without credentials.`);
  }
  return parsed.toString();
};

const validateDescriptor = (descriptor: ProviderOAuthDescriptor): ProviderOAuthDescriptor => {
  if (
    !descriptor ||
    !bounded(descriptor.providerId, 160) ||
    !bounded(descriptor.clientId, 512) ||
    !Array.isArray(descriptor.scopes)
  ) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR');
  }
  const authorizationEndpoint = parseHttpsEndpoint(descriptor.authorizationEndpoint, 'Authorization endpoint');
  const tokenEndpoint = parseHttpsEndpoint(descriptor.tokenEndpoint, 'Token endpoint');
  const revokeEndpoint =
    descriptor.revokeEndpoint === undefined
      ? undefined
      : parseHttpsEndpoint(descriptor.revokeEndpoint, 'Revocation endpoint');
  if (!bounded(descriptor.redirectUri, 2_048) || descriptor.scopes.length === 0 || descriptor.scopes.length > 32) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR');
  }
  let redirect: URL;
  try {
    redirect = new URL(descriptor.redirectUri);
  } catch (error) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR', 'Redirect URI is invalid.', { cause: error });
  }
  if (
    redirect.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(redirect.hostname) ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    !Number.isInteger(Number(redirect.port)) ||
    Number(redirect.port) < 1 ||
    Number(redirect.port) > 65_535 ||
    descriptor.scopes.some((scope) => !/^[A-Za-z0-9._:/-]{1,200}$/u.test(scope))
  ) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_INVALID_DESCRIPTOR');
  }
  return {
    ...descriptor,
    authorizationEndpoint,
    tokenEndpoint,
    ...(revokeEndpoint === undefined ? {} : { revokeEndpoint }),
    scopes: [...new Set(descriptor.scopes)],
  };
};

const readResponse = async (response: Response, label: string): Promise<Record<string, unknown>> => {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID', `${label} response exceeds its size limit.`);
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID', `${label} response is invalid.`, { cause: error });
  }
};

const responseError = async (response: Response, label: string): Promise<ProviderOAuthError> => {
  let body: Record<string, unknown> = {};
  try {
    body = await readResponse(response, label);
  } catch {
    return new ProviderOAuthError('PROVIDER_OAUTH_NETWORK_FAILED', `${label} request failed.`);
  }
  if (body.error === 'invalid_grant') {
    return new ProviderOAuthError('PROVIDER_OAUTH_REAUTH_REQUIRED', 'Provider authorization is no longer valid.');
  }
  return new ProviderOAuthError('PROVIDER_OAUTH_NETWORK_FAILED', `${label} request failed.`);
};

const parseTokenSet = (
  descriptor: ProviderOAuthDescriptor,
  body: Record<string, unknown>,
  now: number,
  previousRefreshToken?: string
): ProviderOAuthTokenSet => {
  const accessToken = body.access_token;
  const expiresIn = body.expires_in;
  if (
    !bounded(accessToken, MAX_TOKEN_BYTES) ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID', 'Provider token response is invalid.');
  }
  const accessTokenValue: string = accessToken;
  const refreshTokenValue = body.refresh_token;
  if (refreshTokenValue !== undefined && !bounded(refreshTokenValue, MAX_TOKEN_BYTES)) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID', 'Provider refresh token is invalid.');
  }
  const scope = body.scope === undefined ? descriptor.scopes.join(' ') : body.scope;
  if (!bounded(scope, 2_048))
    throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID', 'Provider token scope is invalid.');
  const scopeValue: string = scope;
  const accountIdValue = body.account_id;
  if (accountIdValue !== undefined && !bounded(accountIdValue, 512)) {
    throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID', 'Provider account identifier is invalid.');
  }
  const accountId: string | undefined = typeof accountIdValue === 'string' ? accountIdValue : undefined;
  const refreshToken: string | undefined =
    typeof refreshTokenValue === 'string' ? refreshTokenValue : previousRefreshToken;
  return {
    providerId: descriptor.providerId,
    accessToken: accessTokenValue,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    expiresAt: now + Math.floor(expiresIn * 1_000),
    scope: scopeValue,
    ...(accountId === undefined ? {} : { accountId }),
  };
};

const formRequest = (body: URLSearchParams): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  body: body.toString(),
  redirect: 'error',
});

/** Main-only OAuth client for a provider with an independently verified contract. */
export const createProviderOAuthClient = (
  descriptorInput: ProviderOAuthDescriptor,
  vault: ProviderOAuthVault,
  transport: ProviderOAuthTransport
): ProviderOAuthClient => {
  const descriptor = validateDescriptor(descriptorInput);
  const request = transport.fetch ?? fetch;
  const now = transport.now ?? Date.now;
  const random = transport.random ?? randomBytes;
  let refreshInFlight: Promise<ProviderOAuthTokenSet> | undefined;
  let authorizationInFlight: Promise<ProviderOAuthTokenSet> | undefined;

  const authorizeEgress = (endpoint: string): void => transport.authorizeEgress?.(endpoint);
  const fetchProvider = async (endpoint: string, init?: RequestInit): Promise<Response> => {
    authorizeEgress(endpoint);
    try {
      return await request(endpoint, { ...init, redirect: 'error' });
    } catch (error) {
      throw new ProviderOAuthError('PROVIDER_OAUTH_NETWORK_FAILED', 'Provider OAuth request failed.', { cause: error });
    }
  };

  const exchange = async (code: string, verifier: string): Promise<ProviderOAuthTokenSet> => {
    const response = await fetchProvider(
      descriptor.tokenEndpoint,
      formRequest(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: descriptor.clientId,
          ...(descriptor.clientSecret === undefined ? {} : { client_secret: descriptor.clientSecret }),
          redirect_uri: descriptor.redirectUri,
          code_verifier: verifier,
        })
      )
    );
    if (!response.ok) throw await responseError(response, 'Authorization code');
    return parseTokenSet(descriptor, await readResponse(response, 'Authorization code'), now());
  };

  const refresh = async (current: ProviderOAuthTokenSet): Promise<ProviderOAuthTokenSet> => {
    if (!current.refreshToken) throw new ProviderOAuthError('PROVIDER_OAUTH_REAUTH_REQUIRED');
    const response = await fetchProvider(
      descriptor.tokenEndpoint,
      formRequest(
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
          client_id: descriptor.clientId,
          ...(descriptor.clientSecret === undefined ? {} : { client_secret: descriptor.clientSecret }),
        })
      )
    );
    if (!response.ok) {
      const error = await responseError(response, 'Refresh token');
      if (error.code === 'PROVIDER_OAUTH_REAUTH_REQUIRED') await vault.remove(descriptor.providerId);
      throw error;
    }
    const next = parseTokenSet(descriptor, await readResponse(response, 'Refresh token'), now(), current.refreshToken);
    await vault.save(next);
    return next;
  };

  const getLiveOrRefresh = async (): Promise<ProviderOAuthTokenSet> => {
    const current = await vault.load(descriptor.providerId);
    if (!current) throw new ProviderOAuthError('PROVIDER_OAUTH_REAUTH_REQUIRED');
    if (current.providerId !== descriptor.providerId || !bounded(current.accessToken, MAX_TOKEN_BYTES)) {
      await vault.remove(descriptor.providerId);
      throw new ProviderOAuthError('PROVIDER_OAUTH_TOKEN_INVALID');
    }
    if (current.expiresAt > now() + EXPIRY_SKEW_MS) return current;
    if (!refreshInFlight) {
      refreshInFlight = refresh(current).finally(() => {
        refreshInFlight = undefined;
      });
    }
    return refreshInFlight;
  };

  return {
    beginAuthorization: async () => {
      if (authorizationInFlight) return authorizationInFlight;
      authorizationInFlight = (async () => {
        const state = base64url(random(32));
        const verifier = base64url(random(48));
        const authorization = new URL(descriptor.authorizationEndpoint);
        authorization.searchParams.set('response_type', 'code');
        authorization.searchParams.set('client_id', descriptor.clientId);
        authorization.searchParams.set('redirect_uri', descriptor.redirectUri);
        authorization.searchParams.set('scope', descriptor.scopes.join(' '));
        authorization.searchParams.set('state', state);
        authorization.searchParams.set('code_challenge', pkceChallenge(verifier));
        authorization.searchParams.set('code_challenge_method', 'S256');
        for (const [key, value] of Object.entries(descriptor.authorizationParameters ?? {})) {
          authorization.searchParams.set(key, value);
        }
        authorizeEgress(authorization.toString());
        const callbackPromise = transport.waitForCallback({ redirectUri: descriptor.redirectUri, state });
        void callbackPromise.catch((): void => undefined);
        await transport.openExternal(authorization.toString());
        const callback = await callbackPromise;
        if (!bounded(callback.code, 4_096) || !safeEqual(callback.state, state)) {
          throw new ProviderOAuthError('PROVIDER_OAUTH_CALLBACK_INVALID');
        }
        const tokens = await exchange(callback.code, verifier);
        await vault.save(tokens);
        return tokens;
      })().finally(() => {
        authorizationInFlight = undefined;
      });
      return authorizationInFlight;
    },
    getAccessToken: async () => (await getLiveOrRefresh()).accessToken,
    status: async () => {
      const current = await vault.load(descriptor.providerId);
      if (!current) return 'missing';
      if (current.expiresAt > now()) return 'active';
      if (!current.refreshToken) return 'expired';
      try {
        await getLiveOrRefresh();
        return 'active';
      } catch (error) {
        if (error instanceof ProviderOAuthError && error.code === 'PROVIDER_OAUTH_REAUTH_REQUIRED') return 'revoked';
        return 'expired';
      }
    },
    disconnect: async () => {
      const current = await vault.load(descriptor.providerId);
      let remoteRevoked = false;
      try {
        if (descriptor.revokeEndpoint && current) {
          const token = current.refreshToken ?? current.accessToken;
          const response = await fetchProvider(
            descriptor.revokeEndpoint,
            formRequest(new URLSearchParams({ token, client_id: descriptor.clientId }))
          );
          remoteRevoked = response.ok || response.status === 400 || response.status === 401;
        }
      } catch (error) {
        if (!(error instanceof ProviderOAuthError)) throw error;
        remoteRevoked = false;
      } finally {
        await vault.remove(descriptor.providerId);
      }
      return { remoteRevoked };
    },
  };
};
