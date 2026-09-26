-- Direct source link -> draft -> private script queue.
-- No browser agent or scraping is started by this migration.

ALTER TABLE mobile_bg_drafts
  ADD COLUMN IF NOT EXISTS intake_origin text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS source_domain text,
  ADD COLUMN IF NOT EXISTS extraction_error text;

CREATE INDEX IF NOT EXISTS idx_drafts_extraction_status ON mobile_bg_drafts(extraction_status);

CREATE TABLE IF NOT EXISTS source_listing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL UNIQUE REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_url text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  attempt_count integer NOT NULL DEFAULT 0,
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE source_listing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_source_listing_jobs" ON source_listing_jobs;
CREATE POLICY "anon_select_source_listing_jobs" ON source_listing_jobs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_source_listing_jobs" ON source_listing_jobs;
CREATE POLICY "anon_insert_source_listing_jobs" ON source_listing_jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_source_listing_jobs" ON source_listing_jobs;
CREATE POLICY "anon_update_source_listing_jobs" ON source_listing_jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_source_listing_jobs_queue ON source_listing_jobs(status, created_at);
