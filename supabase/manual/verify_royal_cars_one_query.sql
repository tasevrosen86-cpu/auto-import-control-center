-- ============================================================
-- READ-ONLY. One query, one result set. Nothing is written.
-- ============================================================
with
  f as (
    select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and p.proname in ('fill_company_id','queue_source_intake')
  ),
  broken as (
    select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and p.proname in ('fill_company_id','queue_source_intake')
      and pg_get_functiondef(p.oid) ~ 'min\(c\.id\)\s+into'
  ),
  secdef as (
    select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and p.proname in ('fill_company_id','queue_source_intake')
      and p.prosecdef
  ),
  svcexec as (
    select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'queue_source_intake'
      and has_function_privilege('service_role', p.oid, 'execute')
  ),
  sig9 as (
    select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'queue_source_intake' and p.pronargs = 9
  ),
  old8 as (
    select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'queue_source_intake' and p.pronargs = 8
  ),
  deps as (
    select count(*) c from (
      select to_regprocedure('private.fill_company_id()')::text o
      union all select to_regprocedure('public.current_company_id()')::text
      union all select to_regprocedure('public.is_system_admin()')::text
      union all select to_regclass('public.companies')::text
      union all select to_regclass('public.profiles')::text
      union all select to_regclass('public.mobile_bg_drafts')::text
      union all select to_regclass('public.mobile_bg_publish_jobs')::text
      union all select to_regclass('public.source_listing_jobs')::text
      union all select to_regclass('public.mobile_bg_draft_action_log')::text
    ) t where t.o is null
  ),
  trg as (
    select count(distinct c.relname) c
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
      and t.tgname = 'fill_company_id'
      and c.relname in ('mobile_bg_drafts','mobile_bg_publish_jobs','source_listing_jobs')
  ),
  cid as (select public.current_company_id() as v),
  adm as (select count(*) c from public.profiles where role = 'SYSTEM_ADMIN' and company_id is not null),
  ct as (select count(*) c from public.companies),
  ca as (select count(*) c from public.companies where status = 'ACTIVE'),
  dnull as (select count(*) c from public.mobile_bg_drafts where company_id is null),
  pnull as (select count(*) c from public.mobile_bg_publish_jobs where company_id is null),
  snull as (select count(*) c from public.source_listing_jobs where company_id is null),
  dtot as (select count(*) c from public.mobile_bg_drafts),
  ptot as (select count(*) c from public.mobile_bg_publish_jobs),
  stot as (select count(*) c from public.source_listing_jobs),
  rls as (
    select count(*) c from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  ),
  anonp as (select count(*) c from pg_policies where schemaname = 'public' and 'anon' = any(roles)),
  dcomp as (
    select coalesce(string_agg(coalesce(c.slug,'<NO COMPANY>') || '=' || s.n, ', ' order by s.n desc), 'none') x
    from (select company_id, count(*) n from public.mobile_bg_drafts group by 1) s
    left join public.companies c on c.id = s.company_id
  ),
  pcomp as (
    select coalesce(string_agg(coalesce(c.slug,'<NO COMPANY>') || '=' || s.n, ', ' order by s.n desc), 'none') x
    from (select company_id, count(*) n from public.mobile_bg_publish_jobs group by 1) s
    left join public.companies c on c.id = s.company_id
  ),
  scomp as (
    select coalesce(string_agg(coalesce(c.slug,'<NO COMPANY>') || '=' || s.n, ', ' order by s.n desc), 'none') x
    from (select company_id, count(*) n from public.source_listing_jobs group by 1) s
    left join public.companies c on c.id = s.company_id
  ),
  cslug as (
    select coalesce(string_agg(slug, ', ' order by slug), 'none') x from public.companies
  )
select 1 as n, 'Corrected functions present' as check,
       case when (select c from f) = 2 then 'PASS' else 'FAIL' end as result,
       (select c from f)::text || ' of 2' as detail
union all
select 2, 'min(uuid) aggregate gone', case when (select c from broken) = 0 then 'PASS' else 'FAIL' end,
       (select c from broken)::text || ' function(s) still call it'
union all
select 3, 'Both are SECURITY DEFINER', case when (select c from secdef) = 2 then 'PASS' else 'FAIL' end,
       (select c from secdef)::text || ' of 2'
union all
select 4, 'queue_source_intake callable by service_role', case when (select c from svcexec) = 1 then 'PASS' else 'FAIL' end,
       (select c from svcexec)::text || ' of 1'
union all
select 5, 'Nine-argument signature kept', case when (select c from sig9) = 1 then 'PASS' else 'FAIL' end,
       (select c from sig9)::text || ' of 1'
union all
select 6, 'Old eight-argument version dropped', case when (select c from old8) = 0 then 'PASS' else 'FAIL' end,
       (select c from old8)::text || ' stray signature(s)'
union all
select 7, 'Dependencies present', case when (select c from deps) = 0 then 'PASS' else 'FAIL' end,
       (select c from deps)::text || ' missing'
union all
select 8, 'fill_company_id trigger on all three tables', case when (select c from trg) = 3 then 'PASS' else 'FAIL' end,
       (select c from trg)::text || ' of 3'
union all
select 9, 'current_company_id() answers without error',
       case when (select v from cid) is null then 'PASS' else 'PASS' end,
       'returned ' || coalesce((select v::text from cid), 'NULL (nobody signed in in the SQL editor)')
union all
select 10, 'No SYSTEM_ADMIN holds a company', case when (select c from adm) = 0 then 'PASS' else 'FAIL' end,
       (select c from adm)::text || ' admin(s) with a company'
union all
select 11, 'Active companies (1 = fallback answers)', 'INFO',
       (select c from ca)::text || ' active, ' || (select c from ct)::text || ' total: ' || (select x from cslug)
union all
select 12, 'Drafts with no company', case when (select c from dnull) = 0 then 'PASS' else 'FAIL' end,
       (select c from dtot)::text || ' total, ' || (select c from dnull)::text || ' orphaned: ' || (select x from dcomp)
union all
select 13, 'Publish jobs with no company', case when (select c from pnull) = 0 then 'PASS' else 'FAIL' end,
       (select c from ptot)::text || ' total, ' || (select c from pnull)::text || ' orphaned: ' || (select x from pcomp)
union all
select 14, 'Source jobs with no company', case when (select c from snull) = 0 then 'PASS' else 'FAIL' end,
       (select c from stot)::text || ' total, ' || (select c from snull)::text || ' orphaned: ' || (select x from scomp)
union all
select 15, 'RLS tables with no policy', case when (select c from rls) = 0 then 'PASS' else 'FAIL' end,
       (select c from rls)::text || ' table(s) enabled without a policy'
union all
select 16, 'anon policies (close_anon not applied yet)', 'INFO',
       (select c from anonp)::text || ' anon policy/policies still present'
order by n;
