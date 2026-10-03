import { describe, expect, it } from 'vitest';
import type { ISqliteDriver, IStatement } from '@process/services/database/drivers/ISqliteDriver';
import {
  ManagedUsageLedger,
  ManagedUsageLedgerError,
  type CreditGrant,
  type ManagedUsageReservation,
} from '@process/services/database/drivers/managedUsage/managedUsageLedger';
import {
  ManagedUsageSpendAuthorizer,
  type ManagedUsageSpendAuthorizationRequest,
} from '@process/services/database/drivers/managedUsage/managedUsageSpendAuthorizer';
import {
  ManagedUsageAcceptedQuoteStore,
  type ManagedUsageAcceptedQuoteEvidence,
} from '@process/services/database/drivers/managedUsage/managedUsageAcceptedQuoteStore';

type PersistedEvent = {
  idempotencyKey: string;
  kind: string;
  accountId: string;
  reservationId: string | null;
  externalReference: string | null;
  payload: string;
};

type ManagedUsageDatabase = {
  events: Map<string, PersistedEvent>;
  acceptedQuotes: Map<string, string>;
};

/** Restart-safe contract double; production uses the main-process SQLite driver. */
class ManagedUsageDriver implements ISqliteDriver {
  public constructor(private readonly state: ManagedUsageDatabase) {}

  public prepare(sql: string): IStatement {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      get: () => undefined,
      all: () => {
        if (normalized.includes('FROM managed_usage_event_ledger')) {
          return [...this.state.events.entries()].map(([eventId, record], index) => ({
            sequence: index + 1,
            event_id: eventId,
            idempotency_key: record.idempotencyKey,
            kind: record.kind,
            account_id: record.accountId,
            reservation_id: record.reservationId,
            external_reference: record.externalReference,
            payload_json: record.payload,
          }));
        }
        if (normalized.includes('FROM managed_usage_accepted_quote_evidence')) {
          return [...this.state.acceptedQuotes.entries()].map(([acceptanceId, payload]) => {
            const evidence = JSON.parse(payload) as ManagedUsageAcceptedQuoteEvidence;
            return {
              acceptance_id: acceptanceId,
              quote_id: evidence.quote.quoteId,
              account_id: evidence.quote.accountId,
              authority_id: evidence.authorityId,
              authority_reference: evidence.authorityReference,
              accepted_at: evidence.quote.acceptedAt,
              payload_json: payload,
            };
          });
        }
        throw new Error(`Unsupported statement: ${normalized}`);
      },
      run: (...args: unknown[]) => {
        if (normalized.startsWith('INSERT INTO managed_usage_event_ledger')) {
          const [eventId, idempotencyKey, kind, accountId, reservationId, externalReference, payload] = args;
          this.state.events.set(String(eventId), {
            idempotencyKey: String(idempotencyKey),
            kind: String(kind),
            accountId: String(accountId),
            reservationId: reservationId === null ? null : String(reservationId),
            externalReference: externalReference === null ? null : String(externalReference),
            payload: String(payload),
          });
          return { changes: 1, lastInsertRowid: 1 };
        }
        if (normalized.startsWith('INSERT INTO managed_usage_accepted_quote_evidence')) {
          const [acceptanceId, _quoteId, _accountId, _authorityId, _authorityReference, _acceptedAt, payload] = args;
          this.state.acceptedQuotes.set(String(acceptanceId), String(payload));
          return { changes: 1, lastInsertRowid: 1 };
        }
        throw new Error(`Unsupported statement: ${normalized}`);
      },
    };
  }

  public exec(_sql: string): void {}
  public pragma(_sql: string, _options?: { simple?: boolean }): unknown {
    return undefined;
  }
  public transaction<T>(operation: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return operation;
  }
  public close(): void {}
}

const grant = (suffix = '1', amountMinor = 1_000): CreditGrant => ({
  schemaVersion: 1,
  grantId: `grant-${suffix}`,
  accountId: 'account-1',
  amountMinor,
  source: 'purchased',
  sourceReference: `payment-${suffix}`,
  idempotencyKey: `grant-key-${suffix}`,
  occurredAt: '2026-08-21T00:00:00.000Z',
});

