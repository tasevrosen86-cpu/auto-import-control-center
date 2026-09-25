-- Royal Cars BG — tenant separation for the «Обяви» (publishing) data.
--
-- Before this migration every Mobile.bg policy read `using (true)` for both
-- `anon` and `authenticated`, so any signed-in broker could read every other
-- firm's drafts by calling the REST API directly, whatever the menu showed.
-- This migration replaces those policies for `authenticated` with ones that
-- compare the row's company against the caller's own.
--
-- `anon` is deliberately left as it was. The Mobile.bg workers run with the
-- public key on the VPS (see `deploy-vps.yml`), so tightening `anon` here would
-- stop publishing the moment it was applied. The follow-up migration in
-- `supabase/manual/20260925150000_royal_cars_close_anon.sql` closes that gap and
-- is switched on once the workers carry the service-role key.

-- ============================================================
-- 0. Repair the helper layer before anything depends on it
-- ============================================================
-- This migration failed once, on a production database, with:
--
--   ERROR: 42883: function public.current_company_id() does not exist
--
-- That single error has one likely cause and one dangerous one, and both are
-- handled here rather than guessed at.
--
-- The likely cause is a partial earlier attempt. `supabase db push` runs a
-- migration inside a transaction, but the SQL Editor does not: statement by
-- statement, and a failure part-way leaves everything before it committed. Every
-- `create or replace function` in this migration is a plain statement, so an
-- interrupted paste can leave `current_company_id` dropped and not yet recreated.
-- The very next statement that mentions it — `alter column ... set default
-- public.current_company_id()` — then fails exactly as reported, even though
-- nothing was wrong with the migration itself.
--
-- The dangerous cause is a duplicate. `create or replace function f()` is the
-- only signature Postgres will let you omit the argument list for. Writing
-- `create or replace function f(uuid)` — or a stray earlier attempt that did —
-- leaves TWO functions named `current_company_id`, and a zero-argument call then
-- resolves to neither:
--
--   ERROR: 42725: function public.current_company_id() is not unique
--
-- or, if only the wrong-arity one survives, 42883 with a hint. Either way the
-- default cannot be evaluated.
--
-- So the whole helper layer is (re)defined here, before anything uses it. It is
-- safe to re-run: the tables are `if not exists`, the seed is `on conflict do
-- nothing`, the functions are `create or replace`, and any same-named function
-- with the wrong argument count is dropped first. Running this migration twice,
-- or running it after a half-finished attempt, ends in the same state.

-- The publishing tables come from the earlier migrations and must be present.
-- `companies` and `profiles` are deliberately *not* listed here: they are
-- created a few lines below, because the previous migration stopped before it
-- finished and this file has to stand on its own.
do $$
declare
  missing text;
begin
  select string_agg(format('public.%s', t), ', ')
    into missing
  from unnest(array[
    'mobile_bg_drafts', 'mobile_bg_draft_fields', 'mobile_bg_draft_extras',
    'mobile_bg_draft_images', 'mobile_bg_draft_action_log', 'mobile_bg_dedup_checks',
    'mobile_bg_publish_jobs', 'source_listing_jobs'
  ]) as t
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = t
  );

  if missing is not null then
    raise exception
      'Липсват таблици: %. Пуснете миграциите за чернови преди тази.', missing
      using errcode = '42P01';
  end if;
end $$;

-- ------------------------------------------------------------------
-- The layer the previous migration was supposed to leave behind
-- ------------------------------------------------------------------
-- Production was checked and answered plainly. `private.is_system_admin_email`
-- exists — that is section 3 of 20260925120000_royal_cars_companies_roles.sql —
-- and nothing after it does: no `current_company_id`, no `is_system_admin`, no
-- profile triggers. `mobile_bg_drafts.company_id` still carries the placeholder
-- default. So that migration stopped in the middle, and everything below section
-- 3 of it is simply absent.
--
-- This file therefore defines that layer itself rather than depending on it.
-- Every statement is idempotent and the definitions are copied from the earlier
-- migration unchanged, so the two files converge on the same objects: re-running
-- the earlier one afterwards is a no-op, and it can never be the case that one
-- of them is right and the other wins.
--
-- The three triggers matter more than they look. `guard_profile_privileges` is
-- what stops a broker writing `role = 'SYSTEM_ADMIN'` on their own row and taking
-- the whole system. `normalise_system_admin_profile` is what keeps the owner's
-- `company_id` null — which is the single-account model, and also what the insert
-- trigger and the intake function read as "this caller holds no firm, so ask
-- which one". `sync_profile_from_auth_user` is what gives a new signup a profile
-- at all.

