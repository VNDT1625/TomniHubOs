-- One publisher authority per Tomni account; prevents concurrent duplicate enrollment.
CREATE UNIQUE INDEX IF NOT EXISTS publishers_owner_account_uq ON publishers(owner_account_id);
REVOKE ALL ON publishers FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON publishers TO tomni_runtime;
GRANT SELECT ON publishers TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON publishers TO tomni_migration;
