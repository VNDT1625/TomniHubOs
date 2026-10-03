-- Allow the runtime worker to lease and complete outbox deliveries without granting destructive privileges.
REVOKE ALL ON outbox_events FROM tomni_runtime;
GRANT SELECT, INSERT, UPDATE ON outbox_events TO tomni_runtime;
REVOKE DELETE, TRUNCATE ON outbox_events FROM tomni_runtime, tomni_backup;