const reservation = (suffix = '1', maxCreditMinor = 400): ManagedUsageReservation => ({
  schemaVersion: 1,
  reservationId: `reservation-${suffix}`,
  quote: {
    schemaVersion: 1,
    quoteId: `quote-${suffix}`,
    accountId: 'account-1',
    runId: `run-${suffix}`,
    targetId: 'managed-standard',
    rateCardVersion: 'rate-card-v1',
    policyVersion: 'managed-usage-v1',
    maxCreditMinor,
    expiresAt: '2026-08-21T01:00:00.000Z',
    acceptedAt: '2026-08-21T00:00:00.000Z',
  },
  idempotencyKey: `reservation-key-${suffix}`,
  reservedAt: '2026-08-21T00:00:01.000Z',
});

const createLedger = () => {
  const state: ManagedUsageDatabase = { events: new Map(), acceptedQuotes: new Map() };
  let count = 0;
  const open = () =>
    new ManagedUsageLedger(new ManagedUsageDriver(state), {
      createId: () => `event-${++count}`,
      now: () => Date.parse('2026-08-21T00:05:00.000Z'),
    });
  return { open, state };
};

describe('ManagedUsageLedger', () => {
  it('keeps integer Credit, reservation, metering, settlement, and reconciliation evidence recoverable across restart', () => {
    const { open, state } = createLedger();
    const first = open();
    first.recordCreditGrant(grant());
    first.reserve(reservation());
    first.recordUsage({
      schemaVersion: 1,
      meterId: 'meter-1',
      reservationId: 'reservation-1',
      dimension: 'ai-input',
      quantity: 10,
      chargedMinor: 125,
      confidence: 'authoritative',
      providerUsageReference: 'usage-1',
      idempotencyKey: 'meter-key-1',
      observedAt: '2026-08-21T00:10:00.000Z',
    });
    first.recordUsage({
      schemaVersion: 1,
      meterId: 'meter-2',
      reservationId: 'reservation-1',
      dimension: 'ai-output',
      quantity: 5,
      chargedMinor: 75,
      confidence: 'authoritative',
      providerUsageReference: 'usage-2',
      idempotencyKey: 'meter-key-2',
      observedAt: '2026-08-21T00:10:01.000Z',
    });
    first.settle({
      schemaVersion: 1,
      settlementId: 'settlement-1',
      reservationId: 'reservation-1',
      chargedMinor: 200,
      reason: 'succeeded',
      idempotencyKey: 'settlement-key-1',
      settledAt: '2026-08-21T00:11:00.000Z',
    });

    const reconciled = first.reconcileProviderUsage({
      schemaVersion: 1,
      reconciliationId: 'reconciliation-1',
      reservationId: 'reservation-1',
      providerInvoiceReference: 'invoice-1',
      providerAmountMinor: 201,
      toleranceMinor: 1,
      idempotencyKey: 'reconciliation-key-1',
      reconciledAt: '2026-08-21T00:12:00.000Z',
    });
    expect(reconciled.outcome).toBe('matched');
    expect(state.events).toHaveLength(6);

    const restarted = open();
    expect(restarted.getAccountSummary('account-1')).toEqual({
      accountId: 'account-1',
      creditedMinor: 1_000,
      spentMinor: 200,
      heldMinor: 0,
      availableMinor: 800,
      frozen: false,
      unresolvedReconciliationIds: [],
    });
    expect(restarted.getReservation('reservation-1')).toMatchObject({
      reservation: { quote: { maxCreditMinor: 400 } },
      meters: [expect.objectContaining({ chargedMinor: 125 }), expect.objectContaining({ chargedMinor: 75 })],
      settlement: { chargedMinor: 200 },
      reconciliations: [{ outcome: 'matched' }],
    });
  });

  it('is idempotent only for byte-equivalent evidence and never permits double reservation or settlement', () => {
    const { open, state } = createLedger();
    const ledger = open();
    ledger.recordCreditGrant(grant());
    const held = reservation();
    expect(ledger.reserve(held)).toEqual(held);
    expect(ledger.reserve(held)).toEqual(held);
    expect(state.events).toHaveLength(2);
    expect(() => ledger.reserve({ ...held, quote: { ...held.quote, maxCreditMinor: 401 } })).toThrow(
      ManagedUsageLedgerError
    );
    expect(() => ledger.reserve(reservation('same-quote', 400))).not.toThrow();
    expect(() => ledger.reserve({ ...reservation('another', 400), quote: { ...held.quote } })).toThrow(/Quote ID/i);
    expect(ledger.getAccountSummary('account-1').heldMinor).toBe(800);
  });

  it('fails closed before provider use when funds, expiry, or bounded metering state are invalid', () => {
    const { open } = createLedger();
    const ledger = open();
    ledger.recordCreditGrant(grant('small', 100));
    expect(() => ledger.reserve(reservation('too-large', 101))).toThrow(/cannot fund/i);
    expect(() =>
      ledger.reserve({
        ...reservation('expired'),
        quote: { ...reservation('expired').quote, expiresAt: '2026-08-21T00:04:59.000Z' },
      })
    ).toThrow(/Expired quotes/i);
    ledger.reserve(reservation('bounded', 100));
    expect(() =>
      ledger.recordUsage({
        schemaVersion: 1,
        meterId: 'meter-over',
        reservationId: 'reservation-bounded',
        dimension: 'cloud-runtime',
        quantity: 1,
        chargedMinor: 101,
        confidence: 'authoritative',
        providerUsageReference: 'usage-over',
        idempotencyKey: 'meter-key-over',
        observedAt: '2026-08-21T00:10:00.000Z',
      })
    ).toThrow(/exceeds the accepted reservation maximum/i);
  });

  it('durably freezes only future managed spending when provider reconciliation mismatches', () => {
    const { open } = createLedger();
    const ledger = open();
    ledger.recordCreditGrant(grant());
    ledger.reserve(reservation());
    ledger.settle({
      schemaVersion: 1,
      settlementId: 'settlement-zero',
      reservationId: 'reservation-1',
      chargedMinor: 0,
      reason: 'provider-fault',
      idempotencyKey: 'settlement-key-zero',
      settledAt: '2026-08-21T00:11:00.000Z',
    });
    expect(
      ledger.reconcileProviderUsage({
        schemaVersion: 1,
        reconciliationId: 'reconciliation-mismatch',
        reservationId: 'reservation-1',
        providerInvoiceReference: 'invoice-mismatch',
        providerAmountMinor: 10,
        toleranceMinor: 0,
        idempotencyKey: 'reconciliation-key-mismatch',
        reconciledAt: '2026-08-21T00:12:00.000Z',
      })
    ).toMatchObject({ outcome: 'mismatch' });
    expect(ledger.getAccountSummary('account-1')).toMatchObject({ frozen: true });
    expect(() => ledger.reserve(reservation('after-freeze'))).toThrow(/frozen/i);
  });

  it('permits one idempotent terminal provider reconciliation per reservation across restart', () => {
    const { open } = createLedger();
    const first = open();
    first.recordCreditGrant(grant());
    first.reserve(reservation());
    first.settle({
      schemaVersion: 1,
      settlementId: 'settlement-terminal',
      reservationId: 'reservation-1',
      chargedMinor: 0,
      reason: 'provider-fault',
      idempotencyKey: 'settlement-key-terminal',
      settledAt: '2026-08-21T00:11:00.000Z',
    });
    const reconciliation = {
      schemaVersion: 1 as const,
      reconciliationId: 'reconciliation-terminal',
      reservationId: 'reservation-1',
      providerInvoiceReference: 'invoice-terminal',
      providerAmountMinor: 0,
      toleranceMinor: 0,
      idempotencyKey: 'reconciliation-key-terminal',
      reconciledAt: '2026-08-21T00:12:00.000Z',
    };
    expect(first.reconcileProviderUsage(reconciliation)).toMatchObject({ outcome: 'matched' });

    const restarted = open();
    expect(restarted.reconcileProviderUsage(reconciliation)).toMatchObject({ outcome: 'matched' });
    expect(() =>
      restarted.reconcileProviderUsage({
        ...reconciliation,
        reconciliationId: 'reconciliation-second-invoice',
        providerInvoiceReference: 'invoice-second',
        idempotencyKey: 'reconciliation-key-second',
      })
    ).toThrow(/only one terminal provider reconciliation/i);
  });

  it('fails closed on a tampered append-only event stream', () => {
    const { open, state } = createLedger();
    open().recordCreditGrant(grant());
    const event = state.events.get('event-1');
    if (event === undefined) throw new Error('Expected test event.');
    event.payload = JSON.stringify({ ...grant(), amountMinor: 1.5 });
    expect(() => open().getAccountSummary('account-1')).toThrow(/evidence is corrupt/i);
  });

  it('fails closed on restart when tampered pending meters exceed the accepted reservation maximum', () => {
    const { open, state } = createLedger();
    const ledger = open();
    ledger.recordCreditGrant(grant());
    ledger.reserve(reservation());
    ledger.recordUsage({
      schemaVersion: 1,
      meterId: 'meter-pending-1',
      reservationId: 'reservation-1',
      dimension: 'ai-input',
      quantity: 1,
      chargedMinor: 200,
      confidence: 'authoritative',
      providerUsageReference: 'usage-pending-1',
      idempotencyKey: 'meter-key-pending-1',
      observedAt: '2026-08-21T00:10:00.000Z',
    });
    ledger.recordUsage({
      schemaVersion: 1,
      meterId: 'meter-pending-2',
      reservationId: 'reservation-1',
      dimension: 'ai-output',
      quantity: 1,
      chargedMinor: 200,
      confidence: 'authoritative',
      providerUsageReference: 'usage-pending-2',
      idempotencyKey: 'meter-key-pending-2',
      observedAt: '2026-08-21T00:10:01.000Z',
    });
    const secondMeter = state.events.get('event-4');
    if (secondMeter === undefined) throw new Error('Expected second pending meter evidence.');
    secondMeter.payload = JSON.stringify({ ...JSON.parse(secondMeter.payload), chargedMinor: 201 });

    expect(() => open().getAccountSummary('account-1')).toThrow(
      /Metered usage exceeds the accepted reservation maximum/i
    );
  });
  it('authorizes only an exact Main-owned accepted quote before spend, with durable idempotency', () => {
    const { open, state } = createLedger();
    const ledger = open();
    ledger.recordCreditGrant(grant());
    const quote = reservation().quote;
    const request: ManagedUsageSpendAuthorizationRequest = {
      schemaVersion: 1,
      authorizationId: 'authorization-1',
      idempotencyKey: 'authorization-key-1',
      quote,
    };
    const authorizer = new ManagedUsageSpendAuthorizer(ledger, {
      now: () => Date.parse('2026-08-21T00:05:00.000Z'),
      resolveAcceptedQuote: (quoteId) => (quoteId === quote.quoteId ? quote : undefined),
    });

    expect(authorizer.authorize(request)).toMatchObject({
      authorizationId: 'authorization-1',
      reservation: { reservationId: 'authorization-1', quote },
    });
    expect(authorizer.authorize(request)).toMatchObject({ authorizationId: 'authorization-1' });
    expect(state.events).toHaveLength(2);
    expect(() =>
      authorizer.authorize({ ...request, quote: { ...quote, maxCreditMinor: quote.maxCreditMinor + 1 } })
    ).toThrow(/already bound/i);
    expect(() => authorizer.authorize({ ...request, authorizationId: 'authorization-alias' })).toThrow(
      /idempotency key/i
    );

    const restarted = new ManagedUsageSpendAuthorizer(open(), {
      now: () => Date.parse('2026-08-21T02:00:00.000Z'),
      resolveAcceptedQuote: () => {
        throw new Error('A durable idempotent replay must not look up a new quote.');
      },
    });
    expect(restarted.authorize(request)).toMatchObject({ authorizationId: 'authorization-1' });
  });

  it('fails closed when an authorization quote is expired, absent, or differs from Main-owned evidence', () => {
    const { open } = createLedger();
    const ledger = open();
    ledger.recordCreditGrant(grant());
    const quote = reservation().quote;
    const expiredQuote = { ...quote, quoteId: 'quote-expired', expiresAt: '2026-08-21T00:04:59.000Z' };
    expect(() =>
      new ManagedUsageSpendAuthorizer(ledger, {
        now: () => Date.parse('2026-08-21T00:05:00.000Z'),
        resolveAcceptedQuote: () => expiredQuote,
      }).authorize({
        schemaVersion: 1,
        authorizationId: 'authorization-expired',
        idempotencyKey: 'authorization-key-expired',
        quote: expiredQuote,
      })
    ).toThrow(/accepted, unexpired quote/i);
    expect(() =>
      new ManagedUsageSpendAuthorizer(ledger, {
        now: () => Date.parse('2026-08-21T00:05:00.000Z'),
        resolveAcceptedQuote: () => undefined,
      }).authorize({
        schemaVersion: 1,
        authorizationId: 'authorization-missing',
        idempotencyKey: 'authorization-key-missing',
        quote,
      })
    ).toThrow(/exact Main-owned accepted quote/i);
    expect(() =>
      new ManagedUsageSpendAuthorizer(ledger, {
        now: () => Date.parse('2026-08-21T00:05:00.000Z'),
        resolveAcceptedQuote: () => ({ ...quote, targetId: 'other-target' }),
      }).authorize({
        schemaVersion: 1,
        authorizationId: 'authorization-different',
        idempotencyKey: 'authorization-key-different',
        quote,
      })
    ).toThrow(/exact Main-owned accepted quote/i);
  });

  it('persists only verifier-approved quote evidence and supplies the exact durable quote to SpendAuthorizer', () => {
    const { open, state } = createLedger();
    const quote = reservation('verified').quote;
    const evidence: ManagedUsageAcceptedQuoteEvidence = {
      schemaVersion: 1,
      acceptanceId: 'acceptance-verified',
      quote,
      authorityId: 'rate-card-authority-v1',
      authorityEventId: 'authority-event-verified',
      authorityReference: 'quote-evidence-verified',
      environment: 'test',
      audience: 'tomni-managed-usage',
      challengeHash: 'a'.repeat(64),
      authorityJws: 'header.payload.signature',
    };
    let verificationCount = 0;
    const store = new ManagedUsageAcceptedQuoteStore(new ManagedUsageDriver(state), {
      verifyAcceptedQuoteEvidence: (candidate) => {
        verificationCount += 1;
        return candidate.authorityReference === 'quote-evidence-verified' ? candidate.quote : undefined;
      },
    });

    expect(store.accept(evidence)).toEqual(evidence);
    expect(store.accept(evidence)).toEqual(evidence);
    expect(verificationCount).toBe(1);
    expect(state.acceptedQuotes).toHaveLength(1);

    const restartedStore = new ManagedUsageAcceptedQuoteStore(new ManagedUsageDriver(state), {
      verifyAcceptedQuoteEvidence: () => {
        throw new Error('Previously persisted exact evidence must not require a new authority lookup.');
      },
    });
    expect(restartedStore.resolveAcceptedQuote(quote.quoteId)).toEqual(quote);

    const ledger = open();
    ledger.recordCreditGrant(grant('verified'));
    const authorizer = new ManagedUsageSpendAuthorizer(ledger, {
      now: () => Date.parse('2026-08-21T00:05:00.000Z'),
      resolveAcceptedQuote: restartedStore.resolveAcceptedQuote.bind(restartedStore),
    });
    expect(
      authorizer.authorize({
        schemaVersion: 1,
        authorizationId: 'authorization-verified',
        idempotencyKey: 'authorization-key-verified',
        quote,
      })
    ).toMatchObject({ reservation: { quote } });
  });

  it('fails closed on unverified, conflicting, or tampered accepted quote evidence', () => {
    const { state } = createLedger();
    const quote = reservation('rejected').quote;
    const evidence: ManagedUsageAcceptedQuoteEvidence = {
      schemaVersion: 1,
      acceptanceId: 'acceptance-rejected',
      quote,
      authorityId: 'rate-card-authority-v1',
      authorityEventId: 'authority-event-rejected',
      authorityReference: 'quote-evidence-rejected',
      environment: 'test',
      audience: 'tomni-managed-usage',
      challengeHash: 'b'.repeat(64),
      authorityJws: 'header.payload.signature',
    };
    const rejected = new ManagedUsageAcceptedQuoteStore(new ManagedUsageDriver(state), {
      verifyAcceptedQuoteEvidence: () => undefined,
    });
    expect(() => rejected.accept(evidence)).toThrow(/independently verified/i);
    const unboundedEvidence: unknown = { ...evidence, userNarrative: 'do not persist private text' };
    expect(() => rejected.accept(unboundedEvidence as ManagedUsageAcceptedQuoteEvidence)).toThrow(/schema is invalid/i);
    expect(rejected.resolveAcceptedQuote(quote.quoteId)).toBeUndefined();

    const trusted = new ManagedUsageAcceptedQuoteStore(new ManagedUsageDriver(state), {
      verifyAcceptedQuoteEvidence: (candidate) => candidate.quote,
    });
    trusted.accept(evidence);
    expect(() =>
      trusted.accept({ ...evidence, quote: { ...quote, maxCreditMinor: quote.maxCreditMinor + 1 } })
    ).toThrow(/already bound/i);

    const persisted = state.acceptedQuotes.get(evidence.acceptanceId);
    if (persisted === undefined) throw new Error('Expected durable quote evidence.');
    state.acceptedQuotes.set(
      evidence.acceptanceId,
      JSON.stringify({ ...JSON.parse(persisted), acceptanceId: 'other' })
    );
    expect(() => trusted.resolveAcceptedQuote(quote.quoteId)).toThrow(/evidence is corrupt/i);
  });
});
