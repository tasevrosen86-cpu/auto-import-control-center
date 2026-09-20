-- Independent URL-import queue for the «Публикации» section.
-- This schema never reads or writes mobile_bg_* or Catalog tables.
create table if not exists public.publication_import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_url text not null,
  source_type text not null check (source_type in ('autotrader_ca','encar')),
  source_domain text not null,
  source_listing_id text,
  source_identity text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED')),
  attempt_count integer not null default 0,
  error_message text,
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, source_identity)
);
create index if not exists publication_import_jobs_owner_created_idx on public.publication_import_jobs(owner_id, created_at desc);
create index if not exists publication_import_jobs_status_created_idx on public.publication_import_jobs(status, created_at);
create table if not exists public.publication_url_drafts (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null unique references public.publication_import_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_url text not null, source_type text not null, title text,
  fields jsonb not null default '[]'::jsonb, images jsonb not null default '[]'::jsonb, raw_json jsonb not null default '[]'::jsonb,
  price_eur numeric(12,2), preparation_status text not null default 'EXTRACTED' check (preparation_status in ('EXTRACTED','READY','FAILED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists publication_url_drafts_owner_created_idx on public.publication_url_drafts(owner_id, created_at desc);
alter table public.publication_import_jobs enable row level security;
alter table public.publication_url_drafts enable row level security;
revoke all on table public.publication_import_jobs from anon, authenticated;
revoke all on table public.publication_url_drafts from anon, authenticated;
grant select on public.publication_import_jobs to authenticated;
grant select on public.publication_url_drafts to authenticated;
create policy publication_import_jobs_owner_read on public.publication_import_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy publication_url_drafts_owner_read on public.publication_url_drafts for select to authenticated using ((select auth.uid()) = owner_id);