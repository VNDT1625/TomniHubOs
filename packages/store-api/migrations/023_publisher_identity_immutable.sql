-- Publisher identity is immutable; lifecycle fields remain mutable by the runtime role.
CREATE OR REPLACE FUNCTION tomni_reject_publisher_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publisher_id <> OLD.publisher_id OR NEW.owner_account_id <> OLD.owner_account_id OR NEW.namespace <> OLD.namespace THEN
    RAISE EXCEPTION 'publisher identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS publishers_identity_immutable ON publishers;
CREATE TRIGGER publishers_identity_immutable
BEFORE UPDATE ON publishers
FOR EACH ROW EXECUTE FUNCTION tomni_reject_publisher_identity_mutation();
REVOKE ALL ON publishers FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON publishers TO tomni_runtime;
GRANT SELECT ON publishers TO tomni_backup;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON publishers TO tomni_migration;
