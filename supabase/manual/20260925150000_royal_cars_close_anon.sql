-- Royal Cars BG — closing the `anon` door. NOT APPLIED AUTOMATICALLY.
--
-- This file sits outside `supabase/migrations/` on purpose. Run it only after
-- the Mobile.bg workers carry a service-role key, because until then they reach
-- `mobile_bg_*` and `source_listing_jobs` with the public anon key and this
-- migration would stop publication.
--
-- Why it is needed. `anon` is a role anyone on the internet holds: the publishable
-- key is in the frontend bundle, which is served publicly. Every policy left on
-- `anon` reads `using (true)`, so a stranger who copies the key out of the bundle
-- can read every firm's drafts. Tenant separation for signed-in users does not
-- help there, because the stranger never signs in.
--
-- What to do first, in order:
--   1. Set the repository secret `SUPABASE_SERVICE_ROLE_KEY` (Supabase →
--      Project Settings → API → service_role). It is already read by
--      `deploy-vps.yml` and written into `/etc/aicc-publications.env`.
--   2. Add it to `/etc/aicc-mobile-bg-api.env` and `/etc/aicc-mobile-publisher.env`
--      as `SUPABASE_SERVICE_ROLE_KEY=...`.
--   3. Confirm each worker still works: run the API publisher once and see a job
--      reach READINESS, and run the mobile publisher once on a preview.
--   4. Confirm the frontend still signs in (it uses the publishable key, which is
--      unaffected).
--   5. Only then run this file against production Supabase.
--
-- Verify afterwards with the query at the bottom: it must return no row.

-- ============================================================
-- 1. Drop every permissive policy that still names anon
-- ============================================================
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and 'anon' = any(roles)
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    raise notice 'dropped % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  end loop;
end $$;

-- ============================================================
-- 2. Take the table privileges away from anon as well
-- ============================================================
-- A policy decides which rows; the grant decides whether at all. With the
-- policies gone the grants are already inert, but leaving them would mean the
-- next permissive policy reintroduced the hole by itself.
do $$
declare
  t text;
begin
  foreach t in array array[
    'mobile_bg_drafts', 'mobile_bg_draft_fields', 'mobile_bg_draft_extras',
    'mobile_bg_draft_images', 'mobile_bg_draft_action_log', 'mobile_bg_dedup_checks',
    'mobile_bg_publish_jobs', 'source_listing_jobs'
  ] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- The claim helper was reachable by anon too; only the service role needs it now.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_mobile_bg_publish_job'
  ) then
    execute 'revoke execute on function public.claim_mobile_bg_publish_job(text) from anon';
  end if;
end $$;

-- ============================================================
-- 3. Verify
-- ============================================================
-- Must return zero rows. If it returns any, a permissive policy still names
-- anon on that table.
--
--   select tablename, policyname, roles
--   from pg_policies
--   where schemaname = 'public' and 'anon' = any(roles);
--
-- And this must return no privilege for the publishing tables:
--
--   select table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'anon' and table_name like 'mobile_bg%';