-- ----------------------------------------------------------------
-- companies and profiles
-- ----------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'ACTIVE',
  legal_name text,
  phone text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;

-- `company_id` is nullable on purpose: someone who has just signed up has no
-- company until an administrator places them, and that is a real state rather
-- than an error. `can_access_company` grants them nothing, so they can sign in
-- and be told to wait.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete restrict,
  role text not null default 'BROKER',
  full_name text,
  email text,
  phone text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The constraint is added separately so that a table created by an earlier run
-- of the previous migration, with or without it, ends up with exactly one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('SYSTEM_ADMIN', 'COMPANY_ADMIN', 'BROKER'));
  end if;
end $$;

create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_profiles_role on public.profiles(role);

alter table public.profiles enable row level security;

-- ----------------------------------------------------------------
-- The administrator list, and the four helpers
-- ----------------------------------------------------------------
create schema if not exists private;

create table if not exists private.system_admins (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

revoke all on schema private from public;
revoke all on private.system_admins from public, anon, authenticated;

insert into private.system_admins (email, note)
values ('tasevrosen86@gmail.com', 'Owner — full access to every company and the master catalog')
on conflict (email) do nothing;

create or replace function private.is_system_admin_email(candidate text)
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select exists (
    select 1 from private.system_admins a
    where lower(a.email) = lower(coalesce(candidate, ''))
  );
$$;

revoke all on function private.is_system_admin_email(text) from public;
grant execute on function private.is_system_admin_email(text) to anon, authenticated, service_role;

-- The wrong-arity sweep runs *before* the helpers are written, so a leftover
-- cannot make the next statement ambiguous. `create or replace function f()` is
-- the only form that omits the argument list; `create or replace function
-- f(uuid)` would create a second function, and a zero-argument call then
-- resolves to neither.
do $$
declare
  leftover record;
begin
  for leftover in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (
        (p.proname in ('can_access_company', 'is_system_admin_email') and p.pronargs <> 1)
        or (p.proname in ('current_company_id', 'current_profile_role',
                          'is_system_admin', 'is_company_admin')
            and p.pronargs <> 0)
      )
  loop
    execute format('drop function if exists %s', leftover.signature);
  end loop;
end $$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.user_id = (select auth.uid());
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.company_id from public.profiles p where p.user_id = (select auth.uid());
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid()) and p.role = 'SYSTEM_ADMIN'
  ) or private.is_system_admin_email((select auth.jwt() ->> 'email'));
$$;

create or replace function public.is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.role in ('SYSTEM_ADMIN', 'COMPANY_ADMIN')
  );
$$;

