/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

const MAX_IDENTIFIER_LENGTH = 200;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SENSITIVE_FIELD = /(?:secret|token|password|authorization|prompt|credential|api[-_]?key)/iu;
const JWS_TYPE = 'tomni-managed-usage-authority+jws';
const QUOTE_PAYLOAD_KIND = 'managed-usage-accepted-quote';
const CREDIT_MINT_PAYLOAD_KIND = 'managed-usage-credit-mint';
const PROVIDER_METER_PAYLOAD_KIND = 'managed-usage-provider-meter';
const CREDIT_MINT_PURPOSE = 'managed-usage-credit-mint-authority';
const PROVIDER_METER_PURPOSE = 'managed-usage-provider-meter-authority';

export type ManagedUsageAuthorityQuoteBinding = Readonly<{
  schemaVersion: 1;
  quoteId: string;
  accountId: string;
  runId: string;
  targetId: string;
  rateCardVersion: string;
  policyVersion: string;
  maxCreditMinor: number;
  expiresAt: string;
  acceptedAt: string;
}>;

/** This domain is deliberately separate from Store PaymentEvent and provider metering evidence. */
export type ManagedUsageCreditMintAuthorityEvent = Readonly<{
  schemaVersion: 1;
  kind: 'managed-usage-credit-mint';
  mintId: string;
  accountId: string;
  creditMinor: number;
  paymentIngressReference: string;
}>;

/** Provider usage is an input to settlement, never a quote acceptance or a Credit mint. */
export type ManagedUsageProviderMeterAuthorityEvent = Readonly<{
  schemaVersion: 1;
  kind: 'managed-usage-provider-meter';
  meterEventId: string;
  reservationId: string;
  providerUsageReference: string;
  chargedMinor: number;
}>;

export type ManagedUsageAuthorityAudience = 'tomni-managed-usage';

export type ManagedUsageAcceptedQuoteAuthorityEvidence = Readonly<{
  schemaVersion: 1;
  acceptanceId: string;
  quote: ManagedUsageAuthorityQuoteBinding;
  authorityId: string;
  authorityEventId: string;
  authorityReference: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  /** SHA-256 of a challenge generated and retained by Main before quote acceptance. */
  challengeHash: string;
  /** Strict compact JWS signed by a key in the injected, pinned authority directory. */
  authorityJws: string;
}>;

/**
 * A signed admission record only. Its replay identifier must later be consumed by
 * a durable mint ingress; this portable verifier never mints or records it.
 */
export type ManagedUsageCreditMintAuthorityEvidence = Readonly<{
  schemaVersion: 1;
  authorityId: string;
  authorityEventId: string;
  authorityReference: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  expiresAt: string;
  mint: ManagedUsageCreditMintAuthorityEvent;
  authorityJws: string;
}>;

/** A signed metering input only. Verification neither settles nor records usage. */
export type ManagedUsageProviderMeterAuthorityEvidence = Readonly<{
  schemaVersion: 1;
  authorityId: string;
  authorityEventId: string;
  authorityReference: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  expiresAt: string;
  meter: ManagedUsageProviderMeterAuthorityEvent;
  authorityJws: string;
}>;

type ManagedUsageAcceptedQuoteAuthorityPayload = Readonly<{
  schemaVersion: 1;
  kind: typeof QUOTE_PAYLOAD_KIND;
  authorityId: string;
  authorityEventId: string;
  authorityReference: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  challengeHash: string;
  quote: ManagedUsageAuthorityQuoteBinding;
}>;

type ManagedUsageAuthorityEventPayload<TEvent> = Readonly<{
  schemaVersion: 1;
  kind: typeof CREDIT_MINT_PAYLOAD_KIND | typeof PROVIDER_METER_PAYLOAD_KIND;
  purpose: typeof CREDIT_MINT_PURPOSE | typeof PROVIDER_METER_PURPOSE;
  authorityId: string;
  authorityEventId: string;
  authorityReference: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  expiresAt: string;
  event: TEvent;
}>;

type CompactJwsHeader = Readonly<{
  alg: 'EdDSA';
  kid: string;
  typ: typeof JWS_TYPE;
  v: 1;
}>;

export type ManagedUsageAuthorityPinnedKey = Readonly<{
  authorityId: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  publicKey: KeyObject | string;
}>;

export type ManagedUsageAuthorityVerifierOptions = Readonly<{
  /** Injected at bootstrap; the verifier never discovers or trusts keys from a JWS. */
  pinnedDirectory: Readonly<Record<string, ManagedUsageAuthorityPinnedKey>>;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  /** Main supplies the exact live challenge hash for the acceptance ID. */
  resolveChallengeHash: (acceptanceId: string) => string | undefined;
  now?: () => number;
}>;

