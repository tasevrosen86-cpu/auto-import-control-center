-- Royal Cars BG — one master draft, many company publications.
--
-- The owner keeps one draft of a car and publishes it for several firms. Each
-- firm is a separate listing with its own price, its own phone and its own text,
-- and each one succeeds or fails on its own. Nothing here publishes anything: it
-- is the shape the work will be done in, so the tables can be reviewed and
-- filled before any code writes to them.
--
-- Stage 1 adds the structure only. The broker flow that exists today is not
-- touched: no column on `mobile_bg_drafts` changes meaning, no policy is
-- replaced, and a draft is still published exactly as before when no row here
-- mentions it.
--
-- Why each company publication gets its own `mobile_bg_drafts` row
-- ----------------------------------------------------------------
-- The publisher already reads a draft for everything it sends — the field rows,
-- the selected pictures, the price — and the queue allows exactly one job per
-- draft. So a company publication is a *clone* of the master draft: same car,
-- but its own row, so its own fields, its own pictures, its own price, its own
-- job and its own outcome. A failure on one firm's listing cannot touch another
-- firm's row, which is the requirement. The clone function itself is stage 2;
-- this migration only makes the connection expressible.

-- ============================================================
-- 1. Marking the master draft
-- ============================================================
-- Opt-in, and false for every existing row, so the broker flow is untouched by
-- definition. A master draft is a source to copy from, not a listing to publish
-- on its own.
alter table public.mobile_bg_drafts
  add column if not exists is_master boolean not null default false;

create index if not exists idx_drafts_master
  on public.mobile_bg_drafts(is_master) where is_master;

-- ============================================================
-- 2. What each company publishes with
-- ============================================================
-- The phone and the text a firm's listing carries. Kept beside the company
-- rather than in code, because it is a business fact that changes without a
-- deploy, and kept apart from `companies` so the firm's identity and its
-- advertising voice can change independently.
create table if not exists public.company_publication_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  contact_phone text,
  contact_email text,
  seller_name text,
  -- The body a firm's listings carry. Nullable: a firm without its own text
  -- publishes with the master draft's description unchanged.
  description_template text,
  extra_conditions text,
  -- Which Mobile.bg account this firm publishes through. Today the publisher
  -- reads one account from the VPS environment, which is enough for Royal Cars
  -- BG and nothing else. Recording the intended account here now means a second
  -- firm with API access is a row and a worker change, not a schema change — and
  -- `secret_ref` is a *name*, never the credential itself, so a database dump
  -- never carries a password. Royal Cars is left null: it keeps publishing
  -- through the environment exactly as it does today.
  mobile_bg_account_ref text,
  mobile_bg_secret_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. How each company's price is reached
