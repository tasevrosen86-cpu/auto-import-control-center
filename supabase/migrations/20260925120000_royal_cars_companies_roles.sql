-- Royal Cars BG — companies, profiles and roles.
--
-- Everything up to this migration was single-tenant: `AuthGate` compared the
-- signed-in email with one hardcoded address, every RLS policy on the Mobile.bg
-- tables said `using (true)`, and `mobile_bg_drafts.company_id` was a placeholder
-- that nothing read. Hiding a menu was therefore the only thing separating one
-- firm from another.
--
-- This migration adds the two tables that make a tenant real, and the helper
-- functions the policies use to decide who is calling. It changes no existing
-- row and no existing policy; separation is turned on in the next migration.

-- ============================================================
-- 1. companies
-- ============================================================
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

-- ============================================================
-- 2. profiles — one row per authenticated user
-- ============================================================
-- `role` is a small closed set:
--   SYSTEM_ADMIN       — the owner; sees every company and the master catalog
--   COMPANY_ADMIN      — a firm's manager; sees only that firm
--   BROKER             — a firm's broker; sees only that firm
-- `company_id` is null only for SYSTEM_ADMIN, which is what lets the policies
-- keep a system admin out of no firm in particular and inside all of them.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete restrict,
  role text not null default 'BROKER',
  full_name text,
  email text,
  phone text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('SYSTEM_ADMIN', 'COMPANY_ADMIN', 'BROKER'))
);

-- `company_id` is deliberately nullable. Someone who has just signed up has no
-- company until an administrator places them, and that is a real state, not an
-- error: `can_access_company` grants a user with no company nothing at all, so
-- they can sign in and be told to wait rather than be refused at creation.

create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_profiles_role on public.profiles(role);

alter table public.profiles enable row level security;

-- ============================================================
-- 3. System administrators, kept out of reach of the tables above
-- ============================================================
-- The owner's access must survive a mistake in `profiles` — a broker editing a
-- row, a botched backfill, a role set wrong by hand. So the list of system
-- administrator emails lives in its own table that no client role can read or
-- write, and a trigger on auth.users and on profiles consults it. The frontend
-- no longer holds the authority; it only reflects what this decides.
create schema if not exists private;

create table if not exists private.system_admins (
  email text primary key,
  note text,
  created_at timestamptz not null default now()
);

-- Supabase grants no schema usage to client roles by default, but be explicit:
-- the point of this table is that `anon` and `authenticated` cannot see it.
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

-- ============================================================
-- 4. Helper functions used by every tenant policy
-- ============================================================
-- These are SECURITY DEFINER on purpose. A policy on `mobile_bg_drafts` that
-- selects from `profiles` would otherwise run under the caller's own policies
-- and recurse; definer rights read the table directly. They are STABLE so the
-- planner can call them once per statement rather than once per row.
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

-- The single predicate every tenant-scoped table uses. A system admin matches
-- any company; everyone else matches exactly their own. A user with no profile
-- matches nothing.
create or replace function public.can_access_company(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    public.is_system_admin()
    or (
      target is not null
      and target = (select p.company_id from public.profiles p where p.user_id = (select auth.uid()))
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

-- ============================================================
-- 5. Keep profiles in step with auth.users
-- ============================================================
-- A signed-up user must end up with a profile, and a system administrator must
-- end up with the SYSTEM_ADMIN role whatever the trigger's own defaults say.
-- Doing it here rather than in the frontend means a user created by hand in the
-- Supabase dashboard is treated the same as one created by the site.
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

-- A profile that is promoted to SYSTEM_ADMIN must not keep pointing at a firm,
-- or `can_access_company` would grant that firm while the role claims global
-- access. The reverse is left to the operator: demoting an administrator needs a
-- company to be chosen consciously.
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

-- A profile row is editable by its own owner, which is how a user fixes their
-- own name or phone. Row ownership alone is not enough for the three columns
-- that decide access: `profiles_update_self` would otherwise let a broker write
-- `role = 'SYSTEM_ADMIN'` on their own row and grant themselves the whole
-- system. Only a system administrator, or the company admin who manages that
-- firm, may change those.
--
-- A session with no signed-in user is left alone: that is the service role and
-- the operator's own psql, which are already trusted and are how the system is
-- administered.
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

-- ============================================================
-- 6. The system administrator's own profile
-- ============================================================
-- The owner's account already exists, so the auth trigger will not fire for it.
-- Create the profile the helpers need.
insert into public.profiles (user_id, email, role, company_id, full_name, status)
select u.id, u.email, 'SYSTEM_ADMIN', null, 'Росен Тасев', 'ACTIVE'
from auth.users u
where private.is_system_admin_email(u.email)
on conflict (user_id) do update
  set role = 'SYSTEM_ADMIN', company_id = null, updated_at = now();
