import { describe, expect, it } from 'vitest';
import { createPrivateKey, sign } from 'node:crypto';
import {
  PortableManagedUsageAuthorityVerifier,
  type ManagedUsageAcceptedQuoteAuthorityEvidence,
  type ManagedUsageCreditMintAuthorityEvidence,
  type ManagedUsageProviderMeterAuthorityEvidence,
} from '@/common/billing/managedUsageAuthority';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { ManagedUsageAcceptedQuoteStore } from '@process/services/database/drivers/managedUsage/managedUsageAcceptedQuoteStore';

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFDxlTYTGuwIh78cU2rnZ6Qfhk8OzdIGBdFJZx2TOXH4=
-----END PUBLIC KEY-----`;
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIHTbeIm54CXv5GYKmZjkr5UZsESCENBRuxTTTR1ZtDEP
-----END PRIVATE KEY-----`;
const CHALLENGE = 'a'.repeat(64);
const QUOTE = {
  schemaVersion: 1 as const,
  quoteId: 'quote-1',
  accountId: 'account-1',
  runId: 'run-1',
  targetId: 'target-1',
  rateCardVersion: 'rate-card-1',
  policyVersion: 'policy-1',
  maxCreditMinor: 400,
  expiresAt: '2030-08-21T00:10:00.000Z',
  acceptedAt: '2030-08-21T00:05:00.000Z',
};
const AUTHORITY_PAYLOAD = {
  schemaVersion: 1 as const,
  kind: 'managed-usage-accepted-quote',
  authorityId: 'rate-card-authority-v1',
  authorityEventId: 'authority-event-1',
  authorityReference: 'authority-reference-1',
  environment: 'test',
  audience: 'tomni-managed-usage' as const,
  challengeHash: CHALLENGE,
  quote: QUOTE,
};
const SIGNED_JWS = (() => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', kid: 'managed-authority-test-1', typ: 'tomni-managed-usage-authority+jws', v: 1 })
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(AUTHORITY_PAYLOAD)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), createPrivateKey(PRIVATE_KEY)).toString('base64url')}`;
})();

const signAuthorityPayload = (
  payloadValue: Record<string, unknown>,
  headerValue: Record<string, unknown> = {
    alg: 'EdDSA',
    kid: 'managed-authority-test-1',
    typ: 'tomni-managed-usage-authority+jws',
    v: 1,
  }
): string => {
  const header = Buffer.from(JSON.stringify(headerValue)).toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadValue)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), createPrivateKey(PRIVATE_KEY)).toString('base64url')}`;
};

const CREDIT_MINT = {
  schemaVersion: 1 as const,
  kind: 'managed-usage-credit-mint' as const,
  mintId: 'mint-1',
  accountId: 'account-1',
  creditMinor: 250,
  paymentIngressReference: 'ingress-1',
};
const PROVIDER_METER = {
  schemaVersion: 1 as const,
  kind: 'managed-usage-provider-meter' as const,
  meterEventId: 'meter-1',
  reservationId: 'reservation-1',
  providerUsageReference: 'provider-usage-1',
  chargedMinor: 125,
};
const CREDIT_MINT_PAYLOAD = {
  schemaVersion: 1 as const,
  kind: 'managed-usage-credit-mint',
  purpose: 'managed-usage-credit-mint-authority',
  authorityId: 'rate-card-authority-v1',
  authorityEventId: 'mint-authority-event-1',
  authorityReference: 'mint-authority-reference-1',
  environment: 'test',
  audience: 'tomni-managed-usage' as const,
  expiresAt: '2030-08-21T00:10:00.000Z',
  event: CREDIT_MINT,
};
const PROVIDER_METER_PAYLOAD = {
  schemaVersion: 1 as const,
  kind: 'managed-usage-provider-meter',
  purpose: 'managed-usage-provider-meter-authority',
  authorityId: 'rate-card-authority-v1',
  authorityEventId: 'meter-authority-event-1',
  authorityReference: 'meter-authority-reference-1',
  environment: 'test',
  audience: 'tomni-managed-usage' as const,
  expiresAt: '2030-08-21T00:10:00.000Z',
  event: PROVIDER_METER,
};
const creditMintEvidence = (
  authorityJws = signAuthorityPayload(CREDIT_MINT_PAYLOAD)
): ManagedUsageCreditMintAuthorityEvidence => ({
  schemaVersion: 1,
  authorityId: CREDIT_MINT_PAYLOAD.authorityId,
  authorityEventId: CREDIT_MINT_PAYLOAD.authorityEventId,
  authorityReference: CREDIT_MINT_PAYLOAD.authorityReference,
  environment: CREDIT_MINT_PAYLOAD.environment,
  audience: CREDIT_MINT_PAYLOAD.audience,
  expiresAt: CREDIT_MINT_PAYLOAD.expiresAt,
  mint: CREDIT_MINT,
  authorityJws,
});
const providerMeterEvidence = (
  authorityJws = signAuthorityPayload(PROVIDER_METER_PAYLOAD)
): ManagedUsageProviderMeterAuthorityEvidence => ({
  schemaVersion: 1,
  authorityId: PROVIDER_METER_PAYLOAD.authorityId,
  authorityEventId: PROVIDER_METER_PAYLOAD.authorityEventId,
  authorityReference: PROVIDER_METER_PAYLOAD.authorityReference,
  environment: PROVIDER_METER_PAYLOAD.environment,
  audience: PROVIDER_METER_PAYLOAD.audience,
  expiresAt: PROVIDER_METER_PAYLOAD.expiresAt,
  meter: PROVIDER_METER,
  authorityJws,
});

