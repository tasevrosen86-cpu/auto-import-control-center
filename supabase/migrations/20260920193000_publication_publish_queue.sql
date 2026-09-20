-- Independent publication queue. It deliberately references only publication_* tables.
create table if not exists public.publication_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.publication_drafts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','WAITING_SESSION','WAITING_CONFIRMATION','FAILED','COMPLETED')),
  attempt_count integer not null default 0,
  worker_name text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  public_url text,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publication_publish_jobs_owner_created_idx on public.publication_publish_jobs(owner_id, created_at desc);
create unique index if not exists publication_publish_jobs_one_active_draft_idx
  on public.publication_publish_jobs(draft_id)
  where status in ('QUEUED','RUNNING','WAITING_SESSION','WAITING_CONFIRMATION');
alter table public.publication_publish_jobs enable row level security;
create policy "publication publish jobs owner select" on public.publication_publish_jobs for select to authenticated using (owner_id = auth.uid());
create policy "publication publish jobs owner insert" on public.publication_publish_jobs for insert to authenticated with check (owner_id = auth.uid());
create policy "publication publish jobs owner update" on public.publication_publish_jobs for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create or replace function public.claim_publication_publish_job(worker_name text)
returns table (id uuid, draft_id uuid, owner_id uuid, status text, attempt_count integer)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with next_job as (
    select j.id from public.publication_publish_jobs j
    where j.status = 'QUEUED'
    order by j.requested_at asc
    for update skip locked limit 1
  )
  update public.publication_publish_jobs j
  set status='RUNNING', worker_name=claim_publication_publish_job.worker_name,
      attempt_count=j.attempt_count+1, started_at=now(), updated_at=now(), error_message=null
  from next_job where j.id=next_job.id
  returning j.id,j.draft_id,j.owner_id,j.status,j.attempt_count;
end;
$$;
revoke all on function public.claim_publication_publish_job(text) from public;
grant execute on function public.claim_publication_publish_job(text) to service_role;