-- ============================================================
-- One rule per firm, for now. A fixed amount or a percentage, with optional
-- bounds so an expensive car cannot be pushed out of the market by a percentage
-- that was never meant for it.
--
-- Royal Cars BG is seeded at zero on purpose: the owner's own firm publishes at
-- the calculated price, exactly as today, so switching this on changes nothing
-- about the existing listing.
create table if not exists public.company_commission_rules (
  company_id uuid primary key references public.companies(id) on delete cascade,
  commission_type text not null default 'FIXED',
  commission_value numeric not null default 0,
  commission_currency text not null default 'EUR',
  min_price_eur numeric,
  max_price_eur numeric,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.company_commission_rules
  drop constraint if exists company_commission_rules_type_check;
alter table public.company_commission_rules
  add constraint company_commission_rules_type_check
  check (commission_type in ('FIXED', 'PERCENT'));

-- A negative commission is a discount nobody asked for, and an unbounded one is
-- a typo waiting to happen.
alter table public.company_commission_rules
  drop constraint if exists company_commission_rules_value_check;
alter table public.company_commission_rules
  add constraint company_commission_rules_value_check
  check (commission_value >= 0
         and (commission_type <> 'PERCENT' or commission_value <= 100)
         and (min_price_eur is null or max_price_eur is null or min_price_eur <= max_price_eur));

insert into public.company_commission_rules (company_id, commission_type, commission_value)
select id, 'FIXED', 0 from public.companies where slug = 'royal-cars-bg'
on conflict (company_id) do nothing;

-- ============================================================
-- 4. One publication per company, per master draft
-- ============================================================
-- This is the join the owner asked to keep: which firms a car went out to, with
-- what price and what text, and how each one ended.
--
--   * `master_draft_id` is what was copied from, and the anchor the monitoring
--     agent reads a car through: one master, its publications in every firm.
--   * `draft_id` is the firm's own draft, filled in when the clone is made.
--     Nullable until then, and it is the row the publisher actually reads.
--   * The outcome lives here and nowhere shared: `status`, `error_message` and
--     the prices are this firm's alone.
--
-- `on delete restrict` on the master is deliberate and is the opposite of the
-- obvious choice. Cascading would let deleting one draft silently erase the
-- record of listings that are live on Mobile.bg right now, and the monitoring
-- agent would then have nothing to stop them with. A master cannot be discarded
-- until its publications are resolved, which is the order the owner has to work
-- in anyway: take the listings down, then delete the car.
create table if not exists public.company_publications (
  id uuid primary key default gen_random_uuid(),
  master_draft_id uuid not null references public.mobile_bg_drafts(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  draft_id uuid unique references public.mobile_bg_drafts(id) on delete set null,
  status text not null default 'PENDING',
  error_message text,
  calculated_price_eur numeric,
  published_price_eur numeric,
  commission_applied_eur numeric,
  -- What was actually sent, kept after the fact: the commission rule or phone
  -- number may change later, and the listing that went out has to stay
  -- explainable from the row itself.
  phone_used text,
  description_used text,
  mobile_bg_listing_id bigint,
  mobile_bg_url text,
  -- What each firm actually receives for the car. The commission and the prices
  -- above are what was calculated; this is the figure that went out, which is not
  -- always the one that was intended once a firm adjusts it by hand.
  listed_price_eur numeric,
  -- The car's life within this firm, kept apart from the publishing pipeline
  -- exactly as it is on the draft: a listing that is live is not the same
  -- question as a car that has been sold, and the monitoring agent has to answer
  -- both.
  listing_state text not null default 'AVAILABLE',
  sold_at timestamptz,
  sold_price_eur numeric,
  attempts integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  -- One firm is published once per master draft. Without this, ticking the same
  -- checkbox twice publishes the same car twice.
  unique (master_draft_id, company_id)
);

alter table public.company_publications
  drop constraint if exists company_publications_listing_state_check;
alter table public.company_publications
  add constraint company_publications_listing_state_check
  check (listing_state in ('AVAILABLE', 'SOLD', 'INACTIVE'));

alter table public.company_publications
  drop constraint if exists company_publications_status_check;
alter table public.company_publications
  add constraint company_publications_status_check
  check (status in (
    'PENDING', 'READY', 'QUEUED', 'PUBLISHING',
    'PUBLISHED', 'ERROR', 'CANCELLED'
  ));

-- A master draft must not be its own company publication, which would be a loop
-- the clone step could follow forever.
alter table public.company_publications
  drop constraint if exists company_publications_not_self;
alter table public.company_publications
  add constraint company_publications_not_self
  check (draft_id is null or draft_id <> master_draft_id);

create index if not exists idx_company_publications_master
  on public.company_publications(master_draft_id);
create index if not exists idx_company_publications_company_status
  on public.company_publications(company_id, status);
create index if not exists idx_company_publications_draft
  on public.company_publications(draft_id) where draft_id is not null;

-- ============================================================
-- 5. The per-publication log
-- ============================================================
-- The same shape as `mobile_bg_draft_action_log`, scoped to the publication
-- instead of the draft, so one firm's history is readable without filtering a
-- shared log for a draft id that belongs to another firm.
create table if not exists public.company_publication_events (
  id bigint generated always as identity primary key,
  company_publication_id uuid not null references public.company_publications(id) on delete cascade,
  -- Carried here as well as on the parent: the firm is a property of the event,
  -- and a policy that has to join to answer is a policy that is easy to get
  -- wrong.
  company_id uuid not null references public.companies(id) on delete restrict,
  action text not null,
  actor text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_publication_events_publication
  on public.company_publication_events(company_publication_id, created_at desc);

-- ============================================================
-- 6. Where each publication actually went
-- ============================================================
-- The map the monitoring agent will read: for one company publication, the
-- listing identifiers on each target, so it can stop or replace a specific
-- listing without searching by title or guessing.
--
-- `target` is a word rather than a table reference on purpose: the agent may act
-- on a channel that is not Mobile.bg, and a new channel should not need a schema
-- change to be recorded.
create table if not exists public.company_publication_links (
  id uuid primary key default gen_random_uuid(),
  company_publication_id uuid not null references public.company_publications(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  target text not null default 'MOBILE_BG',
  external_listing_id text,
  external_url text,
  status text not null default 'PENDING',
  last_checked_at timestamptz,
  -- Set when the owner asks for the listing to come down; the agent clears it
  -- when the removal is confirmed, so the request survives a failed attempt.
  stop_requested_at timestamptz,
  -- Set when the listing is to be replaced by a newer version of the car.
  replace_requested_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_publication_id, target)
);

create index if not exists idx_company_publication_links_company
  on public.company_publication_links(company_id, status);
create index if not exists idx_company_publication_links_stop
  on public.company_publication_links(stop_requested_at)
  where stop_requested_at is not null;

-- ============================================================
-- 7. Who may see and change what
-- ============================================================
-- The same two audiences as the rest of the schema: a firm sees its own rows,
-- a system administrator sees everything. `anon` is granted nothing here — no
-- worker reads these tables yet, and the monitoring agent will run with the
-- service role.
--
-- The authoring tables are readable by the firm they describe (a manager should
-- see their own commission) but writable only by a system administrator, because
-- a firm that can edit its own commission can choose what it pays.

alter table public.company_publication_profiles enable row level security;
alter table public.company_commission_rules enable row level security;
alter table public.company_publications enable row level security;
alter table public.company_publication_events enable row level security;
alter table public.company_publication_links enable row level security;

drop policy if exists company_publication_profiles_read on public.company_publication_profiles;
create policy company_publication_profiles_read on public.company_publication_profiles
  for select to authenticated
  using (public.can_access_company(company_id));

drop policy if exists company_publication_profiles_admin on public.company_publication_profiles;
create policy company_publication_profiles_admin on public.company_publication_profiles
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

drop policy if exists company_commission_rules_read on public.company_commission_rules;
create policy company_commission_rules_read on public.company_commission_rules
  for select to authenticated
  using (public.can_access_company(company_id));

drop policy if exists company_commission_rules_admin on public.company_commission_rules;
create policy company_commission_rules_admin on public.company_commission_rules
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

drop policy if exists company_publications_read on public.company_publications;
create policy company_publications_read on public.company_publications
  for select to authenticated
  using (public.can_access_company(company_id));

-- Only an administrator starts a publication or changes its outcome; a firm
-- reads the result.
drop policy if exists company_publications_admin_write on public.company_publications;
create policy company_publications_admin_write on public.company_publications
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

drop policy if exists company_publication_events_read on public.company_publication_events;
create policy company_publication_events_read on public.company_publication_events
  for select to authenticated
  using (public.can_access_company(company_id));

drop policy if exists company_publication_events_admin_write on public.company_publication_events;
create policy company_publication_events_admin_write on public.company_publication_events
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

drop policy if exists company_publication_links_read on public.company_publication_links;
create policy company_publication_links_read on public.company_publication_links
  for select to authenticated
  using (public.can_access_company(company_id));

drop policy if exists company_publication_links_admin_write on public.company_publication_links;
create policy company_publication_links_admin_write on public.company_publication_links
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

grant select on public.company_publication_profiles to authenticated;
grant select on public.company_commission_rules to authenticated;
grant select, insert, update, delete on public.company_publications to authenticated;
grant select, insert, update, delete on public.company_publication_events to authenticated;
grant select, insert, update, delete on public.company_publication_links to authenticated;

grant all on public.company_publication_profiles to service_role;
grant all on public.company_commission_rules to service_role;
grant all on public.company_publications to service_role;
grant all on public.company_publication_events to service_role;
grant all on public.company_publication_links to service_role;

-- The events table numbers itself; nothing outside the database needs the
-- sequence, and a client that could advance it could fake an id.
grant usage, select on sequence public.company_publication_events_id_seq to service_role;

-- ============================================================
-- 8. The firms to offer, with what they publish at
-- ============================================================
-- The checkbox list the owner described, in one query: each active firm with its
-- commission and its contact details, and whether it is ready to be ticked.
--
-- `security_invoker = true` for the same reason as the published-listings view:
-- without it the view would run as its owner and hand a firm's commission to
-- whoever selected from it.
drop view if exists public.company_publication_options;
create view public.company_publication_options
with (security_invoker = true) as
select
  c.id as company_id,
  c.slug,
  c.name,
  c.status,
  p.contact_phone,
  p.contact_email,
  p.seller_name,
  p.is_active as profile_active,
  p.mobile_bg_account_ref,
  -- The firm's own advertising phone, else the number on the company itself.
  -- Royal Cars BG already carries its number on `companies` and has no row here
  -- yet, so the fallback is what keeps the first firm selectable.
  coalesce(p.contact_phone, c.phone) as effective_phone,
  r.commission_type,
  r.commission_value,
  r.commission_currency,
  r.min_price_eur,
  r.max_price_eur,
  (coalesce(p.contact_phone, c.phone) is not null) as has_phone,
  -- Whether the firm can actually be ticked for Mobile.bg. The publisher still
  -- takes its account from the VPS environment, so `mobile_bg_account_ref` being
  -- null is not a failure today — but the flag is what a second firm's row will
  -- turn on, and it keeps the reason visible in one place instead of in the
  -- worker.
  (c.status = 'ACTIVE'
   and coalesce(p.is_active, true)
   and coalesce(p.contact_phone, c.phone) is not null) as ready_to_publish
from public.companies c
left join public.company_publication_profiles p on p.company_id = c.id
left join public.company_commission_rules r on r.company_id = c.id;

grant select on public.company_publication_options to authenticated;
grant select on public.company_publication_options to service_role;