-- The single tenant predicate, defined once, here, for the same reason the
-- helpers above are: two definitions differing only in the suspended-broker test
-- is the drift this migration exists to remove.
--
-- `status = 'ACTIVE'` is what takes a suspended broker's access away without
-- touching their login. A system administrator short-circuits before it, so
-- nothing here narrows the owner's access.
create or replace function public.can_access_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    public.is_system_admin()
    or exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and p.status = 'ACTIVE'
        and target is not null
        and p.company_id = target
    );
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_company_id() from public;
revoke all on function public.is_system_admin() from public;
revoke all on function public.is_company_admin() from public;
revoke all on function public.can_access_company(uuid) from public;
grant execute on function public.current_profile_role() to anon, authenticated, service_role;
grant execute on function public.current_company_id() to anon, authenticated, service_role;
grant execute on function public.is_system_admin() to anon, authenticated, service_role;
grant execute on function public.is_company_admin() to anon, authenticated, service_role;
grant execute on function public.can_access_company(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- The three profile triggers
-- ----------------------------------------------------------------
create or replace function private.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_admin boolean := private.is_system_admin_email(new.email);
begin
  insert into public.profiles (user_id, email, role, company_id, full_name, status)
  values (
    new.id,
    new.email,
    case when v_admin then 'SYSTEM_ADMIN' else 'BROKER' end,
    null,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'ACTIVE'
  )
  on conflict (user_id) do update
    set email = excluded.email,
        role = case when v_admin then 'SYSTEM_ADMIN' else public.profiles.role end,
        company_id = case when v_admin then null else public.profiles.company_id end,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_profile_from_auth_user on auth.users;
create trigger sync_profile_from_auth_user
  after insert or update of email on auth.users
  for each row execute function private.sync_profile_from_auth_user();

create or replace function private.normalise_system_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'SYSTEM_ADMIN' then
    new.company_id := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists normalise_system_admin_profile on public.profiles;
create trigger normalise_system_admin_profile
  before insert or update on public.profiles
  for each row execute function private.normalise_system_admin_profile();

create or replace function private.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id
     or new.status is distinct from old.status then
    if not (public.is_system_admin() or public.is_company_admin()) then
      raise exception 'Само администратор може да променя роля, фирма или статус.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges
  before update on public.profiles
  for each row execute function private.guard_profile_privileges();

-- ----------------------------------------------------------------
-- The owner's own profile
-- ----------------------------------------------------------------
-- The account already exists in `auth.users`, so the signup trigger never fires
-- for it. `company_id` stays null: one account, global, matching every firm
-- without belonging to one. The name is left as it is if a profile already
-- exists, and taken from the email address otherwise — reading
-- `raw_user_meta_data` here would tie a migration to a schema it does not own.
insert into public.profiles (user_id, email, role, company_id, full_name, status)
select u.id, u.email, 'SYSTEM_ADMIN', null,
       split_part(coalesce(u.email, ''), '@', 1),
       'ACTIVE'
from auth.users u
where private.is_system_admin_email(u.email)
on conflict (user_id) do update
  set role = 'SYSTEM_ADMIN',
      company_id = null,
      updated_at = now();

-- ============================================================
-- 1. Royal Cars BG as the first real tenant
-- ============================================================
insert into public.companies (slug, name, status, legal_name, phone)
values ('royal-cars-bg', 'Royal Cars BG', 'ACTIVE', 'Royal Cars BG', '0887353653')
on conflict (slug) do nothing;

-- Everything created until now belongs to Royal Cars BG, which is the company
-- the owner actually operates. The placeholder UUID was never a tenant.
--
-- The second condition catches a draft pointing at a company that does not
-- exist — a leftover from a half-finished attempt, or a hand-edit. Such a row
-- would be readable only by a system administrator once the policies below are
-- in place, so it would silently vanish from the screen of the broker who
-- created it. Reclassifying it is the same judgement as the placeholder: until
-- there is more than one firm, every existing draft is Royal Cars BG's.
update public.mobile_bg_drafts
   set company_id = (select id from public.companies where slug = 'royal-cars-bg')
 where company_id = '00000000-0000-0000-0000-000000000000'
    or company_id is null
    or not exists (select 1 from public.companies c where c.id = company_id);

-- A draft without a company can no longer be read by anyone, so a forgotten
-- insert must fail at the database rather than disappear from every screen.
--
-- The default reads the company from the session instead of dropping to null:
-- an insert that omits `company_id` then lands in the caller's own firm, which
-- is what the UI relies on, and one that names another firm is refused by the
-- policy. A worker running as the service role has no session, so it must pass
-- the company explicitly and gets a clear failure if it forgets.
alter table public.mobile_bg_drafts
  alter column company_id set default public.current_company_id();

-- The default is not enough on its own. `mobile_bg_drafts.company_id` is NOT
-- NULL, and the frontend inserts a draft without naming a company, so the
-- default is what places it. Reading the session works for a broker and for a
-- company admin, whose profile carries a company. It does not work for the
-- owner: a system administrator has no company on purpose — the trigger in the
-- previous migration strips it — so the default yields NULL and the NOT NULL
-- constraint rejects the insert before any policy is consulted. The owner, who
-- the menu deliberately sends through the same publishing workflow as a company
-- user, could not create a draft at all.
--
-- So the company is resolved in a BEFORE INSERT trigger. The order is: the row
-- already names one; else the parent draft's; else the caller's own; else, for a
-- system administrator only, the single active company. Naming one explicitly is
-- still checked by the INSERT policy, so this cannot be used to file a row into
-- another firm.
--
-- The last step is deliberately the administrator's alone. A broker who has not
-- been placed in a firm yet must be refused, not quietly filed into whichever
-- company happens to be the only one: that is the same silent misplacement this
-- migration exists to prevent, and today it would look correct because one
-- company exists.
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
-- 2. company_id on the publishing queue
-- ============================================================
-- The queue is reached from the draft, but a job also has to be listed per
-- company without a join, and a job for a deleted draft must not become
-- readable to another firm.
alter table public.mobile_bg_publish_jobs
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

update public.mobile_bg_publish_jobs job
   set company_id = draft.company_id
  from public.mobile_bg_drafts draft
 where draft.id = job.draft_id
   and job.company_id is null;

create index if not exists idx_publish_jobs_company on public.mobile_bg_publish_jobs(company_id);

-- source_listing_jobs is reached through its draft as well, and the intake
-- function sets the same company on both.
alter table public.source_listing_jobs
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

update public.source_listing_jobs job
   set company_id = draft.company_id
  from public.mobile_bg_drafts draft
 where draft.id = job.draft_id
   and job.company_id is null;

create index if not exists idx_source_jobs_company on public.source_listing_jobs(company_id);

-- ============================================================
-- 3. Tenant policies for authenticated users
-- ============================================================
-- Attached now that all three tables carry `company_id`. The trigger runs
-- before the INSERT policy, so the policy sees a resolved company rather than a
-- null the default could not fill.
drop trigger if exists fill_company_id on public.mobile_bg_drafts;
create trigger fill_company_id
  before insert on public.mobile_bg_drafts
  for each row execute function private.fill_company_id();

drop trigger if exists fill_company_id on public.mobile_bg_publish_jobs;
create trigger fill_company_id
  before insert on public.mobile_bg_publish_jobs
  for each row execute function private.fill_company_id();

drop trigger if exists fill_company_id on public.source_listing_jobs;
create trigger fill_company_id
  before insert on public.source_listing_jobs
  for each row execute function private.fill_company_id();

-- Every policy that named `anon` or `authenticated` on these tables is removed
-- and replaced by a pair per table: one for `anon`, unchanged in effect, and one
-- for `authenticated`, scoped to the caller's company.
--
-- The sweep is by role rather than by name because the permissive policies were
-- created over several migrations under inconsistent names — `anon_select_draft_fields`,
-- `app_SELECT_mobile_bg_drafts`, `anon_update_source_listing_jobs` — and each of
-- them named both roles. Dropping only the names this migration knew about left
-- `anon_select_draft_fields` in place, and because it also listed
-- `authenticated`, it went on granting every broker every firm's rows.
do $$
declare
  pol record;
begin
  for pol in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'mobile_bg_drafts', 'mobile_bg_draft_fields', 'mobile_bg_draft_extras',
        'mobile_bg_draft_images', 'mobile_bg_draft_action_log', 'mobile_bg_dedup_checks',
        'mobile_bg_publish_jobs', 'source_listing_jobs'
      ])
      and roles && array['anon', 'authenticated']::name[]
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- The predicate differs by table: the drafts table carries company_id itself,
-- the others reach it through the parent draft.
create or replace function public.can_access_draft(target_draft uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.mobile_bg_drafts d
    where d.id = target_draft and public.can_access_company(d.company_id)
  );
