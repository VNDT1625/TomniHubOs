-- Enforce non-empty signature evidence for published catalog records.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='release_signatures_evidence_ck') THEN
    ALTER TABLE release_signatures ADD CONSTRAINT release_signatures_evidence_ck
      CHECK (length(trim(key_id)) > 0 AND length(trim(signature)) > 0 AND length(trim(canonical_digest)) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='catalog_publications_signed_state_ck') THEN
    ALTER TABLE catalog_publications ADD CONSTRAINT catalog_publications_signed_state_ck
      CHECK (state <> 'published' OR (length(trim(signer_key_id)) > 0 AND length(trim(signature)) > 0 AND length(trim(canonical_digest)) > 0));
  END IF;
END $$;
