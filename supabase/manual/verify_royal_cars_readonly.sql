-- ============================================================
-- READ-ONLY. Every statement below is a SELECT. It writes nothing.
-- ============================================================

-- 1. The two functions are the corrected ones.
select '1. functions' as check, p.oid::regprocedure::text as detail,
       p.prosecdef as secdef,
       has_function_privilege('service_role', p.oid, 'execute') as svc_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and p.proname in ('fill_company_id','queue_source_intake')
order by 2;

-- 2. The aggregate is gone. MUST return zero rows.
select '2. STILL BROKEN' as check, p.oid::regprocedure::text as detail
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and p.proname in ('fill_company_id','queue_source_intake')
  and pg_get_functiondef(p.oid) ~ 'min\(c\.id\)\s+into';

-- 3. The signature kept all nine arguments and their defaults,
--    and the old eight-argument version is not left behind.
select '3. signature' as check, p.oid::regprocedure::text as detail,
       pg_get_function_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'queue_source_intake'
order by 2;

-- 4. Everything the two functions lean on is present and callable.
select '4. dependencies' as check, d.name as detail, d.present
from (values
  ('private.fill_company_id',      to_regprocedure('private.fill_company_id()') is not null),
  ('public.current_company_id',    to_regprocedure('public.current_company_id()') is not null),
  ('public.is_system_admin',       to_regprocedure('public.is_system_admin()') is not null),
  ('public.companies',             to_regclass('public.companies') is not null),
  ('public.profiles',              to_regclass('public.profiles') is not null),
  ('public.mobile_bg_drafts',      to_regclass('public.mobile_bg_drafts') is not null),
  ('public.mobile_bg_publish_jobs',to_regclass('public.mobile_bg_publish_jobs') is not null),
  ('public.source_listing_jobs',   to_regclass('public.source_listing_jobs') is not null),
  ('public.mobile_bg_draft_action_log', to_regclass('public.mobile_bg_draft_action_log') is not null)
) as d(name, present)
order by 2;

-- 5. The trigger is still attached to both tables.
select '5. trigger' as check, c.relname as detail, t.tgname,
       pg_get_triggerdef(t.oid) as def
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
  and c.relname in ('mobile_bg_drafts','mobile_bg_publish_jobs','source_listing_jobs')
order by 2;

-- 6. current_company_id answers instead of aborting.
select '6. current_company_id' as check, public.current_company_id()::text as detail;

-- 7. SYSTEM_ADMIN must hold no company.
select '7. admins with a company' as check, count(*)::text as detail
from public.profiles where role = 'SYSTEM_ADMIN' and company_id is not null;

-- 8. How many active companies exist. 1 = the fallback answers; 2+ = the
--    owner must name the company and the fallback refuses, by design.
select '8. companies' as check,
       count(*)::text as total,
       count(*) filter (where status = 'ACTIVE')::text as active,
       string_agg(slug, ', ' order by slug) as slugs
from public.companies;

-- 9. Every existing draft belongs to a real company. "no company" must be 0.
select '9. drafts by company' as check,
       coalesce(c.slug, '<NO COMPANY>') as detail,
       count(*)::text as drafts
from public.mobile_bg_drafts d
left join public.companies c on c.id = d.company_id
group by 2 order by 3 desc;

-- 10. The same for the publish and queue tables.
select '10. jobs by company' as check, j.tbl as detail,
       coalesce(c.slug,'<NO COMPANY>') as company, j.n::text as rows
from (
  select 'publish_jobs' as tbl, company_id, count(*) n from public.mobile_bg_publish_jobs group by 2
  union all
  select 'source_listing_jobs', company_id, count(*) from public.source_listing_jobs group by 2
) j
left join public.companies c on c.id = j.company_id
order by 2, 4 desc;

-- 11. RLS is on everywhere and no table is left enabled without a policy.
select '11. rls' as check, c.relname as detail
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 2;
