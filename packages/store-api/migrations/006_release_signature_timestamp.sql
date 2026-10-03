-- Release signature timestamp for catalog evidence.
ALTER TABLE release_signatures ADD COLUMN IF NOT EXISTS signed_at timestamptz NOT NULL DEFAULT now();
