-- Source intake is invoked only by the authenticated Edge Function.  Keeping
-- the privileged database operation server-only prevents browser clients from
-- creating drafts or bypassing the duplicate check directly.

REVOKE ALL ON FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text) FROM authenticated;
DROP FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text);

CREATE FUNCTION public.queue_source_intake(
  p_source_url text,
  p_source_type text,
  p_source_domain text,
  p_source_listing_id text,
  p_intake_origin text DEFAULT 'LINK_FIELD',
  p_catalog_permanent_id integer DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_requested_by uuid DEFAULT NULL
)
RETURNS TABLE(draft_id uuid, was_created boolean, job_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_url text := trim(coalesce(p_source_url, ''));
  v_source_domain text := lower(trim(coalesce(p_source_domain, '')));
  v_source_listing_id text := nullif(trim(coalesce(p_source_listing_id, '')), '');
  v_identity text;
  v_existing_draft_id uuid;
  v_new_draft_id uuid;
  v_title text;
BEGIN
  IF p_requested_by IS NULL THEN
    RAISE EXCEPTION 'Липсва идентифициран потребител.' USING ERRCODE = '42501';
  END IF;

  IF v_source_url = '' OR v_source_domain = '' THEN
    RAISE EXCEPTION 'Липсва валиден линк към източниковата обява.' USING ERRCODE = '22023';
  END IF;

  v_identity := v_source_domain || '|' || coalesce(
    v_source_listing_id,
    lower(regexp_replace(v_source_url, '[?#].*$', ''))
  );

  PERFORM pg_advisory_xact_lock(hashtext(v_identity));

  SELECT job.draft_id INTO v_existing_draft_id
  FROM public.source_listing_jobs AS job
  WHERE job.source_identity = v_identity
    AND job.status IN ('QUEUED', 'RUNNING', 'COMPLETED')
  LIMIT 1;

  IF v_existing_draft_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_draft_id, false, 'EXISTS';
    RETURN;
  END IF;

  v_title := coalesce(
    nullif(trim(p_title), ''),
    'Изчаква извличане — ' || v_source_domain || coalesce(' #' || v_source_listing_id, '')
  );

  INSERT INTO public.mobile_bg_drafts (
    catalog_permanent_id, title, status, source_type, source_url,
    source_listing_id, intake_origin, extraction_status, source_domain, created_by
  ) VALUES (
    p_catalog_permanent_id, v_title, 'DRAFT', p_source_type, v_source_url,
    v_source_listing_id, p_intake_origin, 'SOURCE_PENDING', v_source_domain, p_requested_by::text
  ) RETURNING id INTO v_new_draft_id;

  INSERT INTO public.source_listing_jobs (
    draft_id, source_type, source_url, source_identity, status
  ) VALUES (
    v_new_draft_id, p_source_type, v_source_url, v_identity, 'QUEUED'
  );

  INSERT INTO public.mobile_bg_draft_action_log (draft_id, action, actor, details)
  VALUES (
    v_new_draft_id,
    'SOURCE_LINK_QUEUED',
    p_requested_by::text,
    jsonb_build_object(
      'intake_origin', p_intake_origin,
      'source_type', p_source_type,
      'source_url', v_source_url,
      'source_listing_id', v_source_listing_id,
      'catalog_permanent_id', p_catalog_permanent_id
    )
  );

  RETURN QUERY SELECT v_new_draft_id, true, 'QUEUED';
END;
$$;

REVOKE ALL ON FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.queue_source_intake(text, text, text, text, text, integer, text, uuid) TO service_role;
