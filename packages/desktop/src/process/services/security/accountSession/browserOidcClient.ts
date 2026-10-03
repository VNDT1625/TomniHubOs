import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { DesktopOidcConfiguration } from './oidcConfiguration';
import type { AccountSessionService } from './accountSessionService';
import { AccountSessionError, type AuthenticatedAccountSession } from './types';

import { createSystemEgressAuthority, type SystemEgressAuthority } from '../systemEgressAuthority';

const MAX_RESPONSE_BYTES = 128 * 1024;
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;

type OidcDiscovery = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
}>;

type Jwk = Readonly<{ kid?: string; kty?: string; use?: string; alg?: string; [key: string]: unknown }>;
type Jwks = Readonly<{ keys: readonly Jwk[] }>;
type IdTokenClaims = Readonly<{
  iss: string;
  sub: string;
  aud: string | readonly string[];
  exp: number;
  iat?: number;
  nonce?: string;
  name?: string;
  preferred_username?: string;
}>;

export type BrowserOidcClientOptions = Readonly<{
  configuration: DesktopOidcConfiguration;
  accountSession: AccountSessionService;

  /** Main-only system egress authority; no renderer may select a destination. */
  egressAuthority?: SystemEgressAuthority;
  openExternal(url: string): Promise<void>;
  fetch?: typeof fetch;
  now?: () => Date;
}>;

export type BrowserOidcClient = Readonly<{
  beginSignIn(): Promise<void>;
}>;

const base64Url = (value: Buffer): string => value.toString('base64url');
const randomValue = (bytes = 32): string => base64Url(randomBytes(bytes));
const pkceChallenge = (verifier: string): string => base64Url(createHash('sha256').update(verifier).digest());

const readBoundedJson = async <T>(response: Response, label: string): Promise<T> => {
  if (!response.ok) throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} request failed.`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} response exceeds its size limit.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} response is invalid.`, { cause: error });
  }
};

const exactKeys = (value: unknown, required: readonly string[]): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  required.every((key) => typeof (value as Record<string, unknown>)[key] === 'string');

