-- Reassert runtime append-only privileges after all domain migrations.
-- This migration is idempotent and intentionally does not alter historical rows.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'payment_events', 'webhook_events', 'entitlement_events', 'audit_events',
    'ledger_transactions', 'ledger_entries', 'release_signatures', 'package_approvals'
  ] LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM tomni_runtime', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO tomni_runtime', table_name);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries, ledger_transactions, payment_events,
  webhook_events, entitlement_events, audit_events, release_signatures, package_approvals
  FROM tomni_backup;
GRANT SELECT ON ledger_entries, ledger_transactions, payment_events, webhook_events,
  entitlement_events, audit_events, release_signatures, package_approvals TO tomni_backup;
