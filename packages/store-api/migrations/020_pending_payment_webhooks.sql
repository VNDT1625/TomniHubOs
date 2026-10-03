-- Durable storage for provider events received before their local order exists.
CREATE TABLE IF NOT EXISTS pending_payment_webhooks (
  pending_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  order_id text NOT NULL,
  payload_json jsonb NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','applied','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS pending_payment_webhooks_claim_idx ON pending_payment_webhooks(state, available_at, order_id);
REVOKE ALL ON pending_payment_webhooks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON pending_payment_webhooks TO tomni_runtime;
GRANT SELECT ON pending_payment_webhooks TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON pending_payment_webhooks TO tomni_migration;

