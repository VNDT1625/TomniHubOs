ALTER TABLE recovery_jobs ADD COLUMN IF NOT EXISTS last_error text;
REVOKE ALL ON recovery_jobs FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON recovery_jobs TO tomni_runtime;
GRANT SELECT ON recovery_jobs TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON recovery_jobs TO tomni_migration;