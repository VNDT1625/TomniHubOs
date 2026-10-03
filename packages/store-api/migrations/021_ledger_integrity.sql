-- Tighten ledger invariants for durable double-entry evidence.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_positive_amount_ck') THEN
    ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_positive_amount_ck CHECK (amount_minor > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_currency_format_ck') THEN
    ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_currency_format_ck CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_currency_idx ON ledger_entries(transaction_id, currency);
REVOKE ALL ON ledger_entries FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM tomni_runtime;
GRANT SELECT, INSERT ON ledger_entries TO tomni_runtime;
GRANT SELECT ON ledger_entries TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ledger_entries TO tomni_migration;
