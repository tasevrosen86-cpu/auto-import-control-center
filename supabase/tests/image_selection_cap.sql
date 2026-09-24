-- Integration test for the 17-photo selection cap, run against a real Postgres
-- with the project's migrations applied.
--
-- It covers what the screen cannot show: that the cap holds when a client sends
-- its rows in any order, that the 17 kept are the smallest by display_order
-- rather than the first written, that is_main cannot jump the cap, that
-- deselecting frees a slot, that another draft is left alone, and that no photo
-- is ever deleted by the cap.
--
-- Everything runs inside one transaction that is rolled back, so it can be run
-- on a database that already holds data without changing it.
--
-- Run with: psql -d <db> -f supabase/tests/image_selection_cap.sql

begin;

do $$
declare
  v_asc uuid;
  v_desc uuid;
  v_other uuid;
  v_freed uuid;
  v_solo uuid;
  v_n integer;
  v_min integer;
  v_max integer;
  v_flag boolean;
  v_total integer;
begin
  -- The fixtures run as the table owner, which has no session, so the company
  -- has to be named. This is the same value the default fills in for a signed-in
  -- user.
  insert into public.mobile_bg_drafts (title, status, source_type, company_id)
  select t.title, 'DRAFT', 'catalog', c.id
  from (values ('TEST CAP ASC'), ('TEST CAP DESC'), ('TEST CAP OTHER'),
               ('TEST CAP FREED'), ('TEST CAP SOLO')) as t(title)
  cross join public.companies c where c.slug = 'royal-cars-bg';
  select id into v_asc from public.mobile_bg_drafts where title = 'TEST CAP ASC';
  select id into v_desc from public.mobile_bg_drafts where title = 'TEST CAP DESC';
  select id into v_other from public.mobile_bg_drafts where title = 'TEST CAP OTHER';
  select id into v_freed from public.mobile_bg_drafts where title = 'TEST CAP FREED';
  select id into v_solo from public.mobile_bg_drafts where title = 'TEST CAP SOLO';

  -- ---- 1. 22 photos inserted in ascending order: 17 stay selected ----
  insert into public.mobile_bg_draft_images (draft_id, source_url, is_selected, display_order)
  select v_asc, 'asc-' || g || '.jpg', true, g from generate_series(1, 22) g;

  select count(*), min(display_order), max(display_order) into v_n, v_min, v_max
  from public.mobile_bg_draft_images where draft_id = v_asc and is_selected;
  if v_n <> 17 or v_min <> 1 or v_max <> 17 then
    raise exception 'ascending insert: expected 17 selected (1..17), got % (%.%)', v_n, v_min, v_max;
  end if;

  -- ---- 2. The same 22 rows in descending order must give the same answer ----
  -- A row-level trigger passes this and fails this one, which is why the cap is
  -- enforced per statement.
  insert into public.mobile_bg_draft_images (draft_id, source_url, is_selected, display_order)
  select v_desc, 'desc-' || g || '.jpg', true, g from generate_series(22, 1, -1) g;

  select count(*), min(display_order), max(display_order) into v_n, v_min, v_max
  from public.mobile_bg_draft_images where draft_id = v_desc and is_selected;
  if v_n <> 17 or v_min <> 1 or v_max <> 17 then
    raise exception 'descending insert: expected 17 selected (1..17), got % (%.%)', v_n, v_min, v_max;
  end if;

  -- ---- 3. Nothing is deleted: all 22 rows are still on the draft ----
  select count(*) into v_total from public.mobile_bg_draft_images where draft_id = v_asc;
  if v_total <> 22 then
    raise exception 'cap deleted photos: expected 22 rows, found %', v_total;
  end if;

  -- ---- 4. Deselect one, select an eighteenth: the swap is allowed ----
  update public.mobile_bg_draft_images set is_selected = false
  where draft_id = v_asc and display_order = 5;
  update public.mobile_bg_draft_images set is_selected = true
  where draft_id = v_asc and display_order = 20;

  select count(*) into v_n from public.mobile_bg_draft_images where draft_id = v_asc and is_selected;
  select is_selected into v_flag from public.mobile_bg_draft_images
  where draft_id = v_asc and display_order = 20;
  if v_n <> 17 or v_flag is not true then
    raise exception 'swap: expected 17 selected with #20 in, got %, #20 selected=%', v_n, v_flag;
  end if;

  -- ---- 5. Selecting an eighteenth without deselecting is refused ----
  update public.mobile_bg_draft_images set is_selected = true
  where draft_id = v_asc and display_order = 21;

  select count(*) into v_n from public.mobile_bg_draft_images where draft_id = v_asc and is_selected;
  select is_selected into v_flag from public.mobile_bg_draft_images
  where draft_id = v_asc and display_order = 21;
  if v_n <> 17 or v_flag is not false then
    raise exception 'over-cap select: expected 17 selected and #21 refused, got %, #21 selected=%', v_n, v_flag;
  end if;

  -- ---- 6. Marking the last photo as main does not let it jump the cap ----
  update public.mobile_bg_draft_images set is_main = true
  where draft_id = v_asc and display_order = 22;

  select count(*), bool_or(is_selected) into v_n, v_flag
  from public.mobile_bg_draft_images where draft_id = v_asc and display_order = 22;
  if v_n <> 1 or v_flag is not false then
    raise exception 'is_main jumped the cap: #22 selected=%', v_flag;
  end if;

  -- ---- 7. Deleting a selected photo frees a slot ----
  insert into public.mobile_bg_draft_images (draft_id, source_url, is_selected, display_order)
  select v_freed, 'freed-' || g || '.jpg', true, g from generate_series(1, 20) g;
  delete from public.mobile_bg_draft_images where draft_id = v_freed and display_order = 1;
  update public.mobile_bg_draft_images set is_selected = true
  where draft_id = v_freed and display_order = 18;

  select count(*) into v_n from public.mobile_bg_draft_images where draft_id = v_freed and is_selected;
  if v_n <> 17 then
    raise exception 'freed slot: expected 17 selected, got %', v_n;
  end if;

  -- ---- 8. A draft with a single photo keeps it selected ----
  insert into public.mobile_bg_draft_images (draft_id, source_url, is_selected, display_order)
  values (v_solo, 'solo.jpg', true, 1);
  select count(*) into v_n from public.mobile_bg_draft_images where draft_id = v_solo and is_selected;
  if v_n <> 1 then
    raise exception 'single photo: expected 1 selected, got %', v_n;
  end if;

  -- ---- 9. Writing to one draft leaves another draft's selection alone ----
  insert into public.mobile_bg_draft_images (draft_id, source_url, is_selected, display_order)
  select v_other, 'other-' || g || '.jpg', true, g from generate_series(1, 5) g;
  select count(*) into v_n from public.mobile_bg_draft_images where draft_id = v_asc and is_selected;
  if v_n <> 17 then
    raise exception 'unrelated write changed another draft: expected 17, got %', v_n;
  end if;

  -- ---- 10. Business rule: no draft anywhere holds more than 17 ----
  select count(*) into v_n from (
    select draft_id from public.mobile_bg_draft_images
    where is_selected group by draft_id having count(*) > 17
  ) over_cap;
  if v_n <> 0 then
    raise exception 'found % draft(s) over the cap', v_n;
  end if;

  raise notice 'All 17-photo cap checks passed.';
end $$;

rollback;
