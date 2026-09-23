-- «Обяви» gets a second, independent publishing path: the official Mobile.bg
-- import API. It shares the queue table with the on-demand browser worker, so
-- the two must never claim the same job. The transport column already exists
-- and defaults to BROWSER_ON_DEMAND; this migration only adds what the API path
-- needs to be diagnosed and retried, and makes the queue filterable by it.

-- The API path runs in more, smaller steps than the browser path (login, field
-- resolution, publish, per-image upload, verify). Each step writes one entry so
-- the screen can show exactly where a run stopped. Secrets are never written
-- here — the trace holds method, path, status and a redacted body only.
alter table public.mobile_bg_publish_jobs
  add column if not exists api_trace jsonb not null default '[]'::jsonb;

-- The API publishes the listing first and attaches pictures to it afterwards.
-- When the picture step fails the listing already exists and is paid for, so the
-- id is kept on the job: the broker retries the pictures alone instead of
-- creating a second listing.
alter table public.mobile_bg_publish_jobs
  add column if not exists listing_id text;

-- The browser worker scans by status alone. With two transports in one table it
-- would also pick up API jobs and drive a browser at them, so the scan is now
-- transport-scoped and needs this index to stay cheap.
create index if not exists idx_mobile_bg_publish_jobs_transport_queue
  on public.mobile_bg_publish_jobs(transport, status, requested_at);

-- Reading a job's trace is part of the draft screen, which signs in as an
-- authenticated broker, so the existing policies already cover it. The API
-- worker writes the trace with the service role, which bypasses RLS.

-- `claim_mobile_bg_publish_job` predates the transport split. It scans by status
-- and `for update skip locked`, with no transport filter, so calling it would let
-- any caller claim a job belonging to the other flow — and it is executable by
-- `anon`. No code calls it: both workers claim their row directly in TypeScript,
-- each with its own transport filter. Until it is rewritten to take a transport
-- argument it must not be callable, because the mistake it enables is silent and
-- expensive.
--
-- Guarded because the function is created by an earlier migration and may have
-- been dropped by hand in the dashboard, in which case a bare revoke would abort
-- the whole migration.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_mobile_bg_publish_job'
  ) then
    revoke execute on function public.claim_mobile_bg_publish_job(text) from anon, authenticated;
  end if;
end $$;