export type ManagedUsageQuoteEvidenceVerifier = Readonly<{
  verifyAcceptedQuoteEvidence: (
    evidence: ManagedUsageAcceptedQuoteAuthorityEvidence
  ) => ManagedUsageAuthorityQuoteBinding | undefined;
}>;

/**
 * Verification is deliberately read-only. Durable replay consumption and all
 * minting, settlement, payment, or provider transport remain separate owners.
 */
export type ManagedUsageAuthorityEventEvidenceVerifier = Readonly<{
  verifyCreditMintEvidence: (
    evidence: ManagedUsageCreditMintAuthorityEvidence
  ) => ManagedUsageCreditMintAuthorityEvent | undefined;
  verifyProviderMeterEvidence: (
    evidence: ManagedUsageProviderMeterAuthorityEvidence
  ) => ManagedUsageProviderMeterAuthorityEvent | undefined;
}>;

export class ManagedUsageAuthorityConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ManagedUsageAuthorityConfigurationError';
  }
}

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && SAFE_IDENTIFIER.test(value);

const isIsoDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

const hasSensitiveField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasSensitiveField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_FIELD.test(key) || hasSensitiveField(child));
};

const strictBase64url = (segment: string): Buffer | undefined => {
  if (segment.length === 0 || !BASE64URL.test(segment)) return undefined;
  try {
    const decoded = Buffer.from(segment, 'base64url');
    return decoded.toString('base64url') === segment ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const parseStrictJson = (segment: string): Record<string, unknown> | undefined => {
  const bytes = strictBase64url(segment);
  if (bytes === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isQuoteBinding = (value: unknown): value is ManagedUsageAuthorityQuoteBinding => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'quoteId',
      'accountId',
      'runId',
      'targetId',
      'rateCardVersion',
      'policyVersion',
      'maxCreditMinor',
      'expiresAt',
      'acceptedAt',
    ]) ||
    value.schemaVersion !== 1 ||
    ![value.quoteId, value.accountId, value.runId, value.targetId, value.rateCardVersion, value.policyVersion].every(
      isSafeIdentifier
    ) ||
    typeof value.maxCreditMinor !== 'number' ||
    !Number.isSafeInteger(value.maxCreditMinor) ||
    value.maxCreditMinor <= 0 ||
    !isIsoDate(value.expiresAt) ||
    !isIsoDate(value.acceptedAt)
  ) {
    return false;
  }
  return Date.parse(value.acceptedAt) <= Date.parse(value.expiresAt) && !hasSensitiveField(value);
};

const sameQuote = (left: ManagedUsageAuthorityQuoteBinding, right: ManagedUsageAuthorityQuoteBinding): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.quoteId === right.quoteId &&
  left.accountId === right.accountId &&
  left.runId === right.runId &&
  left.targetId === right.targetId &&
  left.rateCardVersion === right.rateCardVersion &&
  left.policyVersion === right.policyVersion &&
  left.maxCreditMinor === right.maxCreditMinor &&
  left.expiresAt === right.expiresAt &&
  left.acceptedAt === right.acceptedAt;

const isCreditMintEvent = (value: unknown): value is ManagedUsageCreditMintAuthorityEvent =>
  isRecord(value) &&
  hasOnlyKeys(value, ['schemaVersion', 'kind', 'mintId', 'accountId', 'creditMinor', 'paymentIngressReference']) &&
  value.schemaVersion === 1 &&
  value.kind === CREDIT_MINT_PAYLOAD_KIND &&
  [value.mintId, value.accountId, value.paymentIngressReference].every(isSafeIdentifier) &&
  typeof value.creditMinor === 'number' &&
  Number.isSafeInteger(value.creditMinor) &&
  value.creditMinor > 0 &&
  !hasSensitiveField(value);

const isProviderMeterEvent = (value: unknown): value is ManagedUsageProviderMeterAuthorityEvent =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    'schemaVersion',
    'kind',
    'meterEventId',
    'reservationId',
    'providerUsageReference',
    'chargedMinor',
  ]) &&
  value.schemaVersion === 1 &&
  value.kind === PROVIDER_METER_PAYLOAD_KIND &&
  [value.meterEventId, value.reservationId, value.providerUsageReference].every(isSafeIdentifier) &&
  typeof value.chargedMinor === 'number' &&
  Number.isSafeInteger(value.chargedMinor) &&
  value.chargedMinor >= 0 &&
  !hasSensitiveField(value);