const parseHttpsEndpoint = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} is invalid.`);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} is invalid.`);
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} must be HTTPS without credentials.`);
  }
  return endpoint.toString();
};

const parseDiscovery = (value: unknown, configuration: DesktopOidcConfiguration): OidcDiscovery => {
  if (!exactKeys(value, ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint'])) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC discovery document is invalid.');
  }
  const issuer = parseHttpsEndpoint(value.issuer, 'OIDC discovery issuer');
  if (issuer !== configuration.issuer) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC discovery issuer does not match configuration.');
  }
  return {
    issuer,
    authorization_endpoint: parseHttpsEndpoint(value.authorization_endpoint, 'OIDC authorization endpoint'),
    token_endpoint: parseHttpsEndpoint(value.token_endpoint, 'OIDC token endpoint'),
    jwks_uri: parseHttpsEndpoint(value.jwks_uri, 'OIDC JWKS endpoint'),
    userinfo_endpoint: parseHttpsEndpoint(value.userinfo_endpoint, 'OIDC user-info endpoint'),
  };
};

const decodeBase64UrlJson = (value: string, label: string): Record<string, unknown> => {
  if (!BASE64_URL.test(value) || value.length > MAX_RESPONSE_BYTES) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} is invalid.`);
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} is invalid.`, { cause: error });
  }
};

const parseIdTokenClaims = (value: Record<string, unknown>): IdTokenClaims => {
  const audience = value.aud;
  if (
    typeof value.iss !== 'string' ||
    typeof value.sub !== 'string' ||
    (typeof audience !== 'string' &&
      (!Array.isArray(audience) || audience.some((entry) => typeof entry !== 'string'))) ||
    typeof value.exp !== 'number' ||
    (value.iat !== undefined && typeof value.iat !== 'number') ||
    (value.nonce !== undefined && typeof value.nonce !== 'string') ||
    (value.name !== undefined && typeof value.name !== 'string') ||
    (value.preferred_username !== undefined && typeof value.preferred_username !== 'string')
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC ID token claims are invalid.');
  }
  return value as IdTokenClaims;
};

const verifyJwtSignature = (
  header: Record<string, unknown>,
  signingInput: string,
  signature: Buffer,
  keys: readonly Jwk[]
): void => {
  const algorithm = header.alg;
  const keyId = header.kid;
  if (typeof algorithm !== 'string' || typeof keyId !== 'string' || !['RS256', 'ES256', 'EdDSA'].includes(algorithm)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC ID token signature header is invalid.');
  }
  const key = keys.find(
    (candidate) => candidate.kid === keyId && (candidate.use === undefined || candidate.use === 'sig')
  );
  if (!key) throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC ID token signing key is unavailable.');
  let publicKey;
  try {
    publicKey = createPublicKey({ key, format: 'jwk' });
  } catch (error) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC signing key is invalid.', { cause: error });
  }
  const accepted =
    algorithm === 'RS256'
      ? verify('RSA-SHA256', Buffer.from(signingInput), publicKey, signature)
      : algorithm === 'ES256'
        ? verify('sha256', Buffer.from(signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
        : verify(null, Buffer.from(signingInput), publicKey, signature);
  if (!accepted) throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC ID token signature is invalid.');
};

/** Verifies the ID token against issuer, audience, nonce, expiry, and fetched JWKS. */
export const verifyOidcIdToken = (
  token: string,
  input: Readonly<{ issuer: string; clientId: string; nonce: string; jwks: Jwks; now: Date }>
): IdTokenClaims => {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !BASE64_URL.test(part))) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC ID token is invalid.');
  }
  const header = decodeBase64UrlJson(parts[0]!, 'OIDC ID token header');
  const claims = parseIdTokenClaims(decodeBase64UrlJson(parts[1]!, 'OIDC ID token claims'));
  verifyJwtSignature(header, `${parts[0]}.${parts[1]}`, Buffer.from(parts[2]!, 'base64url'), input.jwks.keys);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== input.issuer ||
    !audience.includes(input.clientId) ||
    claims.nonce !== input.nonce ||
    claims.exp * 1_000 <= input.now.getTime() ||
    claims.sub.length === 0 ||
    claims.sub.length > 512
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC ID token claims do not match the sign-in request.');
  }
  return claims;
};

export const buildOidcAuthorizationUrl = (
  input: Readonly<{
    discovery: OidcDiscovery;
    configuration: DesktopOidcConfiguration;
    state: string;
    nonce: string;
    verifier: string;
  }>
): string => {
  const authorization = new URL(input.discovery.authorization_endpoint);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('client_id', input.configuration.clientId);
  authorization.searchParams.set('redirect_uri', input.configuration.redirectUri);
  authorization.searchParams.set('scope', input.configuration.scopes.join(' '));
  authorization.searchParams.set('state', input.state);
  authorization.searchParams.set('nonce', input.nonce);
  authorization.searchParams.set('code_challenge', pkceChallenge(input.verifier));
  authorization.searchParams.set('code_challenge_method', 'S256');
  return authorization.toString();
};

const respond = (response: ServerResponse, status: number, body: string): void => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
};

type LoopbackCallbackWaiter = Readonly<{
  ready: Promise<void>;
  code: Promise<string>;
  cancel(): void;
}>;

const startCallbackWaiter = (
  configuration: DesktopOidcConfiguration,
  expectedState: string
): LoopbackCallbackWaiter => {
  const callback = new URL(configuration.redirectUri);
  const server = createServer();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  let settled = false;
  const close = (): void => {
    server.close();
  };
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectReady(error);
    rejectCode(error);
    close();
  };
  const timeout = setTimeout(
    () => fail(new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC callback timed out.')),
    FLOW_TIMEOUT_MS
  );
  timeout.unref?.();
  server.once('error', fail);
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    try {
      const requestUrl = new URL(request.url ?? '/', configuration.redirectUri);
      if (request.method !== 'GET' || requestUrl.pathname !== callback.pathname) {
        respond(response, 404, 'Not found');
        return;
      }
      const state = requestUrl.searchParams.get('state');
      const authorizationCode = requestUrl.searchParams.get('code');
      const error = requestUrl.searchParams.get('error');
      if (
        state !== expectedState ||
        error !== null ||
        authorizationCode === null ||
        authorizationCode.length === 0 ||
        authorizationCode.length > 4_096
      ) {
        respond(response, 400, 'Sign-in could not be verified. You may close this page.');
        fail(new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC callback is invalid.'));
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      respond(response, 200, 'Sign-in verified. You may return to TomniHubOS.');
      resolveCode(authorizationCode);
      close();
    } catch (error) {
      respond(response, 400, 'Sign-in could not be verified. You may close this page.');
      fail(error instanceof Error ? error : new Error('OIDC callback failure'));
    }
  });
  server.listen({ host: callback.hostname, port: Number(callback.port), exclusive: true }, () => {
    if (!settled) resolveReady();
  });
  void code.then(
    () => clearTimeout(timeout),
    () => clearTimeout(timeout)
  );
  return {
    ready,
    code,
    cancel: () => fail(new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC sign-in was cancelled.')),
  };
};

const discoveryUrl = (issuer: string): string => new URL('.well-known/openid-configuration', issuer).toString();

const requireOidcEgress = (
  authority: SystemEgressAuthority,
  configuration: DesktopOidcConfiguration,
  destination: string
): void => {
  const decision = authority.authorize({
    egressClass: 'oidc-auth',
    destination,
    oidcIssuer: configuration.issuer,
  });
  if (decision.decision !== 'allow') {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `OIDC egress denied: ${decision.code}.`);
  }
};

/** OIDC protocol fetches must never silently follow a destination-changing redirect. */
const fetchOidc = (request: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  request(input, { ...init, redirect: 'error' });

/**
 * Main-only browser OIDC flow. It owns state, nonce, verifier, callback, token
 * exchange and JWKS validation. No browser renderer sees any protocol secret.
 */
export const createBrowserOidcClient = (options: BrowserOidcClientOptions): BrowserOidcClient => {
  const request = options.fetch ?? fetch;

  const egressAuthority = options.egressAuthority ?? createSystemEgressAuthority();
  const now = options.now ?? (() => new Date());
  let active: Promise<void> | undefined;

  const beginSignIn = async (): Promise<void> => {
    if (active !== undefined) return active;
    active = (async () => {
      requireOidcEgress(egressAuthority, options.configuration, discoveryUrl(options.configuration.issuer));

      const discovery = parseDiscovery(
        await readBoundedJson<unknown>(
          await fetchOidc(request, discoveryUrl(options.configuration.issuer)),
          'OIDC discovery'
        ),
        options.configuration
      );
      const state = randomValue();
      const nonce = randomValue();
      const verifier = randomValue(48);
      const callback = startCallbackWaiter(options.configuration, state);
      let code: string;
      try {
        await callback.ready;
        const authorizationUrl = buildOidcAuthorizationUrl({
          discovery,
          configuration: options.configuration,
          state,
          nonce,
          verifier,
        });
        requireOidcEgress(egressAuthority, options.configuration, authorizationUrl);
        await options.openExternal(authorizationUrl);
        code = await callback.code;
      } catch (error) {
        callback.cancel();
        throw error;
      }
      const exchange = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: options.configuration.redirectUri,
        client_id: options.configuration.clientId,
        code_verifier: verifier,
      });
      requireOidcEgress(egressAuthority, options.configuration, discovery.token_endpoint);

      const tokens = await readBoundedJson<Record<string, unknown>>(
        await fetchOidc(request, discovery.token_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: exchange.toString(),
        }),
        'OIDC token'
      );
      if (
        typeof tokens.access_token !== 'string' ||
        typeof tokens.id_token !== 'string' ||
        typeof tokens.expires_in !== 'number'
      ) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC token response is invalid.');
      }
      requireOidcEgress(egressAuthority, options.configuration, discovery.jwks_uri);

      const jwks = await readBoundedJson<Jwks>(await fetchOidc(request, discovery.jwks_uri), 'OIDC JWKS');
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > 32) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC JWKS response is invalid.');
      }
      const verifiedAt = now();
      const claims = verifyOidcIdToken(tokens.id_token, {
        issuer: discovery.issuer,
        clientId: options.configuration.clientId,
        nonce,
        jwks,
        now: verifiedAt,
      });
      const expiresAt = new Date(
        Math.min(claims.exp * 1_000, verifiedAt.getTime() + tokens.expires_in * 1_000)
      ).toISOString();
      const session: AuthenticatedAccountSession = {
        schemaVersion: 1,
        accountId: claims.sub,
        subjectId: claims.sub,
        issuer: discovery.issuer,
        clientId: options.configuration.clientId,
        ...(typeof claims.name === 'string'
          ? { displayName: claims.name }
          : typeof claims.preferred_username === 'string'
            ? { displayName: claims.preferred_username }
            : {}),
        accessToken: tokens.access_token,
        ...(typeof tokens.refresh_token === 'string' ? { refreshToken: tokens.refresh_token } : {}),
        idToken: tokens.id_token,
        expiresAt,
        verifiedAt: verifiedAt.toISOString(),
        offlineLocalOnlyUntil: new Date(verifiedAt.getTime() + options.configuration.offlineLocalGraceMs).toISOString(),
      };
      await options.accountSession.recordVerifiedSession(session);
    })().finally(() => {
      active = undefined;
    });
    return active;
  };

  return { beginSignIn };
};

/**
 * Performs a network-bound subject check before sensitive Account operations.
 * A 401/403 means the session is revoked; transport or server failure is not
 * silently treated as valid.
 */
export const createOidcOnlineSessionValidator = (
  configuration: DesktopOidcConfiguration,
  request: typeof fetch = fetch,
  egressAuthority: SystemEgressAuthority = createSystemEgressAuthority()
): ((session: AuthenticatedAccountSession, signal: AbortSignal) => Promise<{ status: 'valid' | 'revoked' }>) => {
  return async (session, signal) => {
    requireOidcEgress(egressAuthority, configuration, discoveryUrl(configuration.issuer));
    const discovery = parseDiscovery(
      await readBoundedJson<unknown>(
        await fetchOidc(request, discoveryUrl(configuration.issuer), { signal }),
        'OIDC discovery'
      ),
      configuration
    );
    requireOidcEgress(egressAuthority, configuration, discovery.userinfo_endpoint);

    const response = await fetchOidc(request, discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' },
      signal,
    });
    if (response.status === 401 || response.status === 403) return { status: 'revoked' };
    const profile = await readBoundedJson<Record<string, unknown>>(response, 'OIDC user-info');
    if (profile.sub !== session.subjectId) {
      throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'OIDC user-info subject does not match the session.');
    }
    return { status: 'valid' };
  };
};
