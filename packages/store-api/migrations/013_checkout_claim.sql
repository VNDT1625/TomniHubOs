-- Serialize external checkout creation and make abandoned claims recoverable.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_state_check') THEN
    ALTER TABLE orders DROP CONSTRAINT orders_state_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_state_checkout_claim_ck') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_state_checkout_claim_ck CHECK (state IN ('created','checkout_creating','checkout_pending','paid','refunded','failed'));
  END IF;
END $$;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_claim_until timestamptz;
CREATE INDEX IF NOT EXISTS orders_checkout_recovery_idx ON orders(state,checkout_claim_until) WHERE state='checkout_creating';
