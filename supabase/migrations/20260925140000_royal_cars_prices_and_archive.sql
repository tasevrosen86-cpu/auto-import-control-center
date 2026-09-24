-- Royal Cars BG — prices, listing lifecycle and the published-listings list.
--
-- Stage 1 does not calculate anything: the broker does the arithmetic outside
-- the system and types the result in. What matters now is that the three prices
-- are stored separately and never overwrite each other, and that the list the
-- broker reads while a client is on the phone can be served in one query.

-- ============================================================
-- 1. Two more prices, alongside the source price
-- ============================================================
-- `source_price_eur` already holds what the source listing asked. Adding these
-- two rather than reusing it is the whole point: a calculation that later fills
-- `calculated_price_eur` must not be able to destroy the imported figure, and
-- the difference between them is what the manager reads.
alter table public.mobile_bg_drafts
  add column if not exists calculated_price_eur numeric,
  add column if not exists published_price_eur numeric,
  add column if not exists calculated_price_note text,
  add column if not exists calculated_price_source text not null default 'MANUAL';

-- A later calculator writes into the same column and says so here, so the UI can
-- show whether a number was typed or computed without another schema change.
alter table public.mobile_bg_drafts
  drop constraint if exists mobile_bg_drafts_calculated_price_source_check;
alter table public.mobile_bg_drafts
  add constraint mobile_bg_drafts_calculated_price_source_check
  check (calculated_price_source in ('MANUAL', 'CALCULATOR'));

-- ============================================================
-- 2. Listing lifecycle, kept apart from the pipeline status
-- ============================================================
-- `status` belongs to the publishing pipeline (DRAFT → PUBLISH_QUEUED →
-- PUBLISHED/ERROR) and the workers write it; changing its vocabulary would break
-- them. Whether a published car is still for sale is a different question, asked
-- at a different time, so it gets its own column.
--
-- Nothing here deletes a row: a sold or withdrawn car stays for the statistics
-- the owner asked to keep.
alter table public.mobile_bg_drafts
  add column if not exists listing_state text not null default 'AVAILABLE';

alter table public.mobile_bg_drafts
  drop constraint if exists mobile_bg_drafts_listing_state_check;
alter table public.mobile_bg_drafts
  add constraint mobile_bg_drafts_listing_state_check
  check (listing_state in ('AVAILABLE', 'SOLD', 'INACTIVE'));

alter table public.mobile_bg_drafts
  add column if not exists sold_at timestamptz,
  add column if not exists sold_price_eur numeric;

create index if not exists idx_drafts_listing_state on public.mobile_bg_drafts(listing_state);
create index if not exists idx_drafts_broker on public.mobile_bg_drafts(broker_name);

-- A published draft with no published price is normal for rows published before
-- this migration, so the price is backfilled from the source price and left
-- flagged as unknown rather than invented.
update public.mobile_bg_drafts
   set published_price_eur = source_price_eur
 where status = 'PUBLISHED'
   and published_price_eur is null
   and source_price_eur is not null;

-- ============================================================
-- 3. Field values, pivoted once for the list
-- ============================================================
-- The archive needs make, model, year, fuel and mileage as columns to filter on,
-- but they live as rows in `mobile_bg_draft_fields`. This function returns them
-- pivoted so the view below (and the search in the UI) has something to filter.
--
-- It is SECURITY DEFINER because the view has to read it, and a view's caller
-- cannot be relied on to hold SELECT on every table underneath. That makes the
-- company check the function's own responsibility: without it, any signed-in
-- user could pass another firm's draft id and read that car's details, since the
-- definer's rights skip the policies on `mobile_bg_draft_fields`.
create or replace function public.mobile_bg_draft_attributes(target_draft uuid)
returns table (make text, model text, model_year integer, fuel text, mileage_km integer, gearbox text, currency text, location text, main_image text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with attributes as (
    select
      max(f.value) filter (where f.field_key = 'make') as make,
      max(f.value) filter (where f.field_key = 'model') as model,
      nullif(regexp_replace(max(f.value) filter (where f.field_key = 'year'), '[^0-9]', '', 'g'), '')::integer as model_year,
      max(f.value) filter (where f.field_key = 'fuel') as fuel,
      nullif(regexp_replace(max(f.value) filter (where f.field_key = 'mileage'), '[^0-9]', '', 'g'), '')::integer as mileage_km,
      max(f.value) filter (where f.field_key = 'gearbox') as gearbox,
      max(f.value) filter (where f.field_key = 'currency') as currency,
      max(f.value) filter (where f.field_key = 'location') as location,
      (select i.source_url from public.mobile_bg_draft_images i
        where i.draft_id = target_draft and i.is_selected
        order by i.is_main desc, i.display_order asc limit 1) as main_image
    from public.mobile_bg_draft_fields f
    where f.draft_id = target_draft
  )
  -- The check is outside the aggregate on purpose. An aggregate with no GROUP BY
  -- always returns one row — nulls when nothing matched — so guarding inside the
  -- WHERE would still hand back a row for a draft the caller may not read, and
  -- filtering on the outside is what turns "not allowed" into "no rows".
  --
  -- A draft that is readable but has no field rows yet still returns its one
  -- null row, which the view's lateral join needs: no row would drop the car out
  -- of the archive entirely.
  select * from attributes where public.can_access_draft(target_draft);
$$;

-- Not granted to `anon`: nothing unauthenticated reads the archive, and the
-- function answers for any draft id it is handed.
revoke all on function public.mobile_bg_draft_attributes(uuid) from public;
revoke all on function public.mobile_bg_draft_attributes(uuid) from anon;
grant execute on function public.mobile_bg_draft_attributes(uuid) to authenticated, service_role;

-- ============================================================
-- 4. The published listings, as one readable row per car
-- ============================================================
-- `security_invoker = true` is what makes this view safe: without it the view
-- runs as its owner and would hand every company's rows to whoever selected
-- from it, which is exactly the hole this migration exists to close.
drop view if exists public.mobile_bg_published_listings;
create view public.mobile_bg_published_listings
with (security_invoker = true) as
select
  d.id,
  d.company_id,
  d.title,
  d.status,
  d.listing_state,
  a.make,
  a.model,
  a.model_year,
  a.fuel,
  a.mileage_km,
  a.gearbox,
  a.currency,
  a.location,
  a.main_image,
  d.source_type,
  d.source_url,
  d.source_listing_id,
  d.source_price_eur,
  d.calculated_price_eur,
  d.published_price_eur,
  d.calculated_price_note,
  d.calculated_price_source,
  -- Positive means the car went out above the calculated figure.
  case
    when d.calculated_price_eur is null or d.published_price_eur is null then null
    else d.published_price_eur - d.calculated_price_eur
  end as price_difference_eur,
  d.broker_name,
  d.created_by,
  d.created_at,
  d.published_at,
  d.mobile_bg_listing_id,
  d.mobile_bg_url,
  d.publish_error,
  d.sold_at,
  d.sold_price_eur,
  (d.status = 'PUBLISHED') as is_published
from public.mobile_bg_drafts d
cross join lateral public.mobile_bg_draft_attributes(d.id) a;

grant select on public.mobile_bg_published_listings to authenticated;
grant select on public.mobile_bg_published_listings to service_role;

-- ============================================================
-- 5. Master Catalog moves under the database, not the menu
-- ============================================================
-- The catalogue is the internal Cars Catalog v40 list and belongs to the system
-- administrator alone. Today it is a JSON file imported by the bundle, which
-- means every visitor downloads all 4674 rows and a hidden menu entry is the
-- only thing hiding it. A table with a policy is the real boundary: a company
-- admin or a broker asking the REST API for this table is refused by the
-- database, not by the interface.
create table if not exists public.master_catalog (
  permanent_id integer primary key,
  stable_key text,
  make text,
  model text,
  model_year integer,
  fuel text,
  priority integer,
  status text,
  company_status text,
  our_price_eur numeric,
  source_version text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_master_catalog_make on public.master_catalog(make);
create index if not exists idx_master_catalog_model on public.master_catalog(model);
create index if not exists idx_master_catalog_year on public.master_catalog(model_year);

alter table public.master_catalog enable row level security;

-- One policy, one audience. There is no company-scoped read of the catalogue at
-- all, which is the requirement: a firm never sees it.
drop policy if exists master_catalog_system_admin_only on public.master_catalog;
create policy master_catalog_system_admin_only on public.master_catalog
  for all to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

grant select, insert, update, delete on public.master_catalog to authenticated;
grant all on public.master_catalog to service_role;

-- The catalogue is not only a table: it is read while a draft is built. A broker
-- may still create a draft from a catalogue car, so the lookup the UI needs is
-- exposed as a SECURITY DEFINER function that returns one row and refuses a
-- non-administrator. A single row for a known id is not the catalogue.
create or replace function public.master_catalog_card(target_permanent_id integer)
returns table (permanent_id integer, make text, model text, model_year integer, fuel text, payload jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.permanent_id, c.make, c.model, c.model_year, c.fuel, c.payload
  from public.master_catalog c
  where c.permanent_id = target_permanent_id
    and (public.is_system_admin() or exists (
      -- A draft already built from this catalogue car is the one legitimate way a
      -- company reaches a catalogue row: it is their own draft.
      select 1 from public.mobile_bg_drafts d
      where d.catalog_permanent_id = target_permanent_id
        and public.can_access_company(d.company_id)
    ));
$$;

revoke all on function public.master_catalog_card(integer) from public;
grant execute on function public.master_catalog_card(integer) to authenticated, service_role;
