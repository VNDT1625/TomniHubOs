-- Immutable package/version/artifact bindings.
CREATE OR REPLACE FUNCTION prevent_store_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'package_versions' AND (NEW.package_id <> OLD.package_id OR NEW.version <> OLD.version OR NEW.manifest_digest <> OLD.manifest_digest) THEN
    RAISE EXCEPTION 'PACKAGE_VERSION_IMMUTABLE';
  END IF;
  IF TG_TABLE_NAME = 'package_artifacts' AND (NEW.artifact_digest <> OLD.artifact_digest OR NEW.package_id <> OLD.package_id OR NEW.version <> OLD.version OR NEW.archive_digest <> OLD.archive_digest OR NEW.object_key <> OLD.object_key) THEN
    RAISE EXCEPTION 'PACKAGE_ARTIFACT_IMMUTABLE';
  END IF;
  IF TG_TABLE_NAME = 'package_submissions' AND (NEW.publisher_id <> OLD.publisher_id OR NEW.package_id <> OLD.package_id OR NEW.version <> OLD.version OR NEW.artifact_digest <> OLD.artifact_digest OR NEW.manifest_digest <> OLD.manifest_digest) THEN
    RAISE EXCEPTION 'SUBMISSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS package_versions_immutable ON package_versions;
CREATE TRIGGER package_versions_immutable BEFORE UPDATE ON package_versions FOR EACH ROW EXECUTE FUNCTION prevent_store_immutable_mutation();
DROP TRIGGER IF EXISTS package_artifacts_immutable ON package_artifacts;
CREATE TRIGGER package_artifacts_immutable BEFORE UPDATE ON package_artifacts FOR EACH ROW EXECUTE FUNCTION prevent_store_immutable_mutation();
DROP TRIGGER IF EXISTS package_submissions_immutable ON package_submissions;
CREATE TRIGGER package_submissions_immutable BEFORE UPDATE ON package_submissions FOR EACH ROW EXECUTE FUNCTION prevent_store_immutable_mutation();
