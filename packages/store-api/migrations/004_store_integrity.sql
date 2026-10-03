-- Store domain completion: signing keys, explicit approvals, and integrity indexes.
CREATE TABLE IF NOT EXISTS publisher_signing_keys (
  key_id text PRIMARY KEY,
  publisher_id uuid NOT NULL REFERENCES publishers(publisher_id) ON DELETE RESTRICT,
  algorithm text NOT NULL CHECK (algorithm = 'ed25519'),
  public_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (publisher_id, public_key)
);
CREATE INDEX IF NOT EXISTS publisher_signing_keys_publisher_status_idx ON publisher_signing_keys(publisher_id, status);
CREATE TABLE IF NOT EXISTS package_approvals (
  approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES package_submissions(submission_id) ON DELETE RESTRICT,
  reviewer_account_id uuid NOT NULL REFERENCES accounts(account_id) ON DELETE RESTRICT,
  artifact_digest text NOT NULL REFERENCES package_artifacts(artifact_digest) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, decision)
);
CREATE INDEX IF NOT EXISTS package_approvals_reviewer_idx ON package_approvals(reviewer_account_id, created_at DESC);
ALTER TABLE package_submissions ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='package_submissions_digest_format_ck') THEN ALTER TABLE package_submissions ADD CONSTRAINT package_submissions_digest_format_ck CHECK (artifact_digest ~ '^sha256-[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='package_artifacts_binding_uq') THEN ALTER TABLE package_artifacts ADD CONSTRAINT package_artifacts_binding_uq UNIQUE (package_id, version, artifact_digest); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='catalog_entries_artifact_binding_uq') THEN ALTER TABLE catalog_entries ADD CONSTRAINT catalog_entries_artifact_binding_uq UNIQUE (package_id, version, artifact_digest); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_order_uq') THEN ALTER TABLE payments ADD CONSTRAINT payments_order_uq UNIQUE (order_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='refunds_order_state_uq') THEN ALTER TABLE refunds ADD CONSTRAINT refunds_order_state_uq UNIQUE (order_id, state); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='release_signatures_digest_ck') THEN ALTER TABLE release_signatures ADD CONSTRAINT release_signatures_digest_ck CHECK (canonical_digest <> ''); END IF;
END $$;
REVOKE ALL ON publisher_signing_keys, package_approvals FROM PUBLIC;
GRANT SELECT, INSERT ON publisher_signing_keys, package_approvals TO tomni_runtime;
GRANT SELECT ON publisher_signing_keys, package_approvals TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON publisher_signing_keys, package_approvals TO tomni_migration;
