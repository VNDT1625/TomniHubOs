/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '../ISqliteDriver';
import type { ManagedUsageAcceptedQuoteAuthorityEvidence } from '@/common/billing/managedUsageAuthority';
import { ManagedUsageLedgerError } from './managedUsageLedger';
import type { ManagedUsageQuote } from './managedUsageLedger';

const MAX_ID_LENGTH = 200;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const SENSITIVE_FIELD = /(?:secret|token|password|authorization|prompt|credential|api[-_]?key)/i;

/**
 * The accepted quote is portable signed authority evidence, not a Store
 * PaymentEvent, Credit mint, provider meter, or provider/cloud command.
 */
export type ManagedUsageAcceptedQuoteEvidence = ManagedUsageAcceptedQuoteAuthorityEvidence &
  Readonly<{ quote: ManagedUsageQuote }>;

export type ManagedUsageQuoteEvidenceVerifier = Readonly<{
  /**
   * Validates evidence at its authority boundary and returns the locked quote
   * only when the evidence is authoritative. Network, signature, payment, and
   * user-consent implementations remain outside this database seam.
   */
  verifyAcceptedQuoteEvidence: (evidence: ManagedUsageAcceptedQuoteEvidence) => ManagedUsageQuote | undefined;
}>;

const clone = <T>(value: T): T => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const assertIdentifier: (label: string, value: unknown) => asserts value is string = (label, value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH || !SAFE_IDENTIFIER.test(value)) {
    throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', `${label} is invalid.`);
  }
};

const assertIsoDate: (label: string, value: unknown) => asserts value is string = (label, value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', `${label} is invalid.`);
  }
};

const assertNoSensitiveFields = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveFields);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key)) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_INVALID',
        'Managed usage quote evidence must not contain secret, credential, or prompt fields.'
      );
    }
    assertNoSensitiveFields(child);
  }
};

const sameQuote = (left: ManagedUsageQuote, right: ManagedUsageQuote): boolean =>
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

/**
 * Main-process durable lookup for already-verified and accepted quote evidence.
 *
 * This class does not price a task, collect payment, validate a signature by
 * itself, reserve Credit, or reach a provider. A missing verifier, failed
 * verification, malformed record, or evidence collision fails closed. Its
 * `resolveAcceptedQuote` method is intentionally shaped for
 * `ManagedUsageSpendAuthorizer` and cannot authorize, mint, or spend Credit on its own.
 */
