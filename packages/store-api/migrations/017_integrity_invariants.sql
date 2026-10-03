-- Enforce database-level artifact addressing and ISO currency invariants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_artifacts_object_key_binding_ck') THEN
    ALTER TABLE package_artifacts ADD CONSTRAINT package_artifacts_object_key_binding_ck
      CHECK (object_key = 'sha256/' || substring(artifact_digest from 8));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_currency_format_ck') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_currency_format_ck CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_currency_format_ck') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_currency_format_ck CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS package_artifacts_package_version_idx ON package_artifacts(package_id, version, state);
CREATE INDEX IF NOT EXISTS entitlements_account_state_idx ON entitlements(account_id, state, package_id, version);