$$;

revoke all on function public.can_access_draft(uuid) from public;
grant execute on function public.can_access_draft(uuid) to anon, authenticated, service_role;

-- Tables that carry company_id directly.
do $$
declare
  t text;
  cmd text;
  anon_name text;
  auth_name text;
begin
  foreach t in array array['mobile_bg_drafts', 'mobile_bg_publish_jobs', 'source_listing_jobs'] loop
    foreach cmd in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      anon_name := format('tenant_anon_%s_%s', lower(cmd), t);
      auth_name := format('tenant_auth_%s_%s', lower(cmd), t);

      execute format(
        'create policy %I on public.%I for %s to anon %s',
        anon_name, t, cmd,
        case when cmd = 'INSERT' then 'with check (true)' else 'using (true)' end
      );

      -- A SELECT or UPDATE sees the row through USING; an INSERT has no existing
      -- row, so it checks the company being written instead — otherwise a broker
      -- could file a draft into another firm.
      execute format(
        'create policy %I on public.%I for %s to authenticated %s',
        auth_name, t, cmd,
        case cmd
          when 'INSERT' then 'with check (public.can_access_company(company_id))'
          when 'UPDATE' then 'using (public.can_access_company(company_id)) with check (public.can_access_company(company_id))'
          else 'using (public.can_access_company(company_id))'
        end
      );
    end loop;
  end loop;
end $$;

-- Tables reached through the parent draft.
do $$
declare
  t text;
  cmd text;
  anon_name text;
  auth_name text;
begin
  foreach t in array array[
    'mobile_bg_draft_fields', 'mobile_bg_draft_extras', 'mobile_bg_draft_images',
    'mobile_bg_draft_action_log', 'mobile_bg_dedup_checks'
  ] loop
    foreach cmd in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      anon_name := format('tenant_anon_%s_%s', lower(cmd), t);
      auth_name := format('tenant_auth_%s_%s', lower(cmd), t);

      execute format(
        'create policy %I on public.%I for %s to anon %s',
        anon_name, t, cmd,
        case when cmd = 'INSERT' then 'with check (true)' else 'using (true)' end
      );

      execute format(
        'create policy %I on public.%I for %s to authenticated %s',
        auth_name, t, cmd,
        case cmd
          when 'INSERT' then 'with check (public.can_access_draft(draft_id))'
          when 'UPDATE' then 'using (public.can_access_draft(draft_id)) with check (public.can_access_draft(draft_id))'
          else 'using (public.can_access_draft(draft_id))'
        end
      );
    end loop;
  end loop;