type ManagedUsageAuthorityEventEvidenceEnvelope = Readonly<{
  schemaVersion: 1;
  authorityId: string;
  authorityEventId: string;
  authorityReference: string;
  environment: string;
  audience: ManagedUsageAuthorityAudience;
  expiresAt: string;
  authorityJws: string;
}>;

const isAuthorityEventEvidenceEnvelope = (value: unknown): value is ManagedUsageAuthorityEventEvidenceEnvelope =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  [value.authorityId, value.authorityEventId, value.authorityReference, value.environment].every(isSafeIdentifier) &&
  value.audience === 'tomni-managed-usage' &&
  isIsoDate(value.expiresAt) &&
  typeof value.authorityJws === 'string' &&
  !hasSensitiveField(value);

const isCreditMintEvidence = (value: unknown): value is ManagedUsageCreditMintAuthorityEvidence =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    'schemaVersion',
    'authorityId',
    'authorityEventId',
    'authorityReference',
    'environment',
    'audience',
    'expiresAt',
    'mint',
    'authorityJws',
  ]) &&
  isCreditMintEvent(value.mint) &&
  isAuthorityEventEvidenceEnvelope(value);

const isProviderMeterEvidence = (value: unknown): value is ManagedUsageProviderMeterAuthorityEvidence =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    'schemaVersion',
    'authorityId',
    'authorityEventId',
    'authorityReference',
    'environment',
    'audience',
    'expiresAt',
    'meter',
    'authorityJws',
  ]) &&
  isProviderMeterEvent(value.meter) &&
  isAuthorityEventEvidenceEnvelope(value);

const sameCreditMintEvent = (
  left: ManagedUsageCreditMintAuthorityEvent,
  right: ManagedUsageCreditMintAuthorityEvent
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.kind === right.kind &&
  left.mintId === right.mintId &&
  left.accountId === right.accountId &&
  left.creditMinor === right.creditMinor &&
  left.paymentIngressReference === right.paymentIngressReference;

const sameProviderMeterEvent = (
  left: ManagedUsageProviderMeterAuthorityEvent,
  right: ManagedUsageProviderMeterAuthorityEvent
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.kind === right.kind &&
  left.meterEventId === right.meterEventId &&
  left.reservationId === right.reservationId &&
  left.providerUsageReference === right.providerUsageReference &&
  left.chargedMinor === right.chargedMinor;

const parseHeader = (value: unknown): CompactJwsHeader | undefined =>
  isRecord(value) &&
  hasOnlyKeys(value, ['alg', 'kid', 'typ', 'v']) &&
  value.alg === 'EdDSA' &&
  value.typ === JWS_TYPE &&
  value.v === 1 &&
  isSafeIdentifier(value.kid)
    ? (value as CompactJwsHeader)
    : undefined;

const parsePayload = (value: unknown): ManagedUsageAcceptedQuoteAuthorityPayload | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'kind',
      'authorityId',
      'authorityEventId',
      'authorityReference',
      'environment',
      'audience',
      'challengeHash',
      'quote',
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== QUOTE_PAYLOAD_KIND ||
    !isSafeIdentifier(value.authorityId) ||
    !isSafeIdentifier(value.authorityEventId) ||
    !isSafeIdentifier(value.authorityReference) ||
    !isSafeIdentifier(value.environment) ||
    value.audience !== 'tomni-managed-usage' ||
    typeof value.challengeHash !== 'string' ||
    !SHA256_HEX.test(value.challengeHash) ||
    !isQuoteBinding(value.quote) ||
    hasSensitiveField(value)
  ) {
    return undefined;
  }
  return value as ManagedUsageAcceptedQuoteAuthorityPayload;
};

const parseAuthorityEventPayload = <TEvent>(
  value: unknown,
  expectedKind: typeof CREDIT_MINT_PAYLOAD_KIND | typeof PROVIDER_METER_PAYLOAD_KIND,
  expectedPurpose: typeof CREDIT_MINT_PURPOSE | typeof PROVIDER_METER_PURPOSE,
  isExpectedEvent: (event: unknown) => event is TEvent
): ManagedUsageAuthorityEventPayload<TEvent> | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'kind',
      'purpose',
      'authorityId',
      'authorityEventId',
      'authorityReference',
      'environment',
      'audience',
      'expiresAt',
      'event',
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== expectedKind ||
    value.purpose !== expectedPurpose ||
    !isSafeIdentifier(value.authorityId) ||
    !isSafeIdentifier(value.authorityEventId) ||
    !isSafeIdentifier(value.authorityReference) ||
    !isSafeIdentifier(value.environment) ||
    value.audience !== 'tomni-managed-usage' ||
    !isIsoDate(value.expiresAt) ||
    !isExpectedEvent(value.event) ||
    hasSensitiveField(value)
  ) {
    return undefined;
  }
  return value as ManagedUsageAuthorityEventPayload<TEvent>;
};

