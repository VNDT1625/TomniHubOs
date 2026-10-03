-- Bind order idempotency keys to the original request fingerprint.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE INDEX IF NOT EXISTS orders_idempotency_fingerprint_idx ON orders(account_id,idempotency_key,request_fingerprint);
