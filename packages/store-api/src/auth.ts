import { createPublicKey, verify } from 'node:crypto';
type Jwk = Readonly<Record<string, unknown>>;
export type VerifiedIdentity = Readonly<{ issuer: string; subject: string; expiresAt: number }>;
const decode = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AUTH_INVALID_TOKEN');
  return parsed as Record<string, unknown>;
};
export const verifySupabaseJwt = (
  token: string,
  input: Readonly<{ issuer: string; audience: string; jwks: readonly Jwk[]; nowMs?: number }>
): VerifiedIdentity => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('AUTH_INVALID_TOKEN');
  const header = decode(parts[0]!);
  const claims = decode(parts[1]!);
  const alg = header.alg;
  const kid = header.kid;
  if (typeof kid !== 'string' || typeof alg !== 'string' || !['RS256', 'EdDSA'].includes(alg))
    throw new Error('AUTH_INVALID_TOKEN');
  const jwk = input.jwks.find((key) => key.kid === kid);
  if (!jwk) throw new Error('AUTH_KEY_UNAVAILABLE');
  const ok = verify(
    alg === 'RS256' ? 'sha256' : null,
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2]!, 'base64url')
  );
  if (!ok) throw new Error('AUTH_INVALID_SIGNATURE');
  const issuer = claims.iss;
  const subject = claims.sub;
  const exp = claims.exp;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    issuer !== input.issuer ||
    typeof subject !== 'string' ||
    !subject ||
    typeof exp !== 'number' ||
    !aud.includes(input.audience) ||
    exp * 1000 <= (input.nowMs ?? Date.now())
  )
    throw new Error('AUTH_INVALID_CLAIMS');
  return { issuer, subject, expiresAt: exp * 1000 };
};
