-- Publishing is deliberately a separate queue from JSON intake.
-- JSON is accepted directly by our system.  The actual Mobile.bg form is
-- handled by an on-demand worker, so there is no browser running all day.

CREATE TABLE IF NOT EXISTS mobile_bg_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'QUEUED',
  transport text NOT NULL DEFAULT 'BROWSER_ON_DEMAND',
  mode text NOT NULL DEFAULT 'PREVIEW',
  requested_by text NOT NULL DEFAULT 'Росен',
  claimed_by text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  result jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id)
);

ALTER TABLE mobile_bg_publish_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_mobile_publish_jobs" ON mobile_bg_publish_jobs;
CREATE POLICY "anon_select_mobile_publish_jobs" ON mobile_bg_publish_jobs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_mobile_publish_jobs" ON mobile_bg_publish_jobs;
CREATE POLICY "anon_insert_mobile_publish_jobs" ON mobile_bg_publish_jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_mobile_publish_jobs" ON mobile_bg_publish_jobs;
CREATE POLICY "anon_update_mobile_publish_jobs" ON mobile_bg_publish_jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_mobile_bg_publish_jobs_queue
  ON mobile_bg_publish_jobs(status, requested_at);

-- Atomically gives one queued job to one worker.  A second worker cannot
-- publish the same draft at the same time.
CREATE OR REPLACE FUNCTION claim_mobile_bg_publish_job(worker_name text)
RETURNS SETOF mobile_bg_publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed mobile_bg_publish_jobs;
BEGIN
  SELECT * INTO claimed
  FROM mobile_bg_publish_jobs
  WHERE status = 'QUEUED'
  ORDER BY requested_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE mobile_bg_publish_jobs
  SET status = 'RUNNING', claimed_by = worker_name,
      attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
  WHERE id = claimed.id
  RETURNING * INTO claimed;

  RETURN NEXT claimed;
END;
$$;