const parsePublicKey = (keyId: string, source: KeyObject | string): KeyObject => {
  try {
    const key = typeof source === 'string' ? createPublicKey(source) : source;
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('not-ed25519');
    return key;
  } catch {
    throw new ManagedUsageAuthorityConfigurationError(`Pinned managed-usage authority key is not Ed25519: ${keyId}`);
  }
};

const isEvidence = (value: unknown): value is ManagedUsageAcceptedQuoteAuthorityEvidence =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    'schemaVersion',
    'acceptanceId',
    'quote',
    'authorityId',
    'authorityEventId',
    'authorityReference',
    'environment',
    'audience',
    'challengeHash',
    'authorityJws',
  ]) &&
  value.schemaVersion === 1 &&
  isSafeIdentifier(value.acceptanceId) &&
  isQuoteBinding(value.quote) &&
  isSafeIdentifier(value.authorityId) &&
  isSafeIdentifier(value.authorityEventId) &&
  isSafeIdentifier(value.authorityReference) &&
  isSafeIdentifier(value.environment) &&
  value.audience === 'tomni-managed-usage' &&
  typeof value.challengeHash === 'string' &&
  SHA256_HEX.test(value.challengeHash) &&
  typeof value.authorityJws === 'string' &&
  !hasSensitiveField(value);

/**
 * Offline-only compact-JWS verifier for an already accepted managed-usage quote.
 * It is not a payment mint, Store payment event, provider meter, price engine,
 * reservation, or provider/cloud control plane.
 */
