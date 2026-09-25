-- Royal Cars BG — `min(uuid)`, the runtime bug in the tenant-isolation migration.
-- APPLY THIS TO PRODUCTION on its own; `20260925130000` is already applied there.
--
-- Why this file exists rather than an edit to `20260925130000`. That migration is
-- already in production, so changing it would fix nothing on the live database —
-- the broken function bodies are already stored. Re-running the whole thing would
-- work (it is written to be re-runnable) but it re-creates every `anon` policy in
-- its section 3, and `supabase/manual/20260925150000_royal_cars_close_anon.sql`
-- removes them. Running the two in the wrong order silently reopens the hole the
-- manual file exists to close. This file only replaces the two functions and
-- touches nothing else, so it is safe to run at any point, before or after the
-- manual file.
--
-- The bug. Both functions resolved "the one active company" with
--
--   select count(*), min(c.id) into v_active_count, v_active_company
--
-- and `companies.id` is `uuid`. PostgreSQL has no `min` for `uuid`, so the call
-- aborted with
--
--   ERROR: 42883: function min(uuid) does not exist
--
-- The two places it appears are the first thing the owner does in the app:
-- `private.fill_company_id` runs as a BEFORE INSERT trigger on `mobile_bg_drafts`
-- and `mobile_bg_publish_jobs`, and `public.queue_source_intake` is the function
-- behind the URL import path. So the owner's very first draft and very first
-- pasted link both failed, with an error naming a missing function rather than
-- anything about companies. The migration applied cleanly because a function body
-- is not validated against catalogue functions until it runs.
--
-- The fix keeps the intent — a single active company answers for a system
-- administrator who holds none — and reads it in two statements. `min(uuid)`
-- would also have been meaningless: the least uuid in a set is not a company
-- anyone chose.
--
-- The bodies below are copied verbatim from the corrected migration, with only
-- the aggregate replaced. Nothing else about either function is changed: the
-- dedup query, the generated title, the `SOURCE_PENDING` extraction status and
-- the action-log entry all stay exactly as they are.

-- ============================================================
-- 1. The insert trigger's resolver
-- ============================================================

create or replace function private.fill_company_id()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_company uuid := new.company_id;
  -- The table that owns the company carries it itself; the two queue tables
  -- reach it through the draft they belong to. `mobile_bg_drafts` has no
  -- `draft_id`, so the lookup is skipped for it rather than casting a null.
  v_draft_id uuid := case
    when tg_table_name <> 'mobile_bg_drafts' then (to_jsonb(new) ->> 'draft_id')::uuid
    else null
  end;
  v_active_count integer;
begin
  if v_company is null and v_draft_id is not null then
    select d.company_id into v_company
    from public.mobile_bg_drafts d
    where d.id = v_draft_id;
  end if;

  if v_company is null then
    v_company := public.current_company_id();
  end if;

  if v_company is null and public.is_system_admin() then
    select count(*) into v_active_count
    from public.companies c
    where c.status = 'ACTIVE';

    -- Read in a second statement rather than as `min(c.id)` in this one:
    -- PostgreSQL has no `min` for `uuid`, and the aggregate fails at run time
    -- with `42883: function min(uuid) does not exist` — on the owner's very
    -- first draft, which is the one path this branch exists to fix.
    if v_active_count = 1 then
      select c.id into v_company
      from public.companies c
      where c.status = 'ACTIVE';
    end if;
  end if;

  if v_company is null then
    raise exception 'Фирмата не можа да бъде определена. Задайте company_id изрично.'
      using errcode = '23502';
  end if;

  new.company_id := v_company;
  return new;
end;
$$;

-- ============================================================
-- 2. The URL import path
-- ============================================================
-- The signature must match the existing function exactly — the same nine
-- arguments with the same defaults. A different argument list creates a *second*
-- function rather than replacing the old one, and the old one would stay behind,
-- still inserting without a company. `20260925120000`'s own note warns about
-- exactly this, and it is why the long-form list is repeated here.
--
-- The eight-argument version is dropped for the same reason it is dropped in
-- `20260925130000`: a defaulted ninth argument means `create or replace` would
-- otherwise leave the older signature in place.