const evidence = (): ManagedUsageAcceptedQuoteAuthorityEvidence => ({
  schemaVersion: 1,
  acceptanceId: 'acceptance-1',
  quote: QUOTE,
  authorityId: 'rate-card-authority-v1',
  authorityEventId: 'authority-event-1',
  authorityReference: 'authority-reference-1',
  environment: 'test',
  audience: 'tomni-managed-usage',
  challengeHash: CHALLENGE,
  authorityJws: SIGNED_JWS,
});

const verifier = (options?: Readonly<{ challenge?: string | undefined; environment?: string; now?: number }>) =>
  new PortableManagedUsageAuthorityVerifier({
    pinnedDirectory: {
      'managed-authority-test-1': {
        authorityId: 'rate-card-authority-v1',
        environment: 'test',
        audience: 'tomni-managed-usage',
        publicKey: PUBLIC_KEY,
      },
    },
    environment: options?.environment ?? 'test',
    audience: 'tomni-managed-usage',
    resolveChallengeHash: () => options?.challenge ?? CHALLENGE,
    now: () => options?.now ?? Date.parse('2030-08-21T00:06:00.000Z'),
  });

const withHeader = (value: Record<string, unknown>): string => {
  const [_, payload, signature] = SIGNED_JWS.split('.');
  return `${Buffer.from(JSON.stringify(value)).toString('base64url')}.${payload}.${signature}`;
};

const withPayload = (value: Record<string, unknown>): string => {
  const [header, _, signature] = SIGNED_JWS.split('.');
  return `${header}.${Buffer.from(JSON.stringify(value)).toString('base64url')}.${signature}`;
};

const memoryDriver = (): ISqliteDriver => ({
  prepare: () => ({
    get: () => undefined,
    all: () => [],
    run: () => ({ changes: 1, lastInsertRowid: 1 }),
  }),
  exec: () => undefined,
  pragma: () => undefined,
  transaction:
    (operation) =>
    (...args) =>
      operation(...args),
  close: () => undefined,
});

