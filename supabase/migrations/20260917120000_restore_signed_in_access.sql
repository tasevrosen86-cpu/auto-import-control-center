-- The site signs in as an authenticated user (AuthGate -> signInWithPassword),
-- while the RLS policies in earlier migrations only ever granted table
-- privileges to anon. Reading and writing therefore failed with
-- 42501 permission denied even though the policies allowed the operation.
--
-- This restores the privileges each role actually needs:
--   * authenticated — the signed-in admin, for every table the UI touches;
--   * anon — only the Mobile.bg publisher tables, which the server worker
--     reaches with the public key when the service role key is not configured.
--     Follow-up: move that worker to the service role key and revoke these.
--
-- Idempotent: safe to run more than once.

do $$
declare
  app_tables text[] := array[
    'agents', 'agent_logs', 'agent_actions', 'audit_log', 'backups',
    'calculations', 'calculator_versions', 'client_searches', 'images',
    'import_conflicts', 'imports', 'job_items', 'jobs', 'listing_history',
    'market_fingerprint', 'mobile_bg_dedup_checks', 'mobile_bg_draft_action_log',
    'mobile_bg_draft_extras', 'mobile_bg_draft_fields', 'mobile_bg_draft_images',
    'mobile_bg_drafts', 'mobile_bg_publish_jobs', 'price_history',
    'publish_attempts', 'sales', 'saved_filters', 'source_listing_jobs',
    'vehicle_marketplace', 'vehicle_status_log', 'vehicles'
  ];
  publisher_tables text[] := array[
    'mobile_bg_draft_action_log', 'mobile_bg_draft_extras', 'mobile_bg_draft_fields',
    'mobile_bg_draft_images', 'mobile_bg_drafts', 'mobile_bg_publish_jobs'
  ];
  t text;
begin
  foreach t in array app_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;

  foreach t in array publisher_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('grant select on table public.%I to anon', t);
  end loop;

  if to_regclass('public.mobile_bg_publish_jobs') is not null then
    execute 'grant insert, update on table public.mobile_bg_publish_jobs to anon';
  end if;
  -- The publisher writes the draft status and the run stage back, so it needs
  -- UPDATE here as well as the select grant above; it never needs DELETE.
  if to_regclass('public.mobile_bg_drafts') is not null then
    execute 'grant update on table public.mobile_bg_drafts to anon';
  end if;
  if to_regclass('public.mobile_bg_draft_action_log') is not null then
    execute 'grant insert on table public.mobile_bg_draft_action_log to anon';
  end if;
end $$;

-- Policies: earlier migrations created them for anon and authenticated, but a
-- table recreated by hand in the dashboard loses them while keeping RLS on.
-- Recreate the ones the app depends on, so a queue insert cannot be refused by
-- a missing policy that the code has no way to see.
do $$
declare
  specs text[][] := array[
    ['mobile_bg_drafts', 'select'], ['mobile_bg_drafts', 'insert'],
    ['mobile_bg_drafts', 'update'], ['mobile_bg_drafts', 'delete'],
    ['mobile_bg_draft_fields', 'select'], ['mobile_bg_draft_fields', 'insert'],
    ['mobile_bg_draft_fields', 'update'], ['mobile_bg_draft_fields', 'delete'],
    ['mobile_bg_draft_extras', 'select'], ['mobile_bg_draft_extras', 'insert'],
    ['mobile_bg_draft_extras', 'update'], ['mobile_bg_draft_extras', 'delete'],
    ['mobile_bg_draft_images', 'select'], ['mobile_bg_draft_images', 'insert'],
    ['mobile_bg_draft_images', 'update'], ['mobile_bg_draft_images', 'delete'],
    ['mobile_bg_draft_action_log', 'select'], ['mobile_bg_draft_action_log', 'insert'],
    ['mobile_bg_publish_jobs', 'select'], ['mobile_bg_publish_jobs', 'insert'],
    ['mobile_bg_publish_jobs', 'update'],
    ['mobile_bg_dedup_checks', 'select'], ['mobile_bg_dedup_checks', 'insert'],
    ['mobile_bg_dedup_checks', 'update'], ['mobile_bg_dedup_checks', 'delete']
  ];
  spec text[];
  t text;
  cmd text;
  policy_name text;
  using_clause text;
begin
  foreach spec slice 1 in array specs loop
    t := spec[1];
    cmd := upper(spec[2]);
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    policy_name := format('app_%s_%s', cmd, t);
    using_clause := case when cmd = 'INSERT' then 'with check (true)' else 'using (true)' end;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', policy_name, t);
    execute format('create policy %I on public.%I for %s to anon, authenticated %s', policy_name, t, cmd, using_clause);
  end loop;
end $$;

-- The publisher claims work through this function; it was only granted to anon.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'claim_mobile_bg_publish_job') then
    execute 'grant execute on function public.claim_mobile_bg_publish_job(text) to anon, authenticated';
  end if;
end $$;

-- A job that was claimed and then died with its worker — a restart, a crash, a
-- timeout — stayed RUNNING for ever. Nothing ever reset it, and the screen
-- keeps the publish button disabled while a job is RUNNING, so one interrupted
-- run made the draft look permanently stuck. Reclaim those jobs first.
create or replace function public.claim_mobile_bg_publish_job(worker_name text)
returns setof public.mobile_bg_publish_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.mobile_bg_publish_jobs;
begin
  update public.mobile_bg_publish_jobs
     set status = 'QUEUED',
         claimed_by = null,
         last_error = 'Предишният опит прекъсна, задачата е върната в опашката.',
         updated_at = now()
   where status = 'RUNNING'
     and started_at < now() - interval '15 minutes';

  select * into claimed
  from public.mobile_bg_publish_jobs
  where status = 'QUEUED'
  order by requested_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.mobile_bg_publish_jobs
     set status = 'RUNNING', claimed_by = worker_name,
         attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

grant execute on function public.claim_mobile_bg_publish_job(text) to anon, authenticated;