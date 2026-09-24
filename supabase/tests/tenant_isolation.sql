-- Tenant isolation tests, run against a real Postgres with every migration
-- applied. They prove the separation holds at the database, not in the menu.
--
-- Run with: supabase/tests/harness/isolation.sh
--
-- The structure matters as much as the assertions. Fixtures are created first,
-- while the session is the table owner, because a broker is not allowed to
-- invent a second company or place a user in one. Then the session becomes
-- `authenticated` — RLS does not apply to the owner, so checking as postgres
-- would prove nothing — and each block signs in as a different user by setting
-- the same setting Supabase fills from the JWT.
--
-- Everything runs inside one transaction that is rolled back, so a database
-- that already holds data is left unchanged.

-- ============================================================
-- Fixtures, as the owner
-- ============================================================
begin;

do $$
declare
  v_royal uuid;
  v_other uuid;
  v_admin uuid;
  v_royal_admin uuid;
  v_royal_broker uuid;
  v_other_broker uuid;
  v_nobody uuid;
  v_royal_draft uuid;
  v_other_draft uuid;
begin
  select id into v_royal from public.companies where slug = 'royal-cars-bg';
  if v_royal is null then
    raise exception 'Royal Cars BG was not created — the migration did not run';
  end if;

  insert into public.companies (slug, name) values ('test-other-company', 'Test Other Company')
  returning id into v_other;

  insert into auth.users (email) values
    ('isolation-admin@test.local'), ('isolation-royal-admin@test.local'),
    ('isolation-royal-broker@test.local'), ('isolation-other-broker@test.local'),
    ('isolation-nobody@test.local');

  select id into v_admin from auth.users where email = 'isolation-admin@test.local';
  select id into v_royal_admin from auth.users where email = 'isolation-royal-admin@test.local';
  select id into v_royal_broker from auth.users where email = 'isolation-royal-broker@test.local';
  select id into v_other_broker from auth.users where email = 'isolation-other-broker@test.local';
  select id into v_nobody from auth.users where email = 'isolation-nobody@test.local';

  -- A user signing up lands on BROKER with no company; that is the state a real
  -- new user is in before an administrator places them.
  if not exists (select 1 from public.profiles where user_id = v_royal_broker and role = 'BROKER') then
    raise exception 'a new auth user did not get a BROKER profile';
  end if;
  if not exists (select 1 from public.profiles where user_id = v_royal_broker and company_id is null) then
    raise exception 'a new auth user was given a company without being placed';
  end if;

  update public.profiles set company_id = v_royal, role = 'COMPANY_ADMIN' where user_id = v_royal_admin;
  update public.profiles set company_id = v_royal where user_id = v_royal_broker;
  update public.profiles set company_id = v_other where user_id = v_other_broker;

  -- The administrator is promoted through the table that is out of client reach.
  insert into private.system_admins (email) values ('isolation-admin@test.local')
  on conflict (email) do nothing;
  update public.profiles set role = 'SYSTEM_ADMIN' where user_id = v_admin;

  -- Promoting to SYSTEM_ADMIN must strip the company, or the role claims global
  -- access while still matching one firm.
  if (select company_id from public.profiles where user_id = v_admin) is not null then
    raise exception 'a system administrator kept a company_id';
  end if;

  insert into public.mobile_bg_drafts (title, status, source_type, company_id)
  values ('ISOLATION ROYAL', 'PUBLISHED', 'encar', v_royal) returning id into v_royal_draft;
  insert into public.mobile_bg_drafts (title, status, source_type, company_id)
  values ('ISOLATION OTHER', 'PUBLISHED', 'encar', v_other) returning id into v_other_draft;

  insert into public.mobile_bg_draft_fields (draft_id, field_key, mobile_bg_label, our_db_key, value)
  values (v_royal_draft, 'make', 'Марка', 'make', 'Audi'),
         (v_other_draft, 'make', 'Марка', 'make', 'BMW');

  insert into public.mobile_bg_publish_jobs (draft_id, status, company_id)
  values (v_royal_draft, 'COMPLETED', v_royal), (v_other_draft, 'COMPLETED', v_other);

  insert into public.master_catalog (permanent_id, make, model, model_year, fuel)
  values (999001, 'TEST', 'CATALOG', 2020, 'Бензин');

  perform set_config('test.royal', v_royal::text, true);
  perform set_config('test.other', v_other::text, true);
  perform set_config('test.admin', v_admin::text, true);
  perform set_config('test.royal_admin', v_royal_admin::text, true);
  perform set_config('test.royal_broker', v_royal_broker::text, true);
  perform set_config('test.other_broker', v_other_broker::text, true);
  perform set_config('test.nobody', v_nobody::text, true);
  perform set_config('test.royal_draft', v_royal_draft::text, true);
  perform set_config('test.other_draft', v_other_draft::text, true);