create or replace function public.queue_source_intake(
  p_source_url text,
  p_source_type text,
  p_source_domain text,
  p_source_listing_id text,
  p_intake_origin text default 'LINK_FIELD',
  p_catalog_permanent_id integer default null,
  p_title text default null,
  p_requested_by uuid default null,
  p_company_id uuid default null
)
returns table(draft_id uuid, was_created boolean, job_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_url text := trim(coalesce(p_source_url, ''));
  v_source_domain text := lower(trim(coalesce(p_source_domain, '')));
  v_source_listing_id text := nullif(trim(coalesce(p_source_listing_id, '')), '');
  v_company_id uuid;
  v_identity text;
  v_existing_draft_id uuid;
  v_new_draft_id uuid;
  v_title text;
  v_role text;
  v_active_count integer;
begin
  if p_requested_by is null then
    raise exception 'Липсва идентифициран потребител.' using errcode = '42501';
  end if;

  -- The acting user's profile decides the company, never the row being written.
  -- The role is read from the same lookup because the caller here is the Edge
  -- Function, running as the service role: `auth.uid()` is null inside this
  -- call, so `public.is_system_admin()` cannot answer for the person on whose
  -- behalf it is acting.
  select p.company_id, p.role into v_company_id, v_role
  from public.profiles p where p.user_id = p_requested_by;

  -- An explicitly chosen company is taken at face value only from a system
  -- administrator. Anyone else naming a firm is refused rather than quietly
  -- given their own, because silently ignoring the request would hide a real
  -- mistake.
  if p_company_id is not null then
    if v_role <> 'SYSTEM_ADMIN' then
      raise exception 'Само системен администратор може да избере друга фирма.'
        using errcode = '42501';
    end if;
    if not exists (select 1 from public.companies c where c.id = p_company_id) then
      raise exception 'Избраната фирма не съществува.' using errcode = '23503';
    end if;
    v_company_id := p_company_id;
  end if;

  -- A system administrator holds no company on purpose, and needs one to import
  -- a link: the owner works in Royal Cars BG through the same workflow as a
  -- company user. The single active company answers for them, exactly as the
  -- insert trigger does. A broker who has not been placed is still refused —
  -- filing them into whichever company happens to exist would be the silent
  -- misplacement this migration is about.
  --
  -- This fallback is deliberately short-lived. It works while one firm exists and
  -- stops working the moment there are two, which is the point: from then on the
  -- owner names the company, and nothing quietly assumes Royal Cars.
  if v_company_id is null and v_role = 'SYSTEM_ADMIN' then
    select count(*) into v_active_count
    from public.companies c
    where c.status = 'ACTIVE';

    -- Two statements, not `min(c.id)`: PostgreSQL has no `min` for `uuid`, and
    -- the aggregate would fail with `42883: function min(uuid) does not exist`
    -- on the owner's first import.
    if v_active_count = 1 then
      select c.id into v_company_id
      from public.companies c
      where c.status = 'ACTIVE';
    end if;
  end if;

  if v_company_id is null then
    if v_role = 'SYSTEM_ADMIN' then
      raise exception 'Изберете фирма, за която да импортирате линка.' using errcode = '42501';
    end if;
    raise exception 'Профилът няма фирма.' using errcode = '42501';
  end if;

  if v_source_url = '' or v_source_domain = '' then
    raise exception 'Липсва валиден линк към източниковата обява.' using errcode = '22023';
  end if;

  v_identity := v_source_domain || '|' || coalesce(
    v_source_listing_id,
    lower(regexp_replace(v_source_url, '[?#].*$', ''))
  );

  -- Locked per company: two brokers in the same firm clicking the same link get
  -- one draft between them, while two different firms never wait on each other.
  perform pg_advisory_xact_lock(hashtext(v_company_id::text || '|' || v_identity));

  select job.draft_id into v_existing_draft_id
  from public.source_listing_jobs as job
  where job.source_identity = v_identity
    and job.company_id = v_company_id
    and job.status in ('QUEUED', 'RUNNING', 'COMPLETED')
  limit 1;

  if v_existing_draft_id is not null then
    return query select v_existing_draft_id, false, 'EXISTS';
    return;
  end if;

  v_title := coalesce(
    nullif(trim(p_title), ''),
    'Изчаква извличане — ' || v_source_domain || coalesce(' #' || v_source_listing_id, '')
  );

  insert into public.mobile_bg_drafts (
    catalog_permanent_id, title, status, source_type, source_url,
    source_listing_id, intake_origin, extraction_status, source_domain, created_by,
    company_id
  ) values (
    p_catalog_permanent_id, v_title, 'DRAFT', p_source_type, v_source_url,
    v_source_listing_id, p_intake_origin, 'SOURCE_PENDING', v_source_domain, p_requested_by::text,
    v_company_id
  ) returning id into v_new_draft_id;

  insert into public.source_listing_jobs (
    draft_id, source_type, source_url, source_identity, status, company_id
  ) values (
    v_new_draft_id, p_source_type, v_source_url, v_identity, 'QUEUED', v_company_id
  );

  insert into public.mobile_bg_draft_action_log (draft_id, action, actor, details)
  values (
    v_new_draft_id,
    'SOURCE_LINK_QUEUED',
    p_requested_by::text,
    jsonb_build_object(
      'intake_origin', p_intake_origin,
      'source_type', p_source_type,
      'source_url', v_source_url,
      'source_listing_id', v_source_listing_id,
      'catalog_permanent_id', p_catalog_permanent_id,
      'company_id', v_company_id
    )
  );

  return query select v_new_draft_id, true, 'QUEUED';
end;
$$;

drop function if exists public.queue_source_intake(text, text, text, text, text, integer, text, uuid);

-- The grants are re-stated because the function is replaced, not because they
-- are expected to differ. `create or replace` keeps the existing ACL, so this
-- only matters on a database where the function was recreated by hand.
revoke all on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) from public;
revoke all on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) from anon;
revoke all on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) from authenticated;
grant execute on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) to service_role;

-- ============================================================
-- 3. Verify
-- ============================================================
-- Neither function may still contain the aggregate. This must return no row.
--
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public','private')
--     and p.proname in ('fill_company_id','queue_source_intake')
--     and pg_get_functiondef(p.oid) ilike '%min(c.id)%';
--
-- And the resolver must answer rather than abort. With one active company this
-- returns its id; with two, or none, it returns null and the caller refuses.
--
--   select count(*) from public.companies where status = 'ACTIVE';
