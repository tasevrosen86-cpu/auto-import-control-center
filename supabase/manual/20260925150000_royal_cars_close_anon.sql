-- Royal Cars BG — closing the `anon` door. NOT APPLIED AUTOMATICALLY.
--
-- This file sits outside `supabase/migrations/` on purpose. Run it only after
-- the Mobile.bg workers carry a service-role key, because until then they reach
-- `mobile_bg_*`, `source_listing_jobs` and `publication_*` with the publishable
-- anon key and this file would stop publication.
--
-- Why it is needed. `anon` is a role anyone on the internet holds: the publishable
-- key is in the frontend bundle, which is served publicly. Every policy left on
-- `anon` reads `using (true)`, so a stranger who copies the key out of the bundle
-- can read every firm's drafts. Tenant separation for signed-in users does not
-- help there, because the stranger never signs in.
--
-- What to do first, in order:
--   1. Set the repository secret `SUPABASE_SERVICE_ROLE_KEY` (Supabase →
--      Project Settings → API → service_role). `deploy-vps.yml` writes it into
--      `/etc/aicc-publications.env`, `/etc/aicc-mobile-publisher.env` and
--      `/etc/aicc-mobile-bg-api.env`; all three workers read
--      `SUPABASE_SERVICE_ROLE_KEY` first and fall back to the anon key only if it
--      is missing, so a missing secret is silent. Confirm it is set.
--   2. Confirm each worker still works: run the API publisher once and see a job
--      reach READINESS, and run the mobile publisher once on a preview.
--   3. Confirm the frontend still signs in (it uses the publishable key, which is
--      unaffected).
--   4. Only then run this file against production Supabase.
--
-- Verify afterwards with the queries at the bottom: the first must return no row.
--
-- A note on how this file removes things. Almost every permissive policy in this
-- database was written `to anon, authenticated` — 128 of them, across `vehicles`,
-- `imports`, `publication_jobs`, the `mobile_bg_*` family and others. Dropping
-- every policy that mentions `anon` would therefore delete the *authenticated*
-- access on all those tables as well, and because RLS is enabled on them a
-- signed-in user would then be refused everything. So a policy that names both
-- roles is **rewritten** to name only `authenticated`, keeping its command and
-- its USING and WITH CHECK expressions exactly as they were; only a policy that
-- names `anon` alone is dropped.

-- ============================================================
-- 0. Before: what is about to change
-- ============================================================
-- Printed rather than acted on, so a run that goes wrong can be compared against
-- what the database looked like first.
do $$
declare
  n integer;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public' and 'anon' = any(roles);
  raise notice 'anon policies before: %', n;

  select count(*) into n
  from pg_policies
  where schemaname = 'public'
    and 'anon' = any(roles)
    and 'authenticated' = any(roles);
  raise notice '  of which also grant authenticated (rewritten, not dropped): %', n;
end $$;

-- ============================================================
-- 1. Take `anon` off every policy, keeping the authenticated half
-- ============================================================
do $$
declare
  pol record;
  cmd_clause text;
  perm_clause text;
  role_clause text;
  using_clause text;
  check_clause text;
  rewritten integer := 0;
  dropped integer := 0;
begin
  for pol in
    select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and 'anon' = any(roles)
    order by tablename, policyname
  loop
    -- Every role except `anon`, quoted, so a policy that also granted
    -- `service_role` keeps it. In this database the only two shapes are
    -- `anon, authenticated` and `anon` alone, but relying on that would make the
    -- file wrong the first time someone writes a third.
    select string_agg(format('%I', r), ', ')
      into role_clause
    from unnest(pol.roles) as r
    where r <> 'anon';

    if role_clause is not null then
      -- Recreate the same policy without `anon`. The command, the
      -- permissive/restrictive flag and both expressions are carried over
      -- verbatim, so the only change is the audience.
      execute format('drop policy %I on %I.%I',
                     pol.policyname, pol.schemaname, pol.tablename);

      cmd_clause := case pol.cmd when 'ALL' then 'all' else lower(pol.cmd) end;
      perm_clause := case when pol.permissive = 'RESTRICTIVE' then ' as restrictive' else '' end;
      -- `using` belongs to SELECT, UPDATE, DELETE and ALL; `with check` to
      -- INSERT, UPDATE and ALL. Whichever is null is simply omitted.
      using_clause := case when pol.qual is not null
                           then format(' using (%s)', pol.qual) else '' end;
      check_clause := case when pol.with_check is not null
                           then format(' with check (%s)', pol.with_check) else '' end;

      execute format('create policy %I on %I.%I%s for %s to %s%s%s',
                     pol.policyname, pol.schemaname, pol.tablename, perm_clause,
                     cmd_clause, role_clause, using_clause, check_clause);

      rewritten := rewritten + 1;
    else
      execute format('drop policy %I on %I.%I',
                     pol.policyname, pol.schemaname, pol.tablename);
      dropped := dropped + 1;
    end if;
  end loop;

  raise notice 'rewritten without anon: %', rewritten;
  raise notice 'dropped (they named anon alone): %', dropped;
end $$;

-- ============================================================
-- 2. Take the table privileges away from anon as well
-- ============================================================
-- A policy decides which rows; the grant decides whether at all. With the
-- policies gone the grants are already inert, but leaving them would mean the
-- next permissive policy reintroduced the hole by itself.
--
-- Every table in `public`, not a hand-written list: the list would have to be
-- maintained, and the point of this file is that nobody has to remember. `anon`
-- has no legitimate table access at all — the frontend uses it only to
-- authenticate, and that lives in the `auth` schema.
do $$
declare
  t record;
  revoked integer := 0;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    execute format('revoke all on table public.%I from anon', t.tablename);
    revoked := revoked + 1;
  end loop;

  -- Sequences are readable and advanceable in their own right; a leaked anon key
  -- should not be able to consume an id.
  for t in
    select sequencename from pg_sequences where schemaname = 'public' order by sequencename
  loop
    execute format('revoke all on sequence public.%I from anon', t.sequencename);
  end loop;

  raise notice 'tables revoked from anon: %', revoked;
end $$;

-- ============================================================
-- 3. And the functions anon could execute
-- ============================================================
-- The helper functions are the interesting ones. They are SECURITY DEFINER, so
-- executing one runs it with the definer's rights — `queue_source_intake` writes
-- a draft, `claim_*` hands out a job. None of them is needed by an
-- unauthenticated caller: the workers use the service role and the frontend
-- calls them only once signed in.
--
-- Guarded per function because these are created by several earlier migrations
-- and one may have been dropped by hand in the dashboard, in which case a bare
-- revoke would abort the whole file.
do $$
declare
  fn text;
  fn_names text[] := array[
    'is_system_admin_email',
    'current_profile_role',
    'current_company_id',
    'is_system_admin',
    'is_company_admin',
    'can_access_company',
    'can_access_draft',
    'claim_mobile_bg_publish_job',
    'claim_publication_job',
    'claim_publication_publish_job',
    'queue_source_intake'
  ];
  sig text;
begin
  foreach fn in array fn_names loop
    for sig in
      select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.proname = fn
    loop
      execute format('revoke all on function %s from anon', sig);
    end loop;
  end loop;
end $$;

-- ============================================================
-- 4. Verify
-- ============================================================
-- This must return zero rows. If it returns any, a policy still names anon.
--
--   select schemaname, tablename, policyname, roles
--   from pg_policies
--   where schemaname = 'public' and 'anon' = any(roles);
--
-- And these must return nothing for anon:
--
--   select table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
--
--   select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public','private')
--     and has_function_privilege('anon', p.oid, 'execute');
--
-- The counterpart check, and the one that catches the mistake this file exists to
-- avoid: a signed-in user must still reach the publishing tables. This must
-- return rows, for the commands the app uses.
--
--   select tablename, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('mobile_bg_drafts','mobile_bg_draft_fields',
--                       'mobile_bg_draft_images','mobile_bg_publish_jobs',
--                       'source_listing_jobs','publication_jobs')
--     and 'authenticated' = any(roles)
--   order by tablename, cmd;
