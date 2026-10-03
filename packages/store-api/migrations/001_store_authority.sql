CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS external_identities (account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT, issuer text NOT NULL, subject text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (issuer, subject));
CREATE UNIQUE INDEX IF NOT EXISTS external_identities_account_issuer_uq ON external_identities(account_id, issuer);
CREATE TABLE IF NOT EXISTS webhook_events (provider text NOT NULL, provider_event_id text NOT NULL, payload_hash text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider, provider_event_id));
CREATE TABLE IF NOT EXISTS idempotency_keys (scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS ledger_transactions (transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_event_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ledger_entries (entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES ledger_transactions(transaction_id) ON DELETE RESTRICT, account_code text NOT NULL, direction text NOT NULL CHECK (direction IN ('debit','credit')), amount_minor bigint NOT NULL CHECK (amount_minor >= 0), currency char(3) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payment_events (payment_event_id text PRIMARY KEY, provider_event_id text NOT NULL UNIQUE, order_id text NOT NULL, payload_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS entitlement_events (entitlement_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entitlement_id text NOT NULL, event_kind text NOT NULL, payload_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_subject text NOT NULL, action text NOT NULL, payload_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tomni_runtime') THEN CREATE ROLE tomni_runtime NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tomni_migration') THEN CREATE ROLE tomni_migration NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tomni_backup') THEN CREATE ROLE tomni_backup NOLOGIN; END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tomni_runtime, tomni_backup, tomni_migration;
GRANT SELECT, INSERT, UPDATE ON accounts, external_identities TO tomni_runtime;
GRANT SELECT, INSERT ON webhook_events, idempotency_keys, ledger_transactions, ledger_entries, payment_events, entitlement_events, audit_events TO tomni_runtime;
GRANT SELECT ON accounts, external_identities, webhook_events, idempotency_keys, ledger_transactions, ledger_entries, payment_events, entitlement_events, audit_events TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON accounts, external_identities, webhook_events, idempotency_keys, ledger_transactions, ledger_entries, payment_events, entitlement_events, audit_events TO tomni_migration;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tomni_runtime, tomni_backup, tomni_migration;
