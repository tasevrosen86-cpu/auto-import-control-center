-- Independent full-draft pipeline for the “Публикации” URL importer.
-- It intentionally does not read or write the mobile_bg_* tables used by “Обяви”.
create table if not exists public.publication_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text, status text not null default 'DRAFT' check (status in ('DRAFT','READY_FOR_REVIEW','ERROR','READY')),
  source_type text not null default 'other', source_url text, source_listing_id text, source_vin text,
  source_price_eur numeric, price_eur numeric, currency text not null default 'EUR',
  intake_origin text not null default 'URL_IMPORT', extraction_status text not null default 'NOT_REQUESTED',
  source_domain text, extraction_error text, created_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.publication_source_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.publication_drafts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_type text not null, source_url text not null, source_domain text not null, source_listing_id text,
  source_identity text not null, status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED')),
  attempt_count integer not null default 0, result jsonb, error_message text, raw_payload jsonb, normalized_payload jsonb,
  payload_received_at timestamptz, created_at timestamptz not null default now(), started_at timestamptz,
  finished_at timestamptz, updated_at timestamptz not null default now(), unique(owner_id, source_identity)
);
create table if not exists public.publication_draft_fields (
  id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.publication_drafts(id) on delete cascade,
  field_key text not null, mobile_bg_label text not null, our_db_key text not null, value text,
  field_type text not null default 'text', source text, proof text, validation_status text not null default 'pending',
  filled_at timestamptz, is_manual_edit boolean not null default false, unique(draft_id,field_key)
);
create table if not exists public.publication_draft_images (
  id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.publication_drafts(id) on delete cascade,
  source_url text not null, local_path text, converted_jpg boolean not null default false, is_selected boolean not null default true,
  is_main boolean not null default false, display_order integer not null default 1, real_car_photo_check boolean not null default false,
  processing_status text not null default 'pending', size_bytes bigint, created_at timestamptz not null default now()
);
create table if not exists public.publication_draft_extras (
  id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.publication_drafts(id) on delete cascade,
  extra_key text not null, mobile_bg_label text not null, group_name text not null default 'Други',
  selected boolean not null default true, proof text, source text, unique(draft_id,extra_key)
);
create table if not exists public.publication_draft_action_log (
  id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.publication_drafts(id) on delete cascade,
  action text not null, actor text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.publication_drafts enable row level security;
alter table public.publication_source_jobs enable row level security;
alter table public.publication_draft_fields enable row level security;
alter table public.publication_draft_images enable row level security;
alter table public.publication_draft_extras enable row level security;
alter table public.publication_draft_action_log enable row level security;
grant usage on schema public to authenticated, service_role;
grant select on public.publication_drafts, public.publication_source_jobs, public.publication_draft_fields, public.publication_draft_images, public.publication_draft_extras, public.publication_draft_action_log to authenticated;
grant select, insert, update, delete on public.publication_drafts, public.publication_source_jobs, public.publication_draft_fields, public.publication_draft_images, public.publication_draft_extras, public.publication_draft_action_log to service_role;
create policy publication_drafts_read_own on public.publication_drafts for select to authenticated using ((select auth.uid()) = owner_id);
create policy publication_source_jobs_read_own on public.publication_source_jobs for select to authenticated using ((select auth.uid()) = owner_id);
create policy publication_draft_fields_read_own on public.publication_draft_fields for select to authenticated using (exists (select 1 from public.publication_drafts d where d.id=draft_id and d.owner_id=(select auth.uid())));
create policy publication_draft_images_read_own on public.publication_draft_images for select to authenticated using (exists (select 1 from public.publication_drafts d where d.id=draft_id and d.owner_id=(select auth.uid())));
create policy publication_draft_extras_read_own on public.publication_draft_extras for select to authenticated using (exists (select 1 from public.publication_drafts d where d.id=draft_id and d.owner_id=(select auth.uid())));
create policy publication_draft_action_log_read_own on public.publication_draft_action_log for select to authenticated using (exists (select 1 from public.publication_drafts d where d.id=draft_id and d.owner_id=(select auth.uid())));
notify pgrst, 'reload schema';
