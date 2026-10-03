import { describe, expect, it } from 'vitest';
import { verifySupabaseJwt } from '../src/auth.js';
import { generateKeyPairSync, sign } from 'node:crypto';
const pair = generateKeyPairSync('ed25519');
const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'k1' };
const token = (claims: Record<string, unknown>) => {
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${sign(null, Buffer.from(`${h}.${p}`), pair.privateKey).toString('base64url')}`;
};
describe('Supabase JWT boundary', () => {
  const base = {
    iss: 'https://supabase.example',
    aud: 'authenticated',
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  it('accepts valid identity', () =>
    expect(verifySupabaseJwt(token(base), { issuer: base.iss, audience: 'authenticated', jwks: [jwk] }).subject).toBe(
      'user-1'
    ));
  it.each([{ iss: 'https://other' }, { aud: 'wrong' }, { exp: 1 }])('rejects invalid claims', (change) =>
    expect(() =>
      verifySupabaseJwt(token({ ...base, ...change }), { issuer: base.iss, audience: 'authenticated', jwks: [jwk] })
    ).toThrow('AUTH_INVALID_CLAIMS')
  );
});
