-- Local stand-in for the pieces Supabase provides before any migration runs.
-- It exists only so the migrations can be replayed and RLS tested on a plain
-- PostgreSQL. Production already has these objects; this file is never applied
-- there.

create schema if not exists auth;

-- `raw_user_meta_data` is part of the real table and the profile trigger reads
-- it, so the stand-in carries it too rather than making the trigger untestable.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase reads the caller from a request-scoped setting. The local tests set
-- the same setting, so a policy calling auth.uid() behaves as it does in
-- production: it returns the signed-in user, or null when nobody is signed in.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Supabase grants these by default; a plain Postgres does not.
grant usage on schema public to anon, authenticated, service_role;
