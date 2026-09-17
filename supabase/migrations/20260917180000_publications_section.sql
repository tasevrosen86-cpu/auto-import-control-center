-- The Publications section owns its own tables. Nothing here reads or writes
-- the mobile_bg_* tables: the old "Обяви" flow must keep working untouched so
-- it can be fallen back to at any time.
--
-- Grants and policies are created together on purpose. The initial schema
-- created 80 policies and zero grants, which locked the signed-in app out
-- because a policy cannot grant a privilege that was never given.

create table if not exists public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Which button asked for this: the browser probe, a dry run, or a real publish.
  action text not null check (action in ('browser_test', 'prepare', 'publish')),
  -- The vehicle the job is about. Kept as plain columns so the list screen needs
  -- no join and the section stays independent of the catalogue schema.
  source_label text,
  make text,
  model text,
  year integer,
  price_eur numeric,
  image_count integer not null default 0,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED')),
  last_error text,
  public_url text,
  -- The exact object handed to the publisher, so a run can be reproduced from
  -- the row alone instead of reassembling it from several tables.
  payload jsonb not null default '{}'::jsonb,
  requested_by text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists publication_jobs_status_idx
  on public.publication_jobs (status, requested_at);

create table if not exists public.publication_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.publication_jobs(id) on delete cascade,
  state text not null,
  listing_url text,
  -- Per-field outcome as the publisher saw it: what landed, what was skipped,
  -- and the options the page actually offered when a value did not match.
  filled jsonb not null default '[]'::jsonb,
  skipped jsonb not null default '[]'::jsonb,
  photo_check jsonb,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists publication_results_job_idx
  on public.publication_results (job_id, created_at desc);

create table if not exists public.publication_logs (
  id bigserial primary key,
  job_id uuid references public.publication_jobs(id) on delete cascade,
  level text not null default 'info',
  step text,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists publication_logs_job_idx
  on public.publication_logs (job_id, created_at desc);

alter table public.publication_jobs enable row level security;
alter table public.publication_results enable row level security;
alter table public.publication_logs enable row level security;

-- A job that a worker claimed and then died with — a restart, a crash — would
-- sit in RUNNING for ever and keep the publish button disabled. Reclaim it.
create or replace function public.claim_publication_job(worker_name text)
returns setof public.publication_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.publication_jobs;
begin
  update public.publication_jobs
     set status = 'QUEUED',
         last_error = 'Предишният опит прекъсна, задачата е върната в опашката.',
         updated_at = now()
   where status = 'RUNNING'
     and started_at < now() - interval '15 minutes';

  select * into claimed
  from public.publication_jobs
  where status = 'QUEUED'
  order by requested_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.publication_jobs
     set status = 'RUNNING', started_at = now(), updated_at = now()
   where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

grant select, insert, update on public.publication_jobs to anon, authenticated;
grant select, insert on public.publication_results to anon, authenticated;
grant select, insert on public.publication_logs to anon, authenticated;
grant usage, select on sequence public.publication_logs_id_seq to anon, authenticated;
grant execute on function public.claim_publication_job(text) to anon, authenticated;

drop policy if exists publication_jobs_read on public.publication_jobs;
create policy publication_jobs_read on public.publication_jobs
  for select to anon, authenticated using (true);

drop policy if exists publication_jobs_insert on public.publication_jobs;
create policy publication_jobs_insert on public.publication_jobs
  for insert to anon, authenticated with check (true);

drop policy if exists publication_jobs_update on public.publication_jobs;
create policy publication_jobs_update on public.publication_jobs
  for update to anon, authenticated using (true) with check (true);

drop policy if exists publication_results_read on public.publication_results;
create policy publication_results_read on public.publication_results
  for select to anon, authenticated using (true);

drop policy if exists publication_results_insert on public.publication_results;
create policy publication_results_insert on public.publication_results
  for insert to anon, authenticated with check (true);

drop policy if exists publication_logs_read on public.publication_logs;
create policy publication_logs_read on public.publication_logs
  for select to anon, authenticated using (true);

drop policy if exists publication_logs_insert on public.publication_logs;
create policy publication_logs_insert on public.publication_logs
  for insert to anon, authenticated with check (true);