end $$;

-- ============================================================
-- The checks, as a signed-in but unprivileged role
-- ============================================================
set local role authenticated;

do $$
declare
  v_other uuid := current_setting('test.other')::uuid;
  v_admin uuid := current_setting('test.admin')::uuid;
  v_royal_admin uuid := current_setting('test.royal_admin')::uuid;
  v_royal_broker uuid := current_setting('test.royal_broker')::uuid;
  v_other_broker uuid := current_setting('test.other_broker')::uuid;
  v_nobody uuid := current_setting('test.nobody')::uuid;
  v_royal_draft uuid := current_setting('test.royal_draft')::uuid;
  v_other_draft uuid := current_setting('test.other_draft')::uuid;
  v_leaked integer;
  v_visible integer;
begin
  -- ---- 1. a broker sees only their own company's drafts ---------------
  perform set_config('request.jwt.claim.sub', v_royal_broker::text, true);

  select count(*) into v_visible from public.mobile_bg_drafts;
  if v_visible <> 1 then
    raise exception 'broker sees % drafts, expected exactly 1', v_visible;
  end if;
  if not exists (select 1 from public.mobile_bg_drafts where id = v_royal_draft) then
    raise exception 'broker cannot see their own draft';
  end if;

  -- Asked for by id, so the filter cannot be blamed on a list query.
  select count(*) into v_leaked from public.mobile_bg_drafts where id = v_other_draft;
  if v_leaked <> 0 then
    raise exception 'broker sees another company''s draft — isolation is broken';
  end if;

  -- Children must not leak either, even when asked for by id.
  select count(*) into v_leaked from public.mobile_bg_draft_fields where draft_id = v_other_draft;
  if v_leaked <> 0 then
    raise exception 'broker sees another company''s draft fields';
  end if;

  select count(*) into v_leaked from public.mobile_bg_publish_jobs where draft_id = v_other_draft;
  if v_leaked <> 0 then
    raise exception 'broker sees another company''s publish jobs';
  end if;

  -- Writing into another company has to fail, not silently succeed.
  begin
    insert into public.mobile_bg_drafts (title, status, source_type, company_id)
    values ('CROSS COMPANY INSERT', 'DRAFT', 'encar', v_other);
    raise exception 'a broker was allowed to insert a draft into another company';
  exception
    when insufficient_privilege then null;
  end;

  -- Moving their own draft to another company has to fail as well.
  begin
    update public.mobile_bg_drafts set company_id = v_other where id = v_royal_draft;
    raise exception 'a broker was allowed to move a draft to another company';
  exception
    when insufficient_privilege then null;
  end;

  -- ---- 2. the published-listings view is scoped too -------------------
  -- This is the list the broker reads on the phone; a view is easy to get wrong
  -- because it runs as its owner unless told otherwise.
  select count(*) into v_visible from public.mobile_bg_published_listings;
  if v_visible <> 1 then
    raise exception 'broker sees % published listings, expected 1', v_visible;
  end if;
  select count(*) into v_leaked from public.mobile_bg_published_listings where id = v_other_draft;
  if v_leaked <> 0 then
    raise exception 'the published-listings view leaks another company''s row';
  end if;

  -- The view reaches make, model and the photo through
  -- `mobile_bg_draft_attributes`, which is SECURITY DEFINER and therefore runs
  -- with the owner's rights. It has to apply the company check itself, or any
  -- signed-in user could pass another firm's draft id and read that car.
  select count(*) into v_leaked
  from public.mobile_bg_draft_attributes(v_other_draft);
  if v_leaked <> 0 then
    raise exception 'the attribute helper leaks another company''s car details';
  end if;

  select count(*) into v_visible
  from public.mobile_bg_draft_attributes(v_royal_draft);
  if v_visible <> 1 then
    raise exception 'the attribute helper withheld the broker''s own draft';
  end if;

  -- ---- 3. a company admin sees their firm and only their firm ---------
  perform set_config('request.jwt.claim.sub', v_royal_admin::text, true);

  select count(*) into v_visible from public.mobile_bg_drafts;
  if v_visible <> 1 then
    raise exception 'company admin sees % drafts, expected 1', v_visible;
  end if;
  if not public.is_company_admin() then
    raise exception 'company admin is not recognised as one';
  end if;
  if public.is_system_admin() then
    raise exception 'a company admin must not be a system admin';
  end if;

  -- ---- 4. the other company sees only its own ------------------------
  perform set_config('request.jwt.claim.sub', v_other_broker::text, true);
  select count(*) into v_visible from public.mobile_bg_drafts;
  if v_visible <> 1 then
    raise exception 'the other company''s broker sees % drafts, expected 1', v_visible;
  end if;
  select count(*) into v_leaked from public.mobile_bg_drafts where id = v_royal_draft;
  if v_leaked <> 0 then
    raise exception 'the other company''s broker sees a Royal Cars draft';
  end if;

  -- ---- 5. a user with no company sees nothing ------------------------
  perform set_config('request.jwt.claim.sub', v_nobody::text, true);
  select count(*) into v_visible from public.mobile_bg_drafts;
  if v_visible <> 0 then
    raise exception 'a user with no company sees % drafts, expected 0', v_visible;
  end if;

  -- ---- 6. the master catalog is invisible to a firm ------------------
  -- The requirement is explicit: a company admin and a broker must not reach the
  -- internal catalog, not even by calling the API directly.
  perform set_config('request.jwt.claim.sub', v_royal_admin::text, true);
  select count(*) into v_leaked from public.master_catalog;
  if v_leaked <> 0 then
    raise exception 'a company admin reads % master catalog rows, expected 0', v_leaked;
  end if;
  select count(*) into v_leaked from public.master_catalog_card(999001);
  if v_leaked <> 0 then
    raise exception 'a company admin reached a catalog row through master_catalog_card';
  end if;
  -- And cannot write to it either.
  begin
    insert into public.master_catalog (permanent_id, make) values (999002, 'HACK');
    raise exception 'a company admin was allowed to write to the master catalog';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', v_royal_broker::text, true);
  select count(*) into v_leaked from public.master_catalog;
  if v_leaked <> 0 then
    raise exception 'a broker reads % master catalog rows, expected 0', v_leaked;
  end if;
  select count(*) into v_leaked from public.master_catalog_card(999001);
  if v_leaked <> 0 then
    raise exception 'a broker reached a catalog row through master_catalog_card';
  end if;

  -- ---- 7. the system administrator still reaches everything ----------
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  if not public.is_system_admin() then
    raise exception 'the system administrator is not recognised';
  end if;

  select count(*) into v_visible from public.mobile_bg_drafts;
  if v_visible <> 2 then
    raise exception 'system admin sees % drafts, expected both (2)', v_visible;
  end if;

  select count(*) into v_visible from public.mobile_bg_published_listings;
  if v_visible <> 2 then
    raise exception 'system admin sees % published listings, expected 2', v_visible;
  end if;

  select count(*) into v_visible from public.master_catalog where permanent_id = 999001;
  if v_visible <> 1 then
    raise exception 'system admin cannot read the master catalog';
  end if;

  -- ---- 8. prices are separate and the difference is computed ---------
  perform set_config('request.jwt.claim.sub', v_royal_broker::text, true);
  update public.mobile_bg_drafts
     set source_price_eur = 30000, calculated_price_eur = 32500, published_price_eur = 33900
   where id = v_royal_draft;

  if (select source_price_eur from public.mobile_bg_drafts where id = v_royal_draft) <> 30000 then
    raise exception 'the source price was overwritten by the calculated or published price';
  end if;
  if (select price_difference_eur from public.mobile_bg_published_listings where id = v_royal_draft) <> 1400 then
    raise exception 'the published/calculated difference is not 1400';
  end if;

  -- The difference stays null rather than wrong when only one price is known.
  update public.mobile_bg_drafts set calculated_price_eur = null where id = v_royal_draft;
  if (select price_difference_eur from public.mobile_bg_published_listings where id = v_royal_draft) is not null then
    raise exception 'a difference was computed with no calculated price';
  end if;

  -- ---- 9. the system administrator can still publish as Royal Cars ----
  -- The owner works in Royal Cars BG as well; global access must not mean the
  -- firm's workflow is out of reach.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  update public.mobile_bg_drafts
     set source_price_eur = 10000, calculated_price_eur = 11000, published_price_eur = 11500
   where id = v_royal_draft;
  if (select price_difference_eur from public.mobile_bg_published_listings where id = v_royal_draft) <> 500 then
    raise exception 'the system admin could not work on a Royal Cars draft';
  end if;

  -- ---- 10. a suspended broker cannot publish -------------------------
  -- Suspension is applied by an administrator; a broker cannot lift it by
  -- editing their own profile, which is checked separately below.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  update public.profiles set status = 'SUSPENDED' where user_id = v_royal_broker;

  perform set_config('request.jwt.claim.sub', v_royal_broker::text, true);
  select count(*) into v_visible from public.mobile_bg_drafts;
  if v_visible <> 0 then
    raise exception 'a suspended broker still sees % drafts', v_visible;
  end if;

  -- ---- 11. a broker cannot promote themselves or move themselves ------
  begin
    update public.profiles set role = 'SYSTEM_ADMIN' where user_id = v_royal_broker;
    raise exception 'a broker was allowed to set their own role';
  exception
    when insufficient_privilege then null;
  end;
  begin
    update public.profiles set company_id = v_other where user_id = v_royal_broker;
    raise exception 'a broker was allowed to move themselves to another company';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- ============================================================
