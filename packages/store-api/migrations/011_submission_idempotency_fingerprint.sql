-- Bind submission idempotency keys to the exact immutable request.
ALTER TABLE package_submissions ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE INDEX IF NOT EXISTS package_submissions_request_fingerprint_idx ON package_submissions(publisher_id,idempotency_key,request_fingerprint);
REVOKE ALL ON package_submissions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON package_submissions TO tomni_runtime;
GRANT SELECT ON package_submissions TO tomni_backup;
GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON package_submissions TO tomni_migration;
