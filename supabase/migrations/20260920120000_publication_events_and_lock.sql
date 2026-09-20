-- The Publications section grows its audit trail and its single-publish lock.
--
-- Nothing here reads or writes the mobile_bg_* tables: the old «Обяви» flow must
-- keep working untouched so it can be fallen back to at any time.
--
-- Grants and policies are created together on purpose, as in the previous
-- migration: a policy cannot grant a privilege that was never given.

-- Section 5.3 of the specification: an append-only record of what happened to a
-- job. It carries no password, no token and no cookie — only states and safe
-- messages, which is what makes it safe to show in the UI.
create table if not exists public.publication_events (
  id bigserial primary key,
  job_id uuid references public.publication_jobs(id) on delete cascade,
  -- The state names from section 12 of the specification.
  state text not null,
  worker text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists publication_events_job_idx
  on public.publication_events (job_id, created_at desc);

-- The colour evidence the result card shows: the report cell class, not a
-- frontend CSS judgement.
alter table public.publication_jobs add column if not exists green_canada_final boolean;
alter table public.publication_jobs add column if not exists mobilebg_id text;
alter table public.publication_jobs add column if not exists browser_profile text;
-- The state machine of section 12 is wider than the old status column allowed,
-- so the column is widened rather than a second one being introduced. Only
-- `published` is a finished success: public_url_found without verification is
-- not, and published_no_photos is not shown as a normal publication.
alter table public.publication_jobs drop constraint if exists publication_jobs_status_check;
alter table public.publication_jobs add constraint publication_jobs_status_check
  check (status in (
    'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED',
    'draft', 'ready', 'queued', 'source_validated', 'session_required', 'session_valid',
    'form_step1_submitted', 'photos_uploading', 'photos_ready', 'continue_clicked',
    'public_url_found', 'verified', 'published', 'duplicate_skipped',
    'blocked_source', 'blocked_not_green', 'blocked_price_limit', 'blocked_missing_data',
    'blocked_model_option', 'blocked_photos', 'failed', 'published_no_photos', 'cancelled'
  ));

alter table public.publication_events enable row level security;

grant select, insert on public.publication_events to anon, authenticated;
grant usage, select on sequence public.publication_events_id_seq to anon, authenticated;

drop policy if exists publication_events_read on public.publication_events;
create policy publication_events_read on public.publication_events
  for select to anon, authenticated using (true);

drop policy if exists publication_events_insert on public.publication_events;
create policy publication_events_insert on public.publication_events
  for insert to anon, authenticated with check (true);

-- Section 7: one publish at a time for a single Mobile.bg profile, because the
-- historical process was sequential. The claim function already takes one job
-- with `for update skip locked`; this adds the per-profile guard so two workers
-- sharing a profile cannot fill the form at once.
create or replace function public.claim_publication_job(worker_name text)
returns setof public.publication_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.publication_jobs;
  busy_profiles text[];
begin
  -- A job whose worker died — a restart, a crash — would sit in RUNNING for
  -- ever and keep the publish button disabled. Reclaim it.
  update public.publication_jobs
     set status = 'QUEUED',
         last_error = 'Предишният опит прекъсна, задачата е върната в опашката.',
         updated_at = now()
   where status = 'RUNNING'
     and started_at < now() - interval '15 minutes';

  -- Profiles with a run in flight. A job with no profile recorded is treated as
  -- using the default one, so the guard cannot be sidestepped by leaving it null.
  select coalesce(array_agg(distinct coalesce(browser_profile, 'mobilebg-publisher')), '{}')
    into busy_profiles
    from public.publication_jobs
   where status = 'RUNNING';

  select * into claimed
  from public.publication_jobs
  where status = 'QUEUED'
    and not (coalesce(browser_profile, 'mobilebg-publisher') = any(busy_profiles))
  order by requested_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.publication_jobs
     set status = 'RUNNING',
         started_at = now(),
         browser_profile = coalesce(browser_profile, 'mobilebg-publisher'),
         updated_at = now()
   where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

grant execute on function public.claim_publication_job(text) to anon, authenticated;