-- The intake function must file under the caller's company
-- ============================================================
-- Called the way the Edge Function calls it: `p_requested_by` carries the
-- acting user, because the function runs as SECURITY DEFINER and cannot trust
-- the session. It is service-role-only by grant, so the call here is made with
-- that user id explicitly rather than as a signed-in client.
do $$
declare
  v_other uuid := current_setting('test.other')::uuid;
  v_other_broker uuid := current_setting('test.other_broker')::uuid;
  v_royal uuid := current_setting('test.royal')::uuid;
  v_royal_broker uuid := current_setting('test.royal_broker')::uuid;
  v_result record;
begin
  reset role;

  select * into v_result from public.queue_source_intake(
    'https://fem.encar.com/cars/detail/999888777', 'encar', 'fem.encar.com', '999888777',
    'LINK_FIELD', null, null, v_other_broker
  );
  if not v_result.was_created then
    raise exception 'the intake function did not create a draft for the first company';
  end if;

  if not exists (
    select 1 from public.mobile_bg_drafts
    where source_listing_id = '999888777' and company_id = v_other
  ) then
    raise exception 'the intake function did not file the draft under the caller''s company';
  end if;

  -- The job that carries the link must be scoped the same way.
  if not exists (
    select 1 from public.source_listing_jobs
    where source_identity = 'fem.encar.com|999888777' and company_id = v_other
  ) then
    raise exception 'the intake job was not filed under the caller''s company';
  end if;

  -- Clicking the same link twice within one firm returns the same draft.
  select * into v_result from public.queue_source_intake(
    'https://fem.encar.com/cars/detail/999888777', 'encar', 'fem.encar.com', '999888777',
    'LINK_FIELD', null, null, v_other_broker
  );
  if v_result.was_created then
    raise exception 'the same link produced a second draft within one company';
  end if;

  -- Two firms importing the same link are two different deals, so the second
  -- firm must get its own draft rather than the first firm's.
  select * into v_result from public.queue_source_intake(
    'https://fem.encar.com/cars/detail/999888777', 'encar', 'fem.encar.com', '999888777',
    'LINK_FIELD', null, null, v_royal_broker
  );
  if not v_result.was_created then
    raise exception 'the second company was given the first company''s draft instead of its own';
  end if;
  if not exists (
    select 1 from public.mobile_bg_drafts
    where source_listing_id = '999888777' and company_id = v_royal
  ) then
    raise exception 'the draft for the second company is missing';
  end if;

  -- The whole function is server-only; a browser client must not reach it.
  if has_function_privilege('authenticated',
      'public.queue_source_intake(text, text, text, text, text, integer, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.queue_source_intake(text, text, text, text, text, integer, text, uuid)', 'EXECUTE') then
    raise exception 'the intake function is reachable by a client role';
  end if;
  if not has_function_privilege('service_role',
      'public.queue_source_intake(text, text, text, text, text, integer, text, uuid)', 'EXECUTE') then
    raise exception 'the intake function is not reachable by the service role';
  end if;
