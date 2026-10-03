-- Durable reconciliation evidence and least-privilege access.
CREATE TABLE IF NOT EXISTS reconciliation_items (
  item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES reconciliation_runs(run_id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  mismatch_code text NOT NULL,
  expected_json jsonb,
  actual_json jsonb,
  state text NOT NULL CHECK (state IN ('open','resolved','accepted')) DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,entity_type,entity_id,mismatch_code)
);
CREATE INDEX IF NOT EXISTS reconciliation_items_run_idx ON reconciliation_items(run_id,state);
REVOKE ALL ON reconciliation_items FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON reconciliation_items TO tomni_runtime;
GRANT SELECT ON reconciliation_items TO tomni_backup;
GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER ON reconciliation_items TO tomni_migration;
