-- Keep the original JSON from the extraction script.  This makes every
-- automatically filled value traceable and allows the normalizer to be rerun.

ALTER TABLE source_listing_jobs
  ADD COLUMN IF NOT EXISTS raw_payload jsonb,
  ADD COLUMN IF NOT EXISTS normalized_payload jsonb,
  ADD COLUMN IF NOT EXISTS payload_received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_source_listing_jobs_payload_received
  ON source_listing_jobs(payload_received_at DESC);
