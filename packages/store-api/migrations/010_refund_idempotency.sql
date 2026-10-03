-- Durable refund request idempotency and replay conflict detection.
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_order_idempotency_uq ON refunds(order_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
REVOKE ALL ON refunds FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON refunds TO tomni_runtime;
GRANT SELECT ON refunds TO tomni_backup;
GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON refunds TO tomni_migration;
