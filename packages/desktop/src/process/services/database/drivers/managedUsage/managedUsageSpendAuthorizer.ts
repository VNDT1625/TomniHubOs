/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { ManagedUsageLedgerError } from './managedUsageLedger';
import type { ManagedUsageLedger, ManagedUsageQuote, ManagedUsageReservation } from './managedUsageLedger';

const MAX_ID_LENGTH = 200;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

export type ManagedUsageSpendAuthorizationRequest = Readonly<{
  schemaVersion: 1;
  /** This becomes the durable reservation ID and is never reused for another quote. */
  authorizationId: string;
  idempotencyKey: string;
  /**
   * The exact accepted quote selected by the Main-owned Run/Billing owner. It
   * is compared with the resolver's immutable authoritative record; it is not
   * a price proposal supplied by a renderer, package, or provider.
   */
  quote: ManagedUsageQuote;
}>;

export type ManagedUsageSpendAuthorization = Readonly<{
  schemaVersion: 1;
  authorizationId: string;
  reservation: ManagedUsageReservation;
}>;

export type ManagedUsageSpendAuthorizerOptions = Readonly<{
  /** Main-only lookup of an immutable, previously accepted quote. */
  resolveAcceptedQuote: (quoteId: string) => ManagedUsageQuote | undefined;
  now?: () => number;
}>;

const assertIdentifier: (label: string, value: unknown) => asserts value is string = (label, value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH || !SAFE_IDENTIFIER.test(value)) {
    throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', `${label} is invalid.`);
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
 * Main-process-only admission seam for paid managed usage.
 *
 * It refuses self-described prices: every request must byte-for-field match a
 * Main-owned accepted quote, then creates the append-only ledger reservation
 * before a future provider or provisioner could be called. This class exposes
 * no IPC, checkout, provider, cloud, or network capability.
 */
export class ManagedUsageSpendAuthorizer {
  private readonly now: () => number;

  public constructor(
    private readonly ledger: ManagedUsageLedger,
    private readonly options: ManagedUsageSpendAuthorizerOptions
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Reserves the accepted maximum exactly once. A retry is replayed from its
   * durable reservation even after the quote has expired; a new authorization
   * against that expired quote is denied.
   */
  public authorize(input: ManagedUsageSpendAuthorizationRequest): ManagedUsageSpendAuthorization {
    this.assertRequest(input);

    const existing = this.ledger.getReservation(input.authorizationId);
    if (existing !== undefined) {
      if (
        existing.reservation.idempotencyKey !== input.idempotencyKey ||
        !sameQuote(existing.reservation.quote, input.quote)
      ) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'Authorization ID is already bound to different accepted quote evidence.'
        );
      }
      return {
        schemaVersion: 1,
        authorizationId: input.authorizationId,
        reservation: existing.reservation,
      };
    }

    const authoritativeQuote = this.options.resolveAcceptedQuote(input.quote.quoteId);
    if (authoritativeQuote === undefined || !sameQuote(authoritativeQuote, input.quote)) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_STATE_INVALID',
        'Managed spending requires one exact Main-owned accepted quote.'
      );
    }

    const now = this.now();
    const acceptedAt = Date.parse(authoritativeQuote.acceptedAt);
    const expiresAt = Date.parse(authoritativeQuote.expiresAt);
    if (!Number.isFinite(now) || !Number.isFinite(acceptedAt) || !Number.isFinite(expiresAt)) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Accepted quote time is invalid.');
    }
    if (acceptedAt > now || expiresAt <= now) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_STATE_INVALID',
        'Managed spending requires an accepted, unexpired quote.'
      );
    }

    const reservation = this.ledger.reserve({
      schemaVersion: 1,
      reservationId: input.authorizationId,
      quote: authoritativeQuote,
      idempotencyKey: input.idempotencyKey,
      reservedAt: new Date(now).toISOString(),
    });
    return {
      schemaVersion: 1,
      authorizationId: input.authorizationId,
      reservation,
    };
  }

  private assertRequest(value: ManagedUsageSpendAuthorizationRequest): void {
    if (
      value === null ||
      typeof value !== 'object' ||
      value.schemaVersion !== 1 ||
      value.quote === null ||
      typeof value.quote !== 'object'
    ) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Spend authorization schema is invalid.');
    }
    assertIdentifier('Spend authorization ID', value.authorizationId);
    assertIdentifier('Spend authorization idempotency key', value.idempotencyKey);
    assertIdentifier('Spend authorization quote ID', value.quote.quoteId);
  }
}