end $$;

-- ============================================================
-- The shape of the policies, which the data cannot show
-- ============================================================
-- Back to an unprivileged role: the intake block above left the session as the
-- owner, and as the owner every count would pass trivially.
set local role authenticated;

do $$
declare
  v_bad text;
  v_total integer;
begin
  perform set_config('request.jwt.claim.sub', current_setting('test.other_broker'), true);

  -- A leftover permissive policy is invisible from the data when every row
  -- happens to belong to one company, which is exactly today's state.
  select string_agg(format('%s.%s', tablename, policyname), ', ') into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'mobile_bg_drafts', 'mobile_bg_draft_fields', 'mobile_bg_draft_extras',
      'mobile_bg_draft_images', 'mobile_bg_draft_action_log', 'mobile_bg_publish_jobs'
    )
    and roles = array['authenticated']::name[]
    and qual = 'true';

  if v_bad is not null then
    raise exception 'permissive authenticated policies remain: %', v_bad;
  end if;

  -- Two drafts exist for the other company now (the fixture and the intake one),
  -- so the count is checked to be exact rather than merely non-zero.
  select count(*) into v_total from public.mobile_bg_drafts;
  if v_total <> 2 then
    raise exception 'the intake test left % drafts visible to the other company, expected 2', v_total;
  end if;
