export type LedgerPosting = Readonly<{
  direction: 'debit' | 'credit';
  amountMinor: number;
  currency: string;
}>;

/** Reject a posting before persistence unless each currency is balanced. */
export const assertBalancedLedger = (entries: readonly LedgerPosting[]): void => {
  if (!entries.length) throw new Error('LEDGER_EMPTY');
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0 || !/^[A-Z]{3}$/.test(entry.currency))
      throw new Error('LEDGER_ENTRY_INVALID');
    const total = totals.get(entry.currency) ?? { debit: 0, credit: 0 };
    total[entry.direction] += entry.amountMinor;
    totals.set(entry.currency, total);
  }
  for (const total of totals.values()) {
    if (total.debit !== total.credit) throw new Error('LEDGER_UNBALANCED');
  }
};
