import { createHash, createPublicKey } from 'node:crypto';
import { createSystemEgressAuthority, type SystemEgressAuthority } from '../systemEgressAuthority';
import type { AccountSessionService } from './accountSessionService';
import { AccountSessionError } from './types';

const MAX_RESPONSE_BYTES = 128 * 1024;
const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export type VerifiedPublisherPrincipal = Readonly<{
  subjectId: string;
  publisherId: string;
  namespace: string;
  role: 'publisher' | 'reviewer' | 'administrator';
  authorityRevision: string;
  verifiedAt: string;
  activeSigningKey: Readonly<{
    keyId: string;
    algorithm: 'Ed25519';
    spkiSha256: string;
    publicKeyPem: string;
  }>;
}>;

export type PublisherAuthorityOptions = Readonly<{
  endpoint: string;
  accountSession: AccountSessionService;
  fetch?: typeof fetch;
  egressAuthority?: SystemEgressAuthority;
  now?: () => Date;
}>;

export type PublisherAuthority = Readonly<{
  requirePublisherPrincipal(): Promise<VerifiedPublisherPrincipal>;
}>;

const parseEndpoint = (value: string): URL => {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority endpoint is invalid.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new AccountSessionError(
      'ACCOUNT_SESSION_INVALID',
      'Publisher authority endpoint must be HTTPS without credentials.'
    );
  }
  return endpoint;
};

/** A bearer request must never accept an authority response from another URL. */
const assertResponseEndpoint = (response: Response, endpoint: URL): void => {
  if (response.url.length === 0) return;
  let responseEndpoint: URL;
  try {
    responseEndpoint = new URL(response.url);
  } catch {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority response endpoint is invalid.');
  }
  if (responseEndpoint.toString() !== endpoint.toString()) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority response endpoint does not match.');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (record: Record<string, unknown>, keys: readonly string[], label: string): void => {
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `${label} is invalid.`);
  }
};

const requiredString = (record: Record<string, unknown>, key: string, maximum = 2_048): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /\p{Cc}/u.test(value)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `Publisher authority ${key} is invalid.`);
  }
  return value;
};

const requiredPublicKeyPem = (record: Record<string, unknown>): string => {
  const value = record.publicKeyPem;
  const containsDisallowedControl =
    typeof value === 'string' &&
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code <= 31 && code !== 10 && code !== 13) || code === 127;
    });
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384 || containsDisallowedControl) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority publicKeyPem is invalid.');
  }
  return value;
};

const parsePrincipal = (value: unknown, expectedSubjectId: string, now: Date): VerifiedPublisherPrincipal => {
  if (!isRecord(value))
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority response is invalid.');
  assertExactKeys(
    value,
    ['subjectId', 'publisherId', 'namespace', 'role', 'status', 'authorityRevision', 'activeSigningKey'],
    'Publisher authority response'
  );
  const subjectId = requiredString(value, 'subjectId', 512);
  const publisherId = requiredString(value, 'publisherId', 200);
  const namespace = requiredString(value, 'namespace', 200);
  const authorityRevision = requiredString(value, 'authorityRevision', 200);
  if (subjectId !== expectedSubjectId || !PACKAGE_ID.test(publisherId) || !PACKAGE_ID.test(namespace)) {
    throw new AccountSessionError(
      'ACCOUNT_SESSION_INVALID',
      'Publisher authority identity does not match the signed-in account.'
    );
  }
  if (value.status !== 'active' || !['publisher', 'reviewer', 'administrator'].includes(value.role as string)) {
    throw new AccountSessionError('ACCOUNT_SESSION_UNAUTHENTICATED', 'Publisher access is not active.');
  }
  if (!isRecord(value.activeSigningKey)) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher signing key is invalid.');
  }
  const signingKey = value.activeSigningKey;
  assertExactKeys(signingKey, ['keyId', 'algorithm', 'spkiSha256', 'publicKeyPem'], 'Publisher signing key');
  const keyId = requiredString(signingKey, 'keyId', 200);
  const publicKeyPem = requiredPublicKeyPem(signingKey);
  const receivedFingerprint = requiredString(signingKey, 'spkiSha256', 80);
  if (
    !KEY_ID.test(keyId) ||
    signingKey.algorithm !== 'Ed25519' ||
    !/^sha256-[a-f0-9]{64}$/u.test(receivedFingerprint)
  ) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher signing key is invalid.');
  }
  let actualFingerprint: string;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
    actualFingerprint = `sha256-${createHash('sha256')
      .update(publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex')}`;
  } catch (error) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher public key is invalid.', { cause: error });
  }
  if (actualFingerprint !== receivedFingerprint) {
    throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher signing key fingerprint does not match.');
  }
  return {
    subjectId,
    publisherId,
    namespace,
    role: value.role as VerifiedPublisherPrincipal['role'],
    authorityRevision,
    verifiedAt: now.toISOString(),
    activeSigningKey: { keyId, algorithm: 'Ed25519', spkiSha256: actualFingerprint, publicKeyPem },
  };
};

/**
 * Resolves publisher authority online from the verified Account session. The
 * renderer never selects a publisher namespace, role, or signing key.
 */
export const createPublisherAuthority = (options: PublisherAuthorityOptions): PublisherAuthority => {
  const endpoint = parseEndpoint(options.endpoint);
  const request = options.fetch ?? fetch;
  const egressAuthority = options.egressAuthority ?? createSystemEgressAuthority();
  const now = options.now ?? (() => new Date());
  return {
    requirePublisherPrincipal: async () => {
      const session = options.accountSession.requireOnlineSession();
      const egress = egressAuthority.authorize({
        egressClass: 'publisher-authority',
        destination: endpoint.toString(),
        publisherAuthorityOrigin: endpoint.origin,
      });
      if (egress.decision !== 'allow') {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', `Publisher authority egress denied: ${egress.code}.`);
      }
      let response: Response;
      try {
        response = await request(endpoint, {
          headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' },
          redirect: 'error',
        });
      } catch {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority request failed.');
      }
      assertResponseEndpoint(response, endpoint);
      if (response.status === 401 || response.status === 403) {
        throw new AccountSessionError(
          'ACCOUNT_SESSION_UNAUTHENTICATED',
          'Publisher authority rejected the account session.'
        );
      }
      if (!response.ok) throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority request failed.');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new AccountSessionError(
          'ACCOUNT_SESSION_INVALID',
          'Publisher authority response exceeds its size limit.'
        );
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        throw new AccountSessionError('ACCOUNT_SESSION_INVALID', 'Publisher authority response is invalid.', {
          cause: error,
        });
      }
      return parsePrincipal(value, session.subjectId, now());
    },
  };
};
