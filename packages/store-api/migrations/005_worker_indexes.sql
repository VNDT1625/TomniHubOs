-- Durable worker indexes and retry metadata.
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE recovery_jobs ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS outbox_claim_idx ON outbox_events(state, available_at, lease_until);
CREATE INDEX IF NOT EXISTS recovery_claim_idx ON recovery_jobs(state, available_at, lease_until);
