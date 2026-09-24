-- Full deletion of one «Обяви» draft, and the queue that removes its server-side
-- files.
--
-- Why this needs a function rather than a plain `delete` from the browser: every
-- child table already cascades from `mobile_bg_drafts`, so the rows are easy, but
-- two things around them are not.
--
--   1. A run in progress. Deleting a draft whose job is `RUNNING` would throw
--      away the record of a listing the worker is publishing right now. The
--      function locks the queue rows first and refuses, so that cannot happen.
--   2. Files on the VPS. The API publisher writes the converted .jpg files into
--      the public web root (see `pictures.ts`), and a request from the browser
--      cannot reach that disk. Those files are queued here and removed by
--      `services/mobile-bg-cleanup` on the server.
--
-- Nothing here deletes by age. A draft goes only when a person presses the
-- button, which is checked in `purge_mobile_bg_draft`.

-- ============================================================
-- 1. Queue of file cleanups
-- ============================================================
-- `draft_id` is intentionally NOT a foreign key: the draft row is already gone
-- by the time this queue is written, and the directory to remove is derived from
-- the id alone. The `snapshot` holds what used to exist, so a cleanup that fails
-- can still be diagnosed after the rows are gone.
CREATE TABLE IF NOT EXISTS public.mobile_bg_purge_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  requested_by text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_by text,
  note text,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_bg_purge_queue
  ON public.mobile_bg_purge_jobs(status, requested_at);

ALTER TABLE public.mobile_bg_purge_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_mobile_bg_purge_jobs" ON public.mobile_bg_purge_jobs;
CREATE POLICY "anon_select_mobile_bg_purge_jobs" ON public.mobile_bg_purge_jobs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_mobile_bg_purge_jobs" ON public.mobile_bg_purge_jobs;
CREATE POLICY "anon_insert_mobile_bg_purge_jobs" ON public.mobile_bg_purge_jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_mobile_bg_purge_jobs" ON public.mobile_bg_purge_jobs;
CREATE POLICY "anon_update_mobile_bg_purge_jobs" ON public.mobile_bg_purge_jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- The cleanup worker runs with the public key, the same way the other workers do
-- when the service role key is absent. It reads the queue and writes the
-- outcome; it never needs to delete a row, because the queue keeps its history.
GRANT SELECT, INSERT, UPDATE ON TABLE public.mobile_bg_purge_jobs TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mobile_bg_purge_jobs TO authenticated;