describe('PortableManagedUsageAuthorityVerifier', () => {
  it('accepts only the static Ed25519 authority fixture bound to exact Main evidence', () => {
    expect(verifier().verifyAcceptedQuoteEvidence(evidence())).toEqual(evidence().quote);
  });

  it('lets the durable accepted-quote store consume only the exact verified authority quote', () => {
    const store = new ManagedUsageAcceptedQuoteStore(memoryDriver(), verifier());
    expect(store.accept(evidence())).toEqual(evidence());
    expect(() => store.accept({ ...evidence(), quote: { ...evidence().quote, maxCreditMinor: 401 } })).toThrow(
      /independently verified/i
    );
  });

  it('rejects a signature, key, header, schema, environment, audience, challenge, event/ref, or quote binding mismatch', () => {
    const current = evidence();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, authorityJws: `${current.authorityJws}x` })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({
        ...current,
        authorityJws: withHeader({ alg: 'EdDSA', kid: 'unknown-key', typ: 'tomni-managed-usage-authority+jws', v: 1 }),
      })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({
        ...current,
        authorityJws: withHeader({
          alg: 'none',
          kid: 'managed-authority-test-1',
          typ: 'tomni-managed-usage-authority+jws',
          v: 1,
        }),
      })
    ).toBeUndefined();
    expect(verifier({ environment: 'production' }).verifyAcceptedQuoteEvidence(current)).toBeUndefined();
    expect(verifier({ challenge: 'b'.repeat(64) }).verifyAcceptedQuoteEvidence(current)).toBeUndefined();
    expect(verifier().verifyAcceptedQuoteEvidence({ ...current, authorityEventId: 'other-event' })).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, authorityReference: 'other-reference' })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, quote: { ...current.quote, accountId: 'other-account' } })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, quote: { ...current.quote, runId: 'other-run' } })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, quote: { ...current.quote, targetId: 'other-target' } })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, quote: { ...current.quote, rateCardVersion: 'other-card' } })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({ ...current, quote: { ...current.quote, policyVersion: 'other-policy' } })
    ).toBeUndefined();
    expect(
      verifier({ now: Date.parse('2030-08-21T00:10:00.001Z') }).verifyAcceptedQuoteEvidence(current)
    ).toBeUndefined();
  });

  it('rejects unknown or sensitive authority payload fields before attempting a trusted signature', () => {
    const current = evidence();
    const [, payload] = SIGNED_JWS.split('.');
    const parsed = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(
      verifier().verifyAcceptedQuoteEvidence({
        ...current,
        authorityJws: withPayload({ ...parsed, extra: 'not-contract' }),
      })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({
        ...current,
        authorityJws: withPayload({ ...parsed, apiKey: 'must-never-persist' }),
      })
    ).toBeUndefined();
    expect(
      verifier().verifyAcceptedQuoteEvidence({
        ...current,
        userNarrative: 'unbounded text',
      } as unknown as ManagedUsageAcceptedQuoteAuthorityEvidence)
    ).toBeUndefined();
  });
  it('verifies credit-mint and provider-meter evidence as separate signed read-only authority domains', () => {
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence())).toEqual(CREDIT_MINT);
    expect(verifier().verifyProviderMeterEvidence(providerMeterEvidence())).toEqual(PROVIDER_METER);
    expect(verifier().verifyCreditMintEvidence({ ...creditMintEvidence(), authorityJws: SIGNED_JWS })).toBeUndefined();
    expect(
      verifier().verifyProviderMeterEvidence({
        ...providerMeterEvidence(),
        authorityJws: creditMintEvidence().authorityJws,
      })
    ).toBeUndefined();
  });

  it('rejects credit-mint and meter authority evidence with wrong kind, purpose, key, algorithm, signature, expiry, or environment', () => {
    const wrongKind = signAuthorityPayload({ ...CREDIT_MINT_PAYLOAD, kind: 'store-payment-event' });
    const wrongPurpose = signAuthorityPayload({ ...CREDIT_MINT_PAYLOAD, purpose: 'store-payment-authority' });
    const unknownKey = signAuthorityPayload(CREDIT_MINT_PAYLOAD, {
      alg: 'EdDSA',
      kid: 'unknown-authority-key',
      typ: 'tomni-managed-usage-authority+jws',
      v: 1,
    });
    const wrongAlgorithm = signAuthorityPayload(CREDIT_MINT_PAYLOAD, {
      alg: 'none',
      kid: 'managed-authority-test-1',
      typ: 'tomni-managed-usage-authority+jws',
      v: 1,
    });
    const wrongEnvironment = signAuthorityPayload({ ...CREDIT_MINT_PAYLOAD, environment: 'production' });
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(wrongKind))).toBeUndefined();
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(wrongPurpose))).toBeUndefined();
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(unknownKey))).toBeUndefined();
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(wrongAlgorithm))).toBeUndefined();
    expect(
      verifier().verifyCreditMintEvidence({
        ...creditMintEvidence(),
        authorityJws: `${creditMintEvidence().authorityJws}x`,
      })
    ).toBeUndefined();
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(wrongEnvironment))).toBeUndefined();
    expect(
      verifier({ now: Date.parse('2030-08-21T00:10:00.001Z') }).verifyProviderMeterEvidence(providerMeterEvidence())
    ).toBeUndefined();
  });

  it('rejects unknown or sensitive event payload fields and any changed signed replay identifier or event binding', () => {
    const unknownField = signAuthorityPayload({ ...CREDIT_MINT_PAYLOAD, extra: 'not-contract' });
    const sensitiveField = signAuthorityPayload({ ...CREDIT_MINT_PAYLOAD, apiKey: 'must-never-persist' });
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(unknownField))).toBeUndefined();
    expect(verifier().verifyCreditMintEvidence(creditMintEvidence(sensitiveField))).toBeUndefined();
    expect(
      verifier().verifyCreditMintEvidence({
        ...creditMintEvidence(),
        authorityEventId: 'other-mint-authority-event',
      })
    ).toBeUndefined();
    expect(
      verifier().verifyCreditMintEvidence({
        ...creditMintEvidence(),
        mint: { ...CREDIT_MINT, mintId: 'replayed-mint-identifier' },
      })
    ).toBeUndefined();
    expect(
      verifier().verifyProviderMeterEvidence({
        ...providerMeterEvidence(),
        meter: { ...PROVIDER_METER, meterEventId: 'replayed-meter-identifier' },
      })
    ).toBeUndefined();
  });
});
