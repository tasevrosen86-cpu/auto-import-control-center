-- Hard cap of 17 selected photos per draft.
--
-- Mobile.bg accepts at most 17 photos per listing. Until now that limit lived
-- only in the publishers, which quietly truncated the batch at send time and
-- reported it in a note. The broker could therefore mark 22 photos, see all 22
-- marked as selected, and have five of them silently dropped at publish.
--
-- The limit is a property of the data, not of the sender, so it is enforced on
-- the table: a draft can never hold more than 17 selected photos, whatever
-- writes them — the screen, the source importer, the catalog path, a manual SQL
-- statement, or a future writer that has not been written yet.
--
-- Photos are never deleted and `display_order` is never rewritten. Unselected
-- photos stay on the draft and can be swapped in at any time.
--
-- The 17 kept are the smallest by (display_order, id). `display_order` is the
-- order the broker sees and the order the publisher sends, so "the first 17" in
-- the screen and in the request are the same 17, with no dependence on the order
-- rows happened to be inserted. `is_main` deliberately does not take part: a
-- photo marked as main is a cover choice, not a claim on one of the 17 slots,
-- and letting it jump the cap would drop a different photo than the screen shows.
--
-- Idempotent: safe to run again. See AGENTS.md, "Applying migrations".

-- ============================================================
-- 1. Enforce the cap on every write
-- ============================================================
--
-- Statement-level, not row-level. A row-level trigger decides each row against
-- the rows already written, so within one multi-row INSERT it sees an incomplete
-- table: inserting 22 rows in ascending display_order happens to give the right
-- answer, and inserting the same 22 in descending order leaves all 22 selected.
-- Depending on the order a client happens to send its rows is not a rule.

CREATE OR REPLACE FUNCTION public.mobile_bg_prune_image_selection(p_draft_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only the drafts the statement touched are ranked. Ranking every draft would
  -- make each photo write read every selected photo in the database.
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY draft_id
             ORDER BY display_order, id
           ) AS position
    FROM public.mobile_bg_draft_images
    WHERE is_selected AND draft_id = ANY (p_draft_ids)
  )
  UPDATE public.mobile_bg_draft_images AS image
  SET is_selected = false,
      updated_at = now()
  FROM ranked
  WHERE image.id = ranked.id
    AND ranked.position > 17;
END;
$$;

COMMENT ON FUNCTION public.mobile_bg_prune_image_selection(uuid[]) IS
  'Deselects every selected photo of the given drafts ranked past the seventeenth by (display_order, id), keeping at most the 17 Mobile.bg accepts. Photos are not deleted.';

CREATE OR REPLACE FUNCTION public.mobile_bg_enforce_image_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The UPDATE inside the prune fires this trigger again. The nested run finds
  -- nothing over the cap and stops, but without this the recursion would only
  -- end at the depth limit, so nested invocations return at once.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  -- One trigger per event, because PostgreSQL does not allow transition tables
  -- on a trigger with several events. Which rows each event sees decides which
  -- drafts are re-ranked, so insert looks at what arrived, delete at what left,
  -- and update at both.
  IF TG_OP = 'INSERT' THEN
    PERFORM public.mobile_bg_prune_image_selection(
      ARRAY(SELECT DISTINCT draft_id FROM cap_new));
  ELSIF TG_OP = 'DELETE' THEN
    -- A removed photo frees a slot, so the drafts it left are re-ranked. Usually
    -- a no-op: nothing needs selecting on a delete.
    PERFORM public.mobile_bg_prune_image_selection(
      ARRAY(SELECT DISTINCT draft_id FROM cap_old));
  ELSE
    PERFORM public.mobile_bg_prune_image_selection(
      ARRAY(SELECT DISTINCT draft_id FROM cap_new
            UNION SELECT DISTINCT draft_id FROM cap_old));
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.mobile_bg_enforce_image_cap() IS
  'Trigger body for the trg_mobile_bg_image_cap_* triggers. Keeps at most 17 photos selected per draft, the limit Mobile.bg accepts.';

DO $$
BEGIN
  IF to_regclass('public.mobile_bg_draft_images') IS NULL THEN
    RAISE EXCEPTION 'public.mobile_bg_draft_images does not exist; run the base draft migrations first.';
  END IF;

  DROP TRIGGER IF EXISTS trg_mobile_bg_image_cap_insert ON public.mobile_bg_draft_images;
  DROP TRIGGER IF EXISTS trg_mobile_bg_image_cap_update ON public.mobile_bg_draft_images;
  DROP TRIGGER IF EXISTS trg_mobile_bg_image_cap_delete ON public.mobile_bg_draft_images;

  CREATE TRIGGER trg_mobile_bg_image_cap_insert
    AFTER INSERT ON public.mobile_bg_draft_images
    REFERENCING NEW TABLE AS cap_new
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.mobile_bg_enforce_image_cap();

  CREATE TRIGGER trg_mobile_bg_image_cap_update
    AFTER UPDATE ON public.mobile_bg_draft_images
    REFERENCING NEW TABLE AS cap_new OLD TABLE AS cap_old
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.mobile_bg_enforce_image_cap();

  CREATE TRIGGER trg_mobile_bg_image_cap_delete
    AFTER DELETE ON public.mobile_bg_draft_images
    REFERENCING OLD TABLE AS cap_old
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.mobile_bg_enforce_image_cap();
END $$;

COMMENT ON COLUMN public.mobile_bg_draft_images.is_selected IS
  'Marked for publishing to Mobile.bg. At most 17 per draft, enforced by the trg_mobile_bg_image_cap_* triggers. Unselected photos stay on the draft and can be swapped in.';

-- Supports the ranking above: it reads display_order and id of the selected
-- photos of one draft.
CREATE INDEX IF NOT EXISTS idx_draft_images_selection
  ON public.mobile_bg_draft_images (draft_id, display_order, id)
  WHERE is_selected;

-- ============================================================
-- 2. Bring existing drafts within the cap
-- ============================================================
--
-- A trigger only fires on writes, so drafts already over the cap need this one
-- pass. Running it again is a no-op. Only the selection flag changes.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY draft_id
           ORDER BY display_order, id
         ) AS position
  FROM public.mobile_bg_draft_images
  WHERE is_selected
)
UPDATE public.mobile_bg_draft_images AS image
SET is_selected = false,
    updated_at = now()
FROM ranked
WHERE image.id = ranked.id
  AND ranked.position > 17;
