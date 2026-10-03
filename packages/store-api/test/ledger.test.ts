import { describe, expect, it } from 'vitest';
import { assertBalancedLedger } from '../src/ledger.js';

describe('ledger invariants', () => {
  it('accepts balanced entries per currency', () => {
    expect(() =>
      assertBalancedLedger([
        { direction: 'debit', amountMinor: 100, currency: 'USD' },
        { direction: 'credit', amountMinor: 100, currency: 'USD' },
      ])
    ).not.toThrow();
  });
  it('rejects unbalanced, zero, and invalid-currency entries', () => {
    expect(() =>
      assertBalancedLedger([
        { direction: 'debit', amountMinor: 100, currency: 'USD' },
        { direction: 'credit', amountMinor: 99, currency: 'USD' },
      ])
    ).toThrow('LEDGER_UNBALANCED');
    expect(() => assertBalancedLedger([{ direction: 'debit', amountMinor: 0, currency: 'USD' }])).toThrow(
      'LEDGER_ENTRY_INVALID'
    );
    expect(() =>
      assertBalancedLedger([
        { direction: 'debit', amountMinor: 1, currency: 'usd' },
        { direction: 'credit', amountMinor: 1, currency: 'usd' },
      ])
    ).toThrow('LEDGER_ENTRY_INVALID');
  });
});