end $$;

-- ============================================================
-- The owner can publish without holding a company
-- ============================================================
-- A system administrator has no `company_id` on purpose, and the frontend
-- inserts a draft without naming a company — it relies on the column default.
-- That default reads the session, which for the owner yields null, and the
-- column is NOT NULL: the insert failed before any policy was consulted. The
-- menu sends the owner through the same publishing workflow as a company user,
-- so this was the owner's own path. `private.fill_company_id` resolves it.
set local role authenticated;

do $$
declare
  v_admin uuid := current_setting('test.admin')::uuid;
  v_royal uuid := current_setting('test.royal')::uuid;
  v_draft uuid;
  v_job_company uuid;
  v_draft_company uuid;
begin
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.mobile_bg_drafts (title, status, source_type)
  values ('OWNER UNPLACED', 'DRAFT', 'encar')
  returning id, company_id into v_draft, v_draft_company;

  if v_draft_company is null then
    raise exception 'the owner''s draft landed with no company';
  end if;
  if v_draft_company <> v_royal then
    raise exception 'the owner''s draft went to % instead of Royal Cars BG', v_draft_company;
  end if;

  -- The queue tables follow the draft rather than the session, which is what
  -- makes a job belong to the same firm as the listing it publishes.
  insert into public.mobile_bg_publish_jobs (draft_id, status)
  values (v_draft, 'QUEUED')
  returning company_id into v_job_company;

  if v_job_company <> v_royal then
    raise exception 'the owner''s publish job went to % instead of Royal Cars BG', v_job_company;
  end if;
end $$;

rollback;
