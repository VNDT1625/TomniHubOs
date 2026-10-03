-- Persist provider checkout identity so retries never create duplicate sessions.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_checkout_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_checkout_url text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_checkout_id_uq ON orders(provider_checkout_id) WHERE provider_checkout_id IS NOT NULL;
REVOKE ALL ON orders FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON orders TO tomni_runtime;
GRANT SELECT ON orders TO tomni_backup;
GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON orders TO tomni_migration;