end $$;

-- ============================================================
-- 4. One draft per company, not per system
-- ============================================================
-- The queue deduplicates a source link globally. Two firms importing the same
-- car are doing different deals, so the identity has to carry the company or the
-- second firm would silently receive the first firm's draft.
drop index if exists public.uq_source_listing_jobs_active_identity;
create unique index if not exists uq_source_listing_jobs_active_identity
  on public.source_listing_jobs(company_id, source_identity)
  where status in ('QUEUED', 'RUNNING', 'COMPLETED');

-- ============================================================
-- 5. The intake function files a draft under the caller's company
-- ============================================================
-- This replaces the existing eight-argument function rather than adding an
-- overload: a second signature with the same first arguments makes
-- `queue_source_intake(...)` ambiguous, and Postgres resolves the call by
-- argument count, so the Edge Function would stop working the moment both
-- existed.
--
-- The company comes from the acting user, passed in as `p_requested_by`, and not
-- from the row being inserted. The function is SECURITY DEFINER, so an insert
-- that named the company directly could be pointed at another firm.
--
-- `p_company_id` is the one addition, and it exists to stop the owner being
-- permanently read as Royal Cars BG. It is honoured *only* for a system
-- administrator and refused for everyone else, so a broker stays pinned to their
-- own firm. It has to be added now rather than later: this migration itself
-- explains that a second signature with the same leading arguments makes
-- `queue_source_intake(...)` ambiguous and stops the Edge Function working, so a
-- later addition would mean changing the signature anyway — and doing it while
-- the default is null keeps every existing call, including the Edge Function's,
-- byte-for-byte valid.
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

-- Still server-only: the Edge Function reaches it with the service role, as
-- before. Nothing here widens that.
--
-- The eight-argument version is dropped explicitly. `create or replace` matches
-- on the argument list, so adding a defaulted ninth argument creates a *second*
-- function rather than replacing the first — and the old one would stay behind,
-- still granted to the service role, still inserting without a company. That is
-- the ambiguity this migration's own note warns about, arriving from the other
-- direction.
drop function if exists public.queue_source_intake(text, text, text, text, text, integer, text, uuid);

revoke all on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) from public;
revoke all on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) from anon;
revoke all on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) from authenticated;
grant execute on function public.queue_source_intake(text, text, text, text, text, integer, text, uuid, uuid) to service_role;

-- ============================================================
-- 6. Companies and profiles
-- ============================================================
drop policy if exists companies_read_own on public.companies;
create policy companies_read_own on public.companies for select to authenticated
  using (public.is_system_admin() or id = public.current_company_id());

drop policy if exists companies_system_admin_write on public.companies;
create policy companies_system_admin_write on public.companies for all to authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_system_admin()
    or (public.is_company_admin() and company_id = public.current_company_id())
  );

-- A user maintains their own name and phone, never their role or company; a
-- system administrator maintains anyone. The trigger on the table is what makes
-- the column list safe: it re-normalises the role when the row is a system
-- administrator's, and a non-admin cannot reach this policy to change a role.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.is_system_admin())
  with check (user_id = (select auth.uid()) or public.is_system_admin());

-- Company managers add and manage their own firm's users.
drop policy if exists profiles_company_admin_insert on public.profiles;
create policy profiles_company_admin_insert on public.profiles for insert to authenticated
  with check (public.is_system_admin() or (public.is_company_admin() and company_id = public.current_company_id()));

drop policy if exists profiles_company_admin_delete on public.profiles;
create policy profiles_company_admin_delete on public.profiles for delete to authenticated
  using (public.is_system_admin() or (public.is_company_admin() and company_id = public.current_company_id()));

grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.companies to service_role;
grant all on public.profiles to service_role;

-- ============================================================
-- 7. The caller must be a real, active profile to use publishing
-- ============================================================
-- `can_access_company` is defined in section 0, at the top, together with the
-- other helpers — it has to exist before the `alter column ... set default` in
-- section 1 can even be parsed, and defining it once is what keeps the
-- suspended-broker test from drifting away from the predicate the policies use.
-- This heading is kept so the numbering still reads in order.
