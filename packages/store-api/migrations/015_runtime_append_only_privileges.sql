REVOKE UPDATE, DELETE, TRUNCATE ON payment_events, webhook_events, entitlement_events, audit_events, ledger_transactions, ledger_entries FROM tomni_runtime;
GRANT SELECT, INSERT ON payment_events, webhook_events, entitlement_events, audit_events, ledger_transactions, ledger_entries TO tomni_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON payment_events, webhook_events, entitlement_events, audit_events, ledger_transactions, ledger_entries FROM tomni_backup;
GRANT SELECT ON payment_events, webhook_events, entitlement_events, audit_events, ledger_transactions, ledger_entries TO tomni_backup;