export class ManagedUsageAcceptedQuoteStore {
  public constructor(
    private readonly database: ISqliteDriver,
    private readonly verifier: ManagedUsageQuoteEvidenceVerifier
  ) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS managed_usage_accepted_quote_evidence (
        acceptance_id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL,
        authority_id TEXT NOT NULL,
        authority_reference TEXT NOT NULL UNIQUE,
        accepted_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS managed_usage_accepted_quote_account_idx
        ON managed_usage_accepted_quote_evidence(account_id, accepted_at);
    `);
  }

  /** Records one verifier-approved quote immutably and returns its durable evidence. */
  public accept(evidence: ManagedUsageAcceptedQuoteEvidence): ManagedUsageAcceptedQuoteEvidence {
    this.assertEvidence(evidence);
    return this.transaction(() => {
      const records = this.loadRecords();
      const existing = records.find(
        (record) => record.acceptanceId === evidence.acceptanceId || record.quote.quoteId === evidence.quote.quoteId
      );
      if (existing !== undefined) {
        if (!this.sameEvidence(existing, evidence)) {
          throw new ManagedUsageLedgerError(
            'MANAGED_USAGE_CONFLICT',
            'Accepted quote identity is already bound to different evidence.'
          );
        }
        return clone(existing);
      }
      if (records.some((record) => record.authorityReference === evidence.authorityReference)) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'Quote authority reference is already bound to other accepted evidence.'
        );
      }

      if (typeof this.verifier?.verifyAcceptedQuoteEvidence !== 'function') {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_STATE_INVALID',
          'Managed spending requires an independently configured quote evidence verifier.'
        );
      }
      const verifiedQuote = this.verifier.verifyAcceptedQuoteEvidence(clone(evidence));
      if (verifiedQuote === undefined || !sameQuote(verifiedQuote, evidence.quote)) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_STATE_INVALID',
          'Managed spending requires independently verified accepted quote evidence.'
        );
      }

      this.database
        .prepare(
          `INSERT INTO managed_usage_accepted_quote_evidence
            (acceptance_id, quote_id, account_id, authority_id, authority_reference, accepted_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          evidence.acceptanceId,
          evidence.quote.quoteId,
          evidence.quote.accountId,
          evidence.authorityId,
          evidence.authorityReference,
          evidence.quote.acceptedAt,
          JSON.stringify(evidence)
        );
      return clone(evidence);
    });
  }

  /** Returns only a previously verifier-approved exact quote for SpendAuthorizer consumption. */
  public resolveAcceptedQuote(quoteId: string): ManagedUsageQuote | undefined {
    assertIdentifier('Quote ID', quoteId);
    return this.loadRecords().find((record) => record.quote.quoteId === quoteId)?.quote;
  }

  private transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  private loadRecords(): readonly ManagedUsageAcceptedQuoteEvidence[] {
    try {
      return this.database
        .prepare(
          `SELECT acceptance_id, quote_id, account_id, authority_id, authority_reference, accepted_at, payload_json
           FROM managed_usage_accepted_quote_evidence
           ORDER BY acceptance_id ASC`
        )
        .all()
        .map((row) => this.readRow(row));
    } catch (error) {
      if (error instanceof ManagedUsageLedgerError && error.code === 'MANAGED_USAGE_LEDGER_CORRUPT') {
        throw error;
      }
      throw new ManagedUsageLedgerError('MANAGED_USAGE_LEDGER_CORRUPT', 'Managed usage quote evidence is corrupt.', {
        cause: error,
      });
    }
  }

  private readRow(row: unknown): ManagedUsageAcceptedQuoteEvidence {
    if (!isRecord(row) || typeof row.payload_json !== 'string') {
      throw new Error('Quote evidence row shape is invalid.');
    }
    const evidence: unknown = JSON.parse(row.payload_json);
    this.assertEvidence(evidence);
    if (
      evidence.acceptanceId !== row.acceptance_id ||
      evidence.quote.quoteId !== row.quote_id ||
      evidence.quote.accountId !== row.account_id ||
      evidence.authorityId !== row.authority_id ||
      evidence.authorityReference !== row.authority_reference ||
      evidence.quote.acceptedAt !== row.accepted_at
    ) {
      throw new Error('Quote evidence row does not match its durable payload.');
    }
    return clone(evidence);
  }

  private assertEvidence(value: unknown): asserts value is ManagedUsageAcceptedQuoteEvidence {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, [
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
      ]) ||
      value.schemaVersion !== 1 ||
      !isRecord(value.quote)
    ) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Accepted quote evidence schema is invalid.');
    }
    assertIdentifier('Quote acceptance ID', value.acceptanceId);
    assertIdentifier('Quote authority ID', value.authorityId);
    assertIdentifier('Quote authority event ID', value.authorityEventId);
    assertIdentifier('Quote authority reference', value.authorityReference);
    assertIdentifier('Quote authority environment', value.environment);
    if (value.audience !== 'tomni-managed-usage') {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Quote authority audience is invalid.');
    }
    if (typeof value.challengeHash !== 'string' || !/^[0-9a-f]{64}$/u.test(value.challengeHash)) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Quote authority challenge hash is invalid.');
    }
    if (
      typeof value.authorityJws !== 'string' ||
      value.authorityJws.length === 0 ||
      value.authorityJws.length > 16 * 1024
    ) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Quote authority signature is invalid.');
    }
    const quote = value.quote;
    if (
      !hasOnlyKeys(quote, [
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
      quote.schemaVersion !== 1
    ) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Accepted quote schema is invalid.');
    }
    assertIdentifier('Quote ID', quote.quoteId);
    assertIdentifier('Quote account ID', quote.accountId);
    assertIdentifier('Quote Run ID', quote.runId);
    assertIdentifier('Quote target ID', quote.targetId);
    assertIdentifier('Quote rate-card version', quote.rateCardVersion);
    assertIdentifier('Quote policy version', quote.policyVersion);
    if (
      typeof quote.maxCreditMinor !== 'number' ||
      !Number.isSafeInteger(quote.maxCreditMinor) ||
      quote.maxCreditMinor <= 0
    ) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Quote maximum charge is invalid.');
    }
    assertIsoDate('Quote expiry', quote.expiresAt);
    assertIsoDate('Quote acceptance time', quote.acceptedAt);
    if (Date.parse(quote.acceptedAt) > Date.parse(quote.expiresAt)) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Quote acceptance cannot follow quote expiry.');
    }
    assertNoSensitiveFields(value);
  }

  private sameEvidence(left: ManagedUsageAcceptedQuoteEvidence, right: ManagedUsageAcceptedQuoteEvidence): boolean {
    return (
      left.schemaVersion === right.schemaVersion &&
      left.acceptanceId === right.acceptanceId &&
      left.authorityId === right.authorityId &&
      left.authorityEventId === right.authorityEventId &&
      left.authorityReference === right.authorityReference &&
      left.environment === right.environment &&
      left.audience === right.audience &&
      left.challengeHash === right.challengeHash &&
      left.authorityJws === right.authorityJws &&
      sameQuote(left.quote, right.quote)
    );
  }
}