-- ============================================================
-- 2. Preview — exactly what would be removed
-- ============================================================
-- The confirmation shows real counts instead of a generic warning, so the person
-- pressing the button can see the size of what disappears. Written in plpgsql so
-- a missing optional table cannot fail function creation.
CREATE OR REPLACE FUNCTION public.mobile_bg_draft_purge_preview(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.mobile_bg_drafts;
  v_fields integer := 0;
  v_extras integer := 0;
  v_images integer := 0;
  v_selected_images integer := 0;
  v_logs integer := 0;
  v_dedup integer := 0;
  v_intake integer := 0;
  v_jobs integer := 0;
  v_running integer := 0;
  v_dedup_links integer := 0;
  v_bytes bigint := 0;
BEGIN
  SELECT * INTO v_draft FROM public.mobile_bg_drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Черновата не е намерена.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_fields FROM public.mobile_bg_draft_fields WHERE draft_id = p_draft_id;
  SELECT count(*) INTO v_extras FROM public.mobile_bg_draft_extras WHERE draft_id = p_draft_id;
  SELECT count(*) INTO v_images FROM public.mobile_bg_draft_images WHERE draft_id = p_draft_id;
  SELECT count(*) INTO v_selected_images FROM public.mobile_bg_draft_images
    WHERE draft_id = p_draft_id AND is_selected;
  SELECT count(*) INTO v_logs FROM public.mobile_bg_draft_action_log WHERE draft_id = p_draft_id;
  SELECT count(*) INTO v_dedup FROM public.mobile_bg_dedup_checks WHERE draft_id = p_draft_id;
  SELECT count(*) INTO v_intake FROM public.source_listing_jobs WHERE draft_id = p_draft_id;
  SELECT count(*), count(*) FILTER (WHERE status = 'RUNNING')
    INTO v_jobs, v_running
    FROM public.mobile_bg_publish_jobs WHERE draft_id = p_draft_id;

  -- Rows belonging to *other* drafts that point at this one. They are not
  -- cascade-deleted, so they would otherwise keep a dangling id for ever.
  SELECT count(*) INTO v_dedup_links FROM public.mobile_bg_dedup_checks
    WHERE matched_draft_id = p_draft_id AND draft_id <> p_draft_id;

  v_bytes :=
      pg_column_size(v_draft)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.mobile_bg_draft_fields t WHERE t.draft_id = p_draft_id)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.mobile_bg_draft_extras t WHERE t.draft_id = p_draft_id)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.mobile_bg_draft_images t WHERE t.draft_id = p_draft_id)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.mobile_bg_draft_action_log t WHERE t.draft_id = p_draft_id)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.mobile_bg_dedup_checks t WHERE t.draft_id = p_draft_id)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.source_listing_jobs t WHERE t.draft_id = p_draft_id)
    + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM public.mobile_bg_publish_jobs t WHERE t.draft_id = p_draft_id);

  RETURN jsonb_build_object(
    'draft_id', v_draft.id,
    'title', v_draft.title,
    'status', v_draft.status,
    'mobile_bg_url', v_draft.mobile_bg_url,
    'is_published', v_draft.mobile_bg_url IS NOT NULL,
    'fields', v_fields,
    'extras', v_extras,
    'images', v_images,
    'selected_images', v_selected_images,
    'action_log', v_logs,
    'dedup_checks', v_dedup,
    'intake_jobs', v_intake,
    'publish_jobs', v_jobs,
    'running_jobs', v_running,
    'dedup_links_elsewhere', v_dedup_links,
    'bytes_estimate', v_bytes,
    'blocked', v_running > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_bg_draft_purge_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobile_bg_draft_purge_preview(uuid) TO authenticated;

-- ============================================================
-- 3. The deletion itself
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_mobile_bg_draft(p_draft_id uuid, p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.mobile_bg_drafts;
  v_job_ids uuid[];
  v_counts jsonb;
  v_running integer := 0;
  v_dedup_links integer := 0;
  v_purge_id uuid;
  v_photo_prefix text;
BEGIN
  -- Take the draft row first, then its queue rows. `claim_mobile_bg_publish_job`
  -- claims with `FOR UPDATE SKIP LOCKED`, so holding these locks means a worker
  -- cannot pick the job up halfway through the deletion.
  SELECT * INTO v_draft FROM public.mobile_bg_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Черновата не е намерена.' USING ERRCODE = 'P0002';
  END IF;

  SELECT array_agg(id) INTO v_job_ids
  FROM (SELECT id FROM public.mobile_bg_publish_jobs WHERE draft_id = p_draft_id FOR UPDATE) locked;

  SELECT count(*) INTO v_running
  FROM public.mobile_bg_publish_jobs
  WHERE draft_id = p_draft_id AND status = 'RUNNING';

  IF v_running > 0 THEN
    RAISE EXCEPTION 'Черновата се публикува в момента. Изчакай публикуването да приключи и опитай пак.'
      USING ERRCODE = 'P0001';
  END IF;

  v_counts := public.mobile_bg_draft_purge_preview(p_draft_id);

  -- A reference held by another draft is cleared, not the other draft's row.
  UPDATE public.mobile_bg_dedup_checks
    SET matched_draft_id = NULL
    WHERE matched_draft_id = p_draft_id AND draft_id <> p_draft_id;
  GET DIAGNOSTICS v_dedup_links = ROW_COUNT;

  -- One statement removes the draft and, by cascade, the fields, extras, images,
  -- action log, dedup checks, intake job and every publish job it ever had.
  DELETE FROM public.mobile_bg_drafts WHERE id = p_draft_id;

  -- The queue for the files on the VPS disk. The directory name is derived from
  -- the id the same way `pictures.ts` derives it.
  v_photo_prefix := 'mobilebg-pictures/' || regexp_replace(p_draft_id::text, '[^a-zA-Z0-9_-]', '', 'g');

  INSERT INTO public.mobile_bg_purge_jobs (draft_id, status, requested_by, snapshot)
  VALUES (
    p_draft_id,
    'QUEUED',
    coalesce(p_actor, 'неизвестен'),
    jsonb_build_object(
      'draft_id', p_draft_id,
      'title', v_draft.title,
      'photo_prefix', v_photo_prefix,
      'job_ids', to_jsonb(coalesce(v_job_ids, ARRAY[]::uuid[])),
      'deleted', v_counts,
      'dedup_links_cleared', v_dedup_links
    )
  )
  RETURNING id INTO v_purge_id;

  -- The action log row would be cascade-deleted with the draft, so the durable
  -- record goes to `audit_log`, which has no foreign key and survives.
  INSERT INTO public.audit_log (actor, action, entity, entity_id, before, after)
  VALUES (
    coalesce(p_actor, 'неизвестен'),
    'PURGE',
    'mobile_bg_drafts',
    p_draft_id::text,
    jsonb_build_object('title', v_draft.title, 'status', v_draft.status),
    jsonb_build_object('counts', v_counts, 'dedup_links_cleared', v_dedup_links, 'purge_job_id', v_purge_id)
  );

  RETURN jsonb_build_object(
    'draft_id', p_draft_id,
    'title', v_draft.title,
    'purge_job_id', v_purge_id,
    'dedup_links_cleared', v_dedup_links,
    'deleted', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_mobile_bg_draft(uuid, text) FROM PUBLIC;
-- Only the signed-in admin. The `anon` role is the publisher worker and must
-- never be able to delete a draft.
GRANT EXECUTE ON FUNCTION public.purge_mobile_bg_draft(uuid, text) TO authenticated;

