/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { ISqliteDriver } from '../ISqliteDriver';

const MAX_EVENT_BYTES = 32 * 1024;
const MAX_EVENTS_PER_ACCOUNT = 10_000;
const MAX_ID_LENGTH = 200;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const SENSITIVE_FIELD = /(?:secret|token|password|authorization|prompt|credential|api[-_]?key)/i;

export type CreditMinor = number;
export type CreditSource = 'purchased' | 'promotional' | 'adjustment';
export type UsageDimension =
  | 'ai-input'
  | 'ai-cached-input'
  | 'ai-output'
  | 'cloud-cpu'
  | 'cloud-memory'
  | 'cloud-gpu'
  | 'cloud-disk'
  | 'cloud-network'
  | 'cloud-runtime'
  | 'package-capability';
export type UsageConfidence = 'authoritative' | 'estimated';
export type SettlementReason =
  | 'succeeded'
  | 'cancelled'
  | 'provider-fault'
  | 'tomni-fault'
  | 'invalid-input'
  | 'budget-exhausted';

export type CreditGrant = Readonly<{
  schemaVersion: 1;
  grantId: string;
  accountId: string;
  amountMinor: CreditMinor;
  source: CreditSource;
  /** Opaque authoritative ingress reference, never payment credentials. */
  sourceReference: string;
  idempotencyKey: string;
  occurredAt: string;
}>;

export type ManagedUsageQuote = Readonly<{
  schemaVersion: 1;
  quoteId: string;
  accountId: string;
  runId: string;
  targetId: string;
  rateCardVersion: string;
  policyVersion: string;
  maxCreditMinor: CreditMinor;
  expiresAt: string;
  acceptedAt: string;
}>;

export type ManagedUsageReservation = Readonly<{
  schemaVersion: 1;
  reservationId: string;
  quote: ManagedUsageQuote;
  idempotencyKey: string;
  reservedAt: string;
}>;

export type ManagedUsageMeter = Readonly<{
  schemaVersion: 1;
  meterId: string;
  reservationId: string;
  dimension: UsageDimension;
  quantity: number;
  chargedMinor: CreditMinor;
  confidence: UsageConfidence;
  /** Opaque provider usage reference, never provider credentials or request content. */
  providerUsageReference: string;
  idempotencyKey: string;
  observedAt: string;
}>;

export type ManagedUsageSettlement = Readonly<{
  schemaVersion: 1;
  settlementId: string;
  reservationId: string;
  chargedMinor: CreditMinor;
  reason: SettlementReason;
  idempotencyKey: string;
  settledAt: string;
}>;

export type ManagedUsageReconciliation = Readonly<{
  schemaVersion: 1;
  reconciliationId: string;
  reservationId: string;
  providerInvoiceReference: string;
  providerAmountMinor: CreditMinor;
  toleranceMinor: CreditMinor;
  outcome: 'matched' | 'mismatch';
  idempotencyKey: string;
  reconciledAt: string;
}>;

export type ManagedUsageAccountSummary = Readonly<{
  accountId: string;
  creditedMinor: CreditMinor;
  spentMinor: CreditMinor;
  heldMinor: CreditMinor;
  availableMinor: CreditMinor;
  frozen: boolean;
  unresolvedReconciliationIds: readonly string[];
}>;

export type ManagedUsageLedgerOptions = Readonly<{
  createId?: () => string;
  now?: () => number;
}>;

export type ManagedUsageLedgerErrorCode =
  | 'MANAGED_USAGE_INVALID'
  | 'MANAGED_USAGE_CONFLICT'
  | 'MANAGED_USAGE_INSUFFICIENT_CREDIT'
  | 'MANAGED_USAGE_ACCOUNT_FROZEN'
  | 'MANAGED_USAGE_STATE_INVALID'
  | 'MANAGED_USAGE_LEDGER_CORRUPT';

export class ManagedUsageLedgerError extends Error {
  public constructor(
    public readonly code: ManagedUsageLedgerErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ManagedUsageLedgerError';
  }
}

type ManagedUsageEventKind =
  | 'credit-granted'
  | 'credit-reserved'
  | 'usage-metered'
  | 'reservation-settled'
  | 'provider-reconciled';

type PersistedEventRow = Readonly<{
  sequence: number;
  event_id: string;
  idempotency_key: string;
  kind: ManagedUsageEventKind;
  account_id: string;
  reservation_id: string | null;
  external_reference: string | null;
  payload_json: string;
}>;

