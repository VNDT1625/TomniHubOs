DROP TRIGGER IF EXISTS package_approvals_append_only ON package_approvals;
CREATE TRIGGER package_approvals_append_only
BEFORE UPDATE OR DELETE ON package_approvals
FOR EACH ROW EXECUTE FUNCTION tomni_reject_append_only_mutation();

DROP TRIGGER IF EXISTS release_signatures_append_only ON release_signatures;
CREATE TRIGGER release_signatures_append_only
BEFORE UPDATE OR DELETE ON release_signatures
FOR EACH ROW EXECUTE FUNCTION tomni_reject_append_only_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON package_approvals, release_signatures FROM tomni_runtime, tomni_backup;
GRANT SELECT, INSERT ON package_approvals, release_signatures TO tomni_runtime;
GRANT SELECT ON package_approvals, release_signatures TO tomni_backup;