export class PortableManagedUsageAuthorityVerifier
  implements ManagedUsageQuoteEvidenceVerifier, ManagedUsageAuthorityEventEvidenceVerifier
{
  private readonly keys = new Map<string, Readonly<{ pin: ManagedUsageAuthorityPinnedKey; key: KeyObject }>>();
  private readonly now: () => number;

  public constructor(private readonly options: ManagedUsageAuthorityVerifierOptions) {
    if (!isSafeIdentifier(options.environment)) {
      throw new ManagedUsageAuthorityConfigurationError('Managed-usage authority environment is invalid.');
    }
    if (options.audience !== 'tomni-managed-usage' || typeof options.resolveChallengeHash !== 'function') {
      throw new ManagedUsageAuthorityConfigurationError('Managed-usage authority verifier configuration is invalid.');
    }
    for (const [keyId, pin] of Object.entries(options.pinnedDirectory)) {
      if (
        !isSafeIdentifier(keyId) ||
        !isRecord(pin) ||
        !hasOnlyKeys(pin, ['authorityId', 'environment', 'audience', 'publicKey']) ||
        !isSafeIdentifier(pin.authorityId) ||
        !isSafeIdentifier(pin.environment) ||
        pin.audience !== 'tomni-managed-usage'
      ) {
        throw new ManagedUsageAuthorityConfigurationError(
          `Managed-usage authority directory entry is invalid: ${keyId}`
        );
      }
      this.keys.set(keyId, { pin, key: parsePublicKey(keyId, pin.publicKey) });
    }
    if (this.keys.size === 0) {
      throw new ManagedUsageAuthorityConfigurationError('At least one pinned managed-usage authority key is required.');
    }
    this.now = options.now ?? Date.now;
  }

  public verifyAcceptedQuoteEvidence(
    evidence: ManagedUsageAcceptedQuoteAuthorityEvidence
  ): ManagedUsageAuthorityQuoteBinding | undefined {
    if (
      !isEvidence(evidence) ||
      evidence.environment !== this.options.environment ||
      evidence.audience !== this.options.audience
    ) {
      return undefined;
    }
    const expectedChallenge = this.options.resolveChallengeHash(evidence.acceptanceId);
    if (
      expectedChallenge === undefined ||
      !SHA256_HEX.test(expectedChallenge) ||
      expectedChallenge !== evidence.challengeHash
    ) {
      return undefined;
    }
    const parts = evidence.authorityJws.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined;
    const header = parseHeader(parseStrictJson(parts[0]!));
    const payload = parsePayload(parseStrictJson(parts[1]!));
    const signature = strictBase64url(parts[2]!);
    if (header === undefined || payload === undefined || signature === undefined || signature.byteLength !== 64)
      return undefined;
    const trusted = this.keys.get(header.kid);
    if (trusted === undefined) return undefined;
    if (
      trusted.pin.authorityId !== evidence.authorityId ||
      trusted.pin.authorityId !== payload.authorityId ||
      trusted.pin.environment !== this.options.environment ||
      trusted.pin.audience !== this.options.audience ||
      payload.environment !== this.options.environment ||
      payload.audience !== this.options.audience ||
      payload.authorityEventId !== evidence.authorityEventId ||
      payload.authorityReference !== evidence.authorityReference ||
      payload.challengeHash !== evidence.challengeHash ||
      !sameQuote(payload.quote, evidence.quote) ||
      Date.parse(payload.quote.expiresAt) < this.now()
    ) {
      return undefined;
    }
    try {
      return verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), trusted.key, signature)
        ? Object.freeze({ ...payload.quote })
        : undefined;
    } catch {
      return undefined;
    }
  }

  public verifyCreditMintEvidence(
    evidence: ManagedUsageCreditMintAuthorityEvidence
  ): ManagedUsageCreditMintAuthorityEvent | undefined {
    if (
      !isCreditMintEvidence(evidence) ||
      evidence.environment !== this.options.environment ||
      evidence.audience !== this.options.audience
    ) {
      return undefined;
    }
    return this.verifyAuthorityEventEvidence(
      evidence,
      evidence.mint,
      CREDIT_MINT_PAYLOAD_KIND,
      CREDIT_MINT_PURPOSE,
      isCreditMintEvent,
      sameCreditMintEvent
    );
  }

  public verifyProviderMeterEvidence(
    evidence: ManagedUsageProviderMeterAuthorityEvidence
  ): ManagedUsageProviderMeterAuthorityEvent | undefined {
    if (
      !isProviderMeterEvidence(evidence) ||
      evidence.environment !== this.options.environment ||
      evidence.audience !== this.options.audience
    ) {
      return undefined;
    }
    return this.verifyAuthorityEventEvidence(
      evidence,
      evidence.meter,
      PROVIDER_METER_PAYLOAD_KIND,
      PROVIDER_METER_PURPOSE,
      isProviderMeterEvent,
      sameProviderMeterEvent
    );
  }

  private verifyAuthorityEventEvidence<TEvent>(
    evidence: ManagedUsageAuthorityEventEvidenceEnvelope,
    event: TEvent,
    expectedKind: typeof CREDIT_MINT_PAYLOAD_KIND | typeof PROVIDER_METER_PAYLOAD_KIND,
    expectedPurpose: typeof CREDIT_MINT_PURPOSE | typeof PROVIDER_METER_PURPOSE,
    isExpectedEvent: (value: unknown) => value is TEvent,
    sameEvent: (left: TEvent, right: TEvent) => boolean
  ): TEvent | undefined {
    const parts = evidence.authorityJws.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined;
    const header = parseHeader(parseStrictJson(parts[0]!));
    const payload = parseAuthorityEventPayload(
      parseStrictJson(parts[1]!),
      expectedKind,
      expectedPurpose,
      isExpectedEvent
    );
    const signature = strictBase64url(parts[2]!);
    if (header === undefined || payload === undefined || signature === undefined || signature.byteLength !== 64)
      return undefined;
    const trusted = this.keys.get(header.kid);
    if (trusted === undefined) return undefined;
    if (
      trusted.pin.authorityId !== evidence.authorityId ||
      trusted.pin.authorityId !== payload.authorityId ||
      trusted.pin.environment !== this.options.environment ||
      trusted.pin.audience !== this.options.audience ||
      payload.environment !== this.options.environment ||
      payload.audience !== this.options.audience ||
      payload.authorityEventId !== evidence.authorityEventId ||
      payload.authorityReference !== evidence.authorityReference ||
      payload.expiresAt !== evidence.expiresAt ||
      !sameEvent(payload.event, event) ||
      Date.parse(payload.expiresAt) < this.now()
    ) {
      return undefined;
    }
    try {
      return verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), trusted.key, signature)
        ? Object.freeze({ ...payload.event })
        : undefined;
    } catch {
      return undefined;
    }
  }
}

export const createPortableManagedUsageAuthorityVerifier = (
  options: ManagedUsageAuthorityVerifierOptions
): ManagedUsageQuoteEvidenceVerifier & ManagedUsageAuthorityEventEvidenceVerifier =>
  new PortableManagedUsageAuthorityVerifier(options);