type ManagedUsageEvent = Readonly<{
  eventId: string;
  idempotencyKey: string;
  kind: ManagedUsageEventKind;
  accountId: string;
  reservationId?: string;
  externalReference?: string;
  payload:
    | CreditGrant
    | ManagedUsageReservation
    | ManagedUsageMeter
    | ManagedUsageSettlement
    | ManagedUsageReconciliation;
}>;

type Snapshot = Readonly<{
  events: readonly ManagedUsageEvent[];
  grants: ReadonlyMap<string, CreditGrant>;
  reservations: ReadonlyMap<string, ManagedUsageReservation>;
  meters: ReadonlyMap<string, readonly ManagedUsageMeter[]>;
  settlements: ReadonlyMap<string, ManagedUsageSettlement>;
  reconciliations: ReadonlyMap<string, readonly ManagedUsageReconciliation[]>;
}>;

const clone = <T>(value: T): T => structuredClone(value);
const serialize = (value: unknown): string => JSON.stringify(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

const assertIdentifier: (label: string, value: unknown) => asserts value is string = (label, value) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_ID_LENGTH ||
    hasControlCharacter(value) ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', `${label} is invalid.`);
  }
};

const assertIsoDate: (label: string, value: unknown) => asserts value is string = (label, value) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', `${label} is invalid.`);
  }
};

const assertMinor: (label: string, value: unknown, positive?: boolean) => asserts value is CreditMinor = (
  label,
  value,
  positive = false
) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    throw new ManagedUsageLedgerError(
      'MANAGED_USAGE_INVALID',
      `${label} must be a ${positive ? 'positive' : 'non-negative'} integer minor-unit amount.`
    );
  }
};

const assertQuantity: (value: unknown) => asserts value is number = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Usage quantity must be a positive safe integer.');
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
        'Managed usage evidence must not contain secret, credential, or prompt fields.'
      );
    }
    assertNoSensitiveFields(child);
  }
};

const sum = (amounts: readonly number[]): number => amounts.reduce((total, amount) => total + amount, 0);

const isUsageDimension = (value: unknown): value is UsageDimension =>
  [
    'ai-input',
    'ai-cached-input',
    'ai-output',
    'cloud-cpu',
    'cloud-memory',
    'cloud-gpu',
    'cloud-disk',
    'cloud-network',
    'cloud-runtime',
    'package-capability',
  ].includes(value as UsageDimension);

const isSettlementReason = (value: unknown): value is SettlementReason =>
  ['succeeded', 'cancelled', 'provider-fault', 'tomni-fault', 'invalid-input', 'budget-exhausted'].includes(
    value as SettlementReason
  );

/**
 * Main-process append-only Credit and managed-usage evidence ledger.
 *
 * This is intentionally not a payment gateway, provider adapter, cloud
 * provisioner, or renderer API. A later owner must feed it only authoritative
 * payment and provider records. It keeps ordinary Store commerce in completely
 * different tables and namespaces.
 */
export class ManagedUsageLedger {
  private readonly createId: () => string;
  private readonly now: () => number;

  public constructor(
    private readonly database: ISqliteDriver,
    options: ManagedUsageLedgerOptions = {}
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.initialize();
  }

  /** Records an already-authorized Credit grant exactly once. It cannot charge or mint through a provider. */
  public recordCreditGrant(input: CreditGrant): CreditGrant {
    this.assertCreditGrant(input);
    return this.transaction(() => {
      const snapshot = this.loadSnapshot();
      const existing = this.findByIdempotency(snapshot, input.idempotencyKey);
      if (existing !== undefined) return this.replay(existing, 'credit-granted', input) as CreditGrant;
      if (snapshot.grants.has(input.grantId)) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'Credit grant ID is already bound to other evidence.'
        );
      }
      this.assertUniqueExternalReference(snapshot, `grant:${input.sourceReference}`);
      this.append(
        'credit-granted',
        input.accountId,
        undefined,
        `grant:${input.sourceReference}`,
        input.idempotencyKey,
        input
      );
      return clone(input);
    });
  }

  /** Atomically holds the accepted maximum before a billable provider or cloud request may be attempted. */
  public reserve(input: ManagedUsageReservation): ManagedUsageReservation {
    this.assertReservation(input);
    return this.transaction(() => {
      const snapshot = this.loadSnapshot();
      const existing = this.findByIdempotency(snapshot, input.idempotencyKey);
      if (existing !== undefined) return this.replay(existing, 'credit-reserved', input) as ManagedUsageReservation;
      if (snapshot.reservations.has(input.reservationId)) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'Reservation ID is already bound to other evidence.'
        );
      }
      if (
        [...snapshot.reservations.values()].some((reservation) => reservation.quote.quoteId === input.quote.quoteId)
      ) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'Quote ID is already bound to another reservation.'
        );
      }
      if (Date.parse(input.quote.expiresAt) <= this.now()) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_STATE_INVALID', 'Expired quotes cannot reserve Credit.');
      }
      if (Date.parse(input.quote.acceptedAt) > this.now()) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_STATE_INVALID', 'Quote acceptance cannot be in the future.');
      }
      const summary = this.accountSummary(snapshot, input.quote.accountId);
      if (summary.frozen) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_ACCOUNT_FROZEN',
          'Managed spending is frozen until an authoritative reconciliation mismatch is resolved.'
        );
      }
      if (summary.availableMinor < input.quote.maxCreditMinor) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_INSUFFICIENT_CREDIT',
          'Credit balance cannot fund this reservation.'
        );
      }
      this.append(
        'credit-reserved',
        input.quote.accountId,
        input.reservationId,
        undefined,
        input.idempotencyKey,
        input
      );
      return clone(input);
    });
  }

  /** Adds one normalized, priced usage observation while the reservation is active. */
  public recordUsage(input: ManagedUsageMeter): ManagedUsageMeter {
    this.assertMeter(input);
    return this.transaction(() => {
      const snapshot = this.loadSnapshot();
      const existing = this.findByIdempotency(snapshot, input.idempotencyKey);
      if (existing !== undefined) return this.replay(existing, 'usage-metered', input) as ManagedUsageMeter;
      const reservation = snapshot.reservations.get(input.reservationId);
      if (reservation === undefined) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_STATE_INVALID', 'Usage requires an existing reservation.');
      }
      if (snapshot.settlements.has(input.reservationId)) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_STATE_INVALID', 'Usage cannot be added after settlement.');
      }
      if (Date.parse(input.observedAt) < Date.parse(reservation.reservedAt)) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_STATE_INVALID', 'Usage cannot predate its reservation.');
      }
      if (
        snapshot.events.some(
          (event) => event.kind === 'usage-metered' && (event.payload as ManagedUsageMeter).meterId === input.meterId
        )
      ) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_CONFLICT', 'Meter ID is already bound to other evidence.');
      }
      this.assertUniqueExternalReference(snapshot, `usage:${input.providerUsageReference}`);
      const existingCharge = sum((snapshot.meters.get(input.reservationId) ?? []).map((meter) => meter.chargedMinor));
      if (existingCharge + input.chargedMinor > reservation.quote.maxCreditMinor) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_STATE_INVALID',
          'Metered usage exceeds the accepted reservation maximum.'
        );
      }
      this.append(
        'usage-metered',
        reservation.quote.accountId,
        input.reservationId,
        `usage:${input.providerUsageReference}`,
        input.idempotencyKey,
        input
      );
      return clone(input);
    });
  }

  /** Settles once and implicitly releases the unused part of the original hold. */
  public settle(input: ManagedUsageSettlement): ManagedUsageSettlement {
    this.assertSettlement(input);
    return this.transaction(() => {
      const snapshot = this.loadSnapshot();
      const existing = this.findByIdempotency(snapshot, input.idempotencyKey);
      if (existing !== undefined) return this.replay(existing, 'reservation-settled', input) as ManagedUsageSettlement;
      const reservation = snapshot.reservations.get(input.reservationId);
      if (reservation === undefined || snapshot.settlements.has(input.reservationId)) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_STATE_INVALID',
          'Reservation is not available for settlement.'
        );
      }
      const meteredCharge = sum((snapshot.meters.get(input.reservationId) ?? []).map((meter) => meter.chargedMinor));
      const latestObservation = Math.max(
        Date.parse(reservation.reservedAt),
        ...(snapshot.meters.get(input.reservationId) ?? []).map((meter) => Date.parse(meter.observedAt))
      );
      if (
        input.chargedMinor !== meteredCharge ||
        input.chargedMinor > reservation.quote.maxCreditMinor ||
        Date.parse(input.settledAt) < latestObservation
      ) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_STATE_INVALID',
          'Settlement must exactly match normalized usage and cannot exceed the accepted maximum.'
        );
      }
      this.append(
        'reservation-settled',
        reservation.quote.accountId,
        input.reservationId,
        undefined,
        input.idempotencyKey,
        input
      );
      return clone(input);
    });
  }

  /**
   * Persists one provider reconciliation outcome. A mismatch is durable and
   * freezes only future managed spending for that account; it never mutates
   * historic Credit, Store, or provider evidence.
   */
  public reconcileProviderUsage(input: Omit<ManagedUsageReconciliation, 'outcome'>): ManagedUsageReconciliation {
    this.assertReconciliationInput(input);
    return this.transaction(() => {
      const snapshot = this.loadSnapshot();
      const reservation = snapshot.reservations.get(input.reservationId);
      if (reservation === undefined || !snapshot.settlements.has(input.reservationId)) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_STATE_INVALID',
          'Only settled reservations can be reconciled.'
        );
      }
      const settlement = snapshot.settlements.get(input.reservationId)!;
      if (Date.parse(input.reconciledAt) < Date.parse(settlement.settledAt)) {
        throw new ManagedUsageLedgerError('MANAGED_USAGE_STATE_INVALID', 'Reconciliation cannot predate settlement.');
      }
      const outcome: ManagedUsageReconciliation['outcome'] =
        Math.abs(settlement.chargedMinor - input.providerAmountMinor) <= input.toleranceMinor ? 'matched' : 'mismatch';
      const complete: ManagedUsageReconciliation = { ...input, schemaVersion: 1, outcome };
      const existing = this.findByIdempotency(snapshot, input.idempotencyKey);
      if (existing !== undefined)
        return this.replay(existing, 'provider-reconciled', complete) as ManagedUsageReconciliation;
      if ((snapshot.reconciliations.get(input.reservationId) ?? []).length > 0) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'A settled reservation can have only one terminal provider reconciliation.'
        );
      }
      if (
        snapshot.events.some(
          (event) =>
            event.kind === 'provider-reconciled' &&
            (event.payload as ManagedUsageReconciliation).reconciliationId === input.reconciliationId
        )
      ) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_CONFLICT',
          'Reconciliation ID is already bound to other evidence.'
        );
      }
      this.assertUniqueExternalReference(snapshot, `invoice:${input.providerInvoiceReference}`);
      this.append(
        'provider-reconciled',
        reservation.quote.accountId,
        input.reservationId,
        `invoice:${input.providerInvoiceReference}`,
        input.idempotencyKey,
        complete
      );
      return clone(complete);
    });
  }

  /** Reconstructs verified balance and freeze state entirely from append-only evidence. */
  public getAccountSummary(accountId: string): ManagedUsageAccountSummary {
    assertIdentifier('Account ID', accountId);
    return this.transaction(() => clone(this.accountSummary(this.loadSnapshot(), accountId)));
  }

  /** Reconstructs one reservation and all directly linked durable evidence after restart. */
  public getReservation(reservationId: string):
    | Readonly<{
        reservation: ManagedUsageReservation;
        meters: readonly ManagedUsageMeter[];
        settlement?: ManagedUsageSettlement;
        reconciliations: readonly ManagedUsageReconciliation[];
      }>
    | undefined {
    assertIdentifier('Reservation ID', reservationId);
    return this.transaction(() => {
      const snapshot = this.loadSnapshot();
      const reservation = snapshot.reservations.get(reservationId);
      if (reservation === undefined) return undefined;
      const settlement = snapshot.settlements.get(reservationId);
      return clone({
        reservation,
        meters: snapshot.meters.get(reservationId) ?? [],
        ...(settlement === undefined ? {} : { settlement }),
        reconciliations: snapshot.reconciliations.get(reservationId) ?? [],
      });
    });
  }

  private initialize(): void {
    this.database.exec(`CREATE TABLE IF NOT EXISTS managed_usage_event_ledger (
      event_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('credit-granted', 'credit-reserved', 'usage-metered', 'reservation-settled', 'provider-reconciled')),
      account_id TEXT NOT NULL,
      reservation_id TEXT,
      external_reference TEXT UNIQUE,
      payload_json TEXT NOT NULL CHECK(length(payload_json) <= ${MAX_EVENT_BYTES})
    )`);
    this.database.exec(
      'CREATE INDEX IF NOT EXISTS idx_managed_usage_event_account ON managed_usage_event_ledger(account_id, event_id)'
    );
    this.database.exec(
      'CREATE INDEX IF NOT EXISTS idx_managed_usage_event_reservation ON managed_usage_event_ledger(reservation_id, event_id)'
    );
  }

  private transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  private append(
    kind: ManagedUsageEventKind,
    accountId: string,
    reservationId: string | undefined,
    externalReference: string | undefined,
    idempotencyKey: string,
    payload: ManagedUsageEvent['payload']
  ): void {
    const eventId = this.createId();
    assertIdentifier('Ledger event ID', eventId);
    const payloadJson = serialize(payload);
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_EVENT_BYTES) {
      throw new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', 'Managed usage evidence exceeds its bounded size.');
    }
    const result = this.database
      .prepare(
        'INSERT INTO managed_usage_event_ledger (event_id, idempotency_key, kind, account_id, reservation_id, external_reference, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(eventId, idempotencyKey, kind, accountId, reservationId ?? null, externalReference ?? null, payloadJson);
    if (result.changes !== 1) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_LEDGER_CORRUPT',
        'Managed usage evidence could not be appended.'
      );
    }
  }

  private loadSnapshot(): Snapshot {
    const rows = this.database
      .prepare(
        'SELECT rowid AS sequence, event_id, idempotency_key, kind, account_id, reservation_id, external_reference, payload_json FROM managed_usage_event_ledger ORDER BY rowid ASC'
      )
      .all() as PersistedEventRow[];
    if (rows.length > MAX_EVENTS_PER_ACCOUNT * 100) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_LEDGER_CORRUPT',
        'Managed usage ledger exceeds its bounded read limit.'
      );
    }
    const events = rows.map((row) => this.parseEvent(row));
    const grants = new Map<string, CreditGrant>();
    const reservations = new Map<string, ManagedUsageReservation>();
    const meters = new Map<string, ManagedUsageMeter[]>();
    const settlements = new Map<string, ManagedUsageSettlement>();
    const reconciliations = new Map<string, ManagedUsageReconciliation[]>();
    const accountCounts = new Map<string, number>();
    const quoteIds = new Set<string>();
    const meterIds = new Set<string>();
    const reconciliationIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    const externalReferences = new Set<string>();

    for (const event of events) {
      if (idempotencyKeys.has(event.idempotencyKey)) throw this.corrupt('Duplicate idempotency evidence.');
      idempotencyKeys.add(event.idempotencyKey);
      if (event.externalReference !== undefined) {
        if (externalReferences.has(event.externalReference))
          throw this.corrupt('Duplicate external reference evidence.');
        externalReferences.add(event.externalReference);
      }
      const count = (accountCounts.get(event.accountId) ?? 0) + 1;
      if (count > MAX_EVENTS_PER_ACCOUNT) {
        throw new ManagedUsageLedgerError(
          'MANAGED_USAGE_LEDGER_CORRUPT',
          'Managed usage account evidence exceeds its limit.'
        );
      }
      accountCounts.set(event.accountId, count);
      switch (event.kind) {
        case 'credit-granted': {
          const grant = event.payload as CreditGrant;
          if (grants.has(grant.grantId)) throw this.corrupt('Duplicate Credit grant evidence.');
          grants.set(grant.grantId, grant);
          break;
        }
        case 'credit-reserved': {
          const reservation = event.payload as ManagedUsageReservation;
          if (reservations.has(reservation.reservationId) || quoteIds.has(reservation.quote.quoteId)) {
            throw this.corrupt('Duplicate reservation or quote evidence.');
          }
          reservations.set(reservation.reservationId, reservation);
          quoteIds.add(reservation.quote.quoteId);
          break;
        }
        case 'usage-metered': {
          const meter = event.payload as ManagedUsageMeter;
          const reservation = reservations.get(meter.reservationId);
          if (
            meterIds.has(meter.meterId) ||
            reservation === undefined ||
            event.accountId !== reservation.quote.accountId ||
            settlements.has(meter.reservationId)
          ) {
            throw this.corrupt('Invalid metered usage evidence.');
          }
          if (Date.parse(meter.observedAt) < Date.parse(reservation.reservedAt)) {
            throw this.corrupt('Usage predates its reservation.');
          }
          const collection = meters.get(meter.reservationId) ?? [];
          collection.push(meter);
          if (sum(collection.map((recordedMeter) => recordedMeter.chargedMinor)) > reservation.quote.maxCreditMinor) {
            throw this.corrupt('Metered usage exceeds the accepted reservation maximum.');
          }
          meters.set(meter.reservationId, collection);
          meterIds.add(meter.meterId);
          break;
        }
        case 'reservation-settled': {
          const settlement = event.payload as ManagedUsageSettlement;
          const reservation = reservations.get(settlement.reservationId);
          if (
            reservation === undefined ||
            event.accountId !== reservation.quote.accountId ||
            settlements.has(settlement.reservationId)
          ) {
            throw this.corrupt('Invalid settlement evidence.');
          }
          const metered = sum((meters.get(settlement.reservationId) ?? []).map((meter) => meter.chargedMinor));
          const maximum = reservation.quote.maxCreditMinor;
          const latestObservation = Math.max(
            Date.parse(reservation.reservedAt),
            ...(meters.get(settlement.reservationId) ?? []).map((meter) => Date.parse(meter.observedAt))
          );
          if (
            settlement.chargedMinor !== metered ||
            settlement.chargedMinor > maximum ||
            Date.parse(settlement.settledAt) < latestObservation
          ) {
            throw this.corrupt('Settlement does not match bounded metered usage.');
          }
          settlements.set(settlement.reservationId, settlement);
          break;
        }
        case 'provider-reconciled': {
          const reconciliation = event.payload as ManagedUsageReconciliation;
          const reservation = reservations.get(reconciliation.reservationId);
          const settlement = settlements.get(reconciliation.reservationId);
          if (
            reconciliationIds.has(reconciliation.reconciliationId) ||
            reservation === undefined ||
            event.accountId !== reservation.quote.accountId ||
            settlement === undefined ||
            (reconciliations.get(reconciliation.reservationId) ?? []).length > 0
          ) {
            throw this.corrupt('Invalid provider reconciliation evidence.');
          }
          const expectedOutcome: ManagedUsageReconciliation['outcome'] =
            Math.abs(settlement.chargedMinor - reconciliation.providerAmountMinor) <= reconciliation.toleranceMinor
              ? 'matched'
              : 'mismatch';
          if (
            reconciliation.outcome !== expectedOutcome ||
            Date.parse(reconciliation.reconciledAt) < Date.parse(settlement.settledAt)
          )
            throw this.corrupt('Provider reconciliation outcome is invalid.');
          const collection = reconciliations.get(reconciliation.reservationId) ?? [];
          collection.push(reconciliation);
          reconciliations.set(reconciliation.reservationId, collection);
          reconciliationIds.add(reconciliation.reconciliationId);
          break;
        }
      }
    }
    return { events, grants, reservations, meters, settlements, reconciliations };
  }

  private parseEvent(row: PersistedEventRow): ManagedUsageEvent {
    try {
      if (!Number.isSafeInteger(row.sequence) || row.sequence <= 0) throw new Error('Invalid persisted sequence.');
      assertIdentifier('Persisted ledger event ID', row.event_id);
      assertIdentifier('Persisted idempotency key', row.idempotency_key);
      assertIdentifier('Persisted account ID', row.account_id);
      if (
        row.kind !== 'credit-granted' &&
        row.kind !== 'credit-reserved' &&
        row.kind !== 'usage-metered' &&
        row.kind !== 'reservation-settled' &&
        row.kind !== 'provider-reconciled'
      ) {
        throw new Error('Unknown event kind.');
      }
      if (typeof row.payload_json !== 'string' || Buffer.byteLength(row.payload_json, 'utf8') > MAX_EVENT_BYTES) {
        throw new Error('Invalid persisted payload size.');
      }
      const payload = JSON.parse(row.payload_json) as unknown;
      let verified:
        | CreditGrant
        | ManagedUsageReservation
        | ManagedUsageMeter
        | ManagedUsageSettlement
        | ManagedUsageReconciliation;
      switch (row.kind) {
        case 'credit-granted':
          this.assertCreditGrant(payload);
          verified = payload;
          if (
            verified.accountId !== row.account_id ||
            row.reservation_id !== null ||
            row.external_reference !== `grant:${verified.sourceReference}`
          ) {
            throw new Error('Grant row mismatch.');
          }
          break;
        case 'credit-reserved':
          this.assertReservation(payload);
          verified = payload;
          if (
            verified.quote.accountId !== row.account_id ||
            verified.reservationId !== row.reservation_id ||
            row.external_reference !== null
          ) {
            throw new Error('Reservation row mismatch.');
          }
          break;
        case 'usage-metered':
          this.assertMeter(payload);
          verified = payload;
          if (
            verified.reservationId !== row.reservation_id ||
            row.external_reference !== `usage:${verified.providerUsageReference}`
          ) {
            throw new Error('Meter row mismatch.');
          }
          break;
        case 'reservation-settled':
          this.assertSettlement(payload);
          verified = payload;
          if (verified.reservationId !== row.reservation_id || row.external_reference !== null) {
            throw new Error('Settlement row mismatch.');
          }
          break;
        case 'provider-reconciled':
          this.assertReconciliation(payload);
          verified = payload;
          if (
            verified.reservationId !== row.reservation_id ||
            row.external_reference !== `invoice:${verified.providerInvoiceReference}`
          ) {
            throw new Error('Reconciliation row mismatch.');
          }
          break;
      }
      if (verified.idempotencyKey !== row.idempotency_key) throw new Error('Idempotency row mismatch.');
      return {
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key,
        kind: row.kind,
        accountId: row.account_id,
        ...(row.reservation_id === null ? {} : { reservationId: row.reservation_id }),
        ...(row.external_reference === null ? {} : { externalReference: row.external_reference }),
        payload: verified,
      };
    } catch (error) {
      if (error instanceof ManagedUsageLedgerError && error.code === 'MANAGED_USAGE_LEDGER_CORRUPT') throw error;
      throw new ManagedUsageLedgerError('MANAGED_USAGE_LEDGER_CORRUPT', 'Managed usage evidence is corrupt.', {
        cause: error,
      });
    }
  }

  private accountSummary(snapshot: Snapshot, accountId: string): ManagedUsageAccountSummary {
    const credited = sum(
      [...snapshot.grants.values()].filter((grant) => grant.accountId === accountId).map((grant) => grant.amountMinor)
    );
    const reservations = [...snapshot.reservations.values()].filter(
      (reservation) => reservation.quote.accountId === accountId
    );
    const spent = sum(
      reservations
        .map((reservation) => snapshot.settlements.get(reservation.reservationId))
        .filter((settlement): settlement is ManagedUsageSettlement => settlement !== undefined)
        .map((settlement) => settlement.chargedMinor)
    );
    const held = sum(
      reservations
        .filter((reservation) => !snapshot.settlements.has(reservation.reservationId))
        .map((reservation) => reservation.quote.maxCreditMinor)
    );
    const unresolved = reservations.flatMap((reservation) =>
      (snapshot.reconciliations.get(reservation.reservationId) ?? [])
        .filter((reconciliation) => reconciliation.outcome === 'mismatch')
        .map((reconciliation) => reconciliation.reconciliationId)
    );
    const available = credited - spent - held;
    if (!Number.isSafeInteger(available) || available < 0) throw this.corrupt('Credit balance is negative or unsafe.');
    return {
      accountId,
      creditedMinor: credited,
      spentMinor: spent,
      heldMinor: held,
      availableMinor: available,
      frozen: unresolved.length > 0,
      unresolvedReconciliationIds: unresolved.toSorted(),
    };
  }

  private findByIdempotency(snapshot: Snapshot, idempotencyKey: string): ManagedUsageEvent | undefined {
    return snapshot.events.find((event) => event.idempotencyKey === idempotencyKey);
  }

  private replay(
    existing: ManagedUsageEvent,
    kind: ManagedUsageEventKind,
    expected: ManagedUsageEvent['payload']
  ): ManagedUsageEvent['payload'] {
    if (existing.kind !== kind || serialize(existing.payload) !== serialize(expected)) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_CONFLICT',
        'Idempotency key is already bound to different authoritative evidence.'
      );
    }
    return clone(existing.payload);
  }

  private assertUniqueExternalReference(snapshot: Snapshot, reference: string): void {
    if (snapshot.events.some((event) => event.externalReference === reference)) {
      throw new ManagedUsageLedgerError(
        'MANAGED_USAGE_CONFLICT',
        'External authoritative reference is already bound to other evidence.'
      );
    }
  }

  private assertCreditGrant(value: unknown): asserts value is CreditGrant {
    if (!isRecord(value) || value.schemaVersion !== 1) throw this.invalid('Credit grant schema is invalid.');
    assertIdentifier('Credit grant ID', value.grantId);
    assertIdentifier('Credit grant account ID', value.accountId);
    assertMinor('Credit grant amount', value.amountMinor, true);
    if (value.source !== 'purchased' && value.source !== 'promotional' && value.source !== 'adjustment') {
      throw this.invalid('Credit grant source is invalid.');
    }
    assertIdentifier('Credit grant source reference', value.sourceReference);
    assertIdentifier('Credit grant idempotency key', value.idempotencyKey);
    assertIsoDate('Credit grant occurred at', value.occurredAt);
    assertNoSensitiveFields(value);
  }

  private assertReservation(value: unknown): asserts value is ManagedUsageReservation {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.quote))
      throw this.invalid('Reservation schema is invalid.');
    assertIdentifier('Reservation ID', value.reservationId);
    assertIdentifier('Reservation idempotency key', value.idempotencyKey);
    assertIsoDate('Reservation time', value.reservedAt);
    const quote = value.quote;
    if (quote.schemaVersion !== 1) throw this.invalid('Quote schema is invalid.');
    assertIdentifier('Quote ID', quote.quoteId);
    assertIdentifier('Quote account ID', quote.accountId);
    assertIdentifier('Quote Run ID', quote.runId);
    assertIdentifier('Quote target ID', quote.targetId);
    assertIdentifier('Quote rate-card version', quote.rateCardVersion);
    assertIdentifier('Quote policy version', quote.policyVersion);
    assertMinor('Quote maximum charge', quote.maxCreditMinor, true);
    assertIsoDate('Quote expiry', quote.expiresAt);
    assertIsoDate('Quote acceptance time', quote.acceptedAt);
    if (
      Date.parse(quote.acceptedAt) > Date.parse(value.reservedAt) ||
      Date.parse(value.reservedAt) > Date.parse(quote.expiresAt)
    ) {
      throw this.invalid('Reservation is outside the accepted quote lifetime.');
    }
    assertNoSensitiveFields(value);
  }

  private assertMeter(value: unknown): asserts value is ManagedUsageMeter {
    if (!isRecord(value) || value.schemaVersion !== 1) throw this.invalid('Usage meter schema is invalid.');
    assertIdentifier('Meter ID', value.meterId);
    assertIdentifier('Meter reservation ID', value.reservationId);
    if (!isUsageDimension(value.dimension)) throw this.invalid('Usage dimension is invalid.');
    assertQuantity(value.quantity);
    assertMinor('Metered charge', value.chargedMinor);
    if (value.confidence !== 'authoritative' && value.confidence !== 'estimated') {
      throw this.invalid('Usage confidence is invalid.');
    }
    assertIdentifier('Provider usage reference', value.providerUsageReference);
    assertIdentifier('Meter idempotency key', value.idempotencyKey);
    assertIsoDate('Usage observation time', value.observedAt);
    assertNoSensitiveFields(value);
  }

  private assertSettlement(value: unknown): asserts value is ManagedUsageSettlement {
    if (!isRecord(value) || value.schemaVersion !== 1) throw this.invalid('Settlement schema is invalid.');
    assertIdentifier('Settlement ID', value.settlementId);
    assertIdentifier('Settlement reservation ID', value.reservationId);
    assertMinor('Settlement charge', value.chargedMinor);
    if (!isSettlementReason(value.reason)) throw this.invalid('Settlement reason is invalid.');
    assertIdentifier('Settlement idempotency key', value.idempotencyKey);
    assertIsoDate('Settlement time', value.settledAt);
    assertNoSensitiveFields(value);
  }

  private assertReconciliationInput(
    value: Omit<ManagedUsageReconciliation, 'outcome'>
  ): asserts value is Omit<ManagedUsageReconciliation, 'outcome'> {
    if (!isRecord(value) || value.schemaVersion !== 1) throw this.invalid('Reconciliation schema is invalid.');
    assertIdentifier('Reconciliation ID', value.reconciliationId);
    assertIdentifier('Reconciliation reservation ID', value.reservationId);
    assertIdentifier('Provider invoice reference', value.providerInvoiceReference);
    assertMinor('Provider amount', value.providerAmountMinor);
    assertMinor('Reconciliation tolerance', value.toleranceMinor);
    assertIdentifier('Reconciliation idempotency key', value.idempotencyKey);
    assertIsoDate('Reconciliation time', value.reconciledAt);
    assertNoSensitiveFields(value);
  }

  private assertReconciliation(value: unknown): asserts value is ManagedUsageReconciliation {
    this.assertReconciliationInput(value as Omit<ManagedUsageReconciliation, 'outcome'>);
    if (!isRecord(value) || (value.outcome !== 'matched' && value.outcome !== 'mismatch')) {
      throw this.invalid('Reconciliation outcome is invalid.');
    }
  }

  private invalid(message: string): ManagedUsageLedgerError {
    return new ManagedUsageLedgerError('MANAGED_USAGE_INVALID', message);
  }

  private corrupt(message: string): ManagedUsageLedgerError {
    return new ManagedUsageLedgerError('MANAGED_USAGE_LEDGER_CORRUPT', message);
  }
}
