/*
# Mobile.bg Draft System — Tables for Publishing Workflow

## Summary
This migration creates the full data model for the "Обяви" (Drafts) section of the
Auto Import Control Center. It enables creating, validating, and tracking Mobile.bg
listing drafts that map 1:1 to the real Mobile.bg publishing form.

## New Tables

1. `mobile_bg_drafts` — Main draft records, one per listing being prepared
2. `mobile_bg_draft_fields` — Per-field values for each draft (structured data)
3. `mobile_bg_draft_extras` — Selected extras (checkboxes) per draft
4. `mobile_bg_draft_images` — Image records for each draft
5. `mobile_bg_draft_action_log` — Audit trail for every action
6. `mobile_bg_dedup_checks` — Duplicate detection results

## Security
- RLS enabled on all tables, single-tenant (anon + authenticated CRUD)
- All tables have company_id for future multi-tenant support

## Important Notes
- company_id defaults to a single-tenant placeholder UUID
- dedup_hash = md5(make|model|year|fuel|generation|facelift|drivetrain)
*/

-- ============================================================
-- 1. mobile_bg_drafts
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_bg_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  catalog_permanent_id integer,
  title text,
  status text NOT NULL DEFAULT 'DRAFT',
  source_type text NOT NULL DEFAULT 'catalog',
  source_url text,
  source_listing_id text,
  source_vin text,
  source_price_eur numeric,
  mobile_bg_url text,
  mobile_bg_listing_id text,
  dedup_hash text,
  broker_name text,
  created_by text,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  published_at timestamptz,
  last_checked_at timestamptz,
  publish_error text
);

ALTER TABLE mobile_bg_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_drafts" ON mobile_bg_drafts;
CREATE POLICY "anon_select_drafts" ON mobile_bg_drafts FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_drafts" ON mobile_bg_drafts;
CREATE POLICY "anon_insert_drafts" ON mobile_bg_drafts FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_drafts" ON mobile_bg_drafts;
CREATE POLICY "anon_update_drafts" ON mobile_bg_drafts FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_drafts" ON mobile_bg_drafts;
CREATE POLICY "anon_delete_drafts" ON mobile_bg_drafts FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_drafts_status ON mobile_bg_drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_company ON mobile_bg_drafts(company_id);
CREATE INDEX IF NOT EXISTS idx_drafts_dedup_hash ON mobile_bg_drafts(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_drafts_source_listing ON mobile_bg_drafts(source_listing_id);
CREATE INDEX IF NOT EXISTS idx_drafts_vin ON mobile_bg_drafts(source_vin);
CREATE INDEX IF NOT EXISTS idx_drafts_mobile_bg_id ON mobile_bg_drafts(mobile_bg_listing_id);

-- ============================================================
-- 2. mobile_bg_draft_fields
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_bg_draft_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  mobile_bg_label text NOT NULL,
  our_db_key text NOT NULL,
  value text,
  field_type text NOT NULL DEFAULT 'text',
  source text NOT NULL DEFAULT 'manual',
  proof text,
  validation_status text NOT NULL DEFAULT 'pending',
  filled_at timestamptz,
  is_manual_edit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, field_key)
);

ALTER TABLE mobile_bg_draft_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_draft_fields" ON mobile_bg_draft_fields;
CREATE POLICY "anon_select_draft_fields" ON mobile_bg_draft_fields FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_draft_fields" ON mobile_bg_draft_fields;
CREATE POLICY "anon_insert_draft_fields" ON mobile_bg_draft_fields FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_draft_fields" ON mobile_bg_draft_fields;
CREATE POLICY "anon_update_draft_fields" ON mobile_bg_draft_fields FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_draft_fields" ON mobile_bg_draft_fields;
CREATE POLICY "anon_delete_draft_fields" ON mobile_bg_draft_fields FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_draft_fields_draft ON mobile_bg_draft_fields(draft_id);

-- ============================================================
-- 3. mobile_bg_draft_extras
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_bg_draft_extras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  extra_key text NOT NULL,
  mobile_bg_label text NOT NULL,
  group_name text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  proof text,
  source text NOT NULL DEFAULT 'encar',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id, extra_key)
);

ALTER TABLE mobile_bg_draft_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_draft_extras" ON mobile_bg_draft_extras;
CREATE POLICY "anon_select_draft_extras" ON mobile_bg_draft_extras FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_draft_extras" ON mobile_bg_draft_extras;
CREATE POLICY "anon_insert_draft_extras" ON mobile_bg_draft_extras FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_draft_extras" ON mobile_bg_draft_extras;
CREATE POLICY "anon_update_draft_extras" ON mobile_bg_draft_extras FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_draft_extras" ON mobile_bg_draft_extras;
CREATE POLICY "anon_delete_draft_extras" ON mobile_bg_draft_extras FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_draft_extras_draft ON mobile_bg_draft_extras(draft_id);

-- ============================================================
-- 4. mobile_bg_draft_images
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_bg_draft_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  source_url text,
  local_path text,
  converted_jpg boolean NOT NULL DEFAULT false,
  is_selected boolean NOT NULL DEFAULT false,
  is_main boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  real_car_photo_check boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'pending',
  size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_bg_draft_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_draft_images" ON mobile_bg_draft_images;
CREATE POLICY "anon_select_draft_images" ON mobile_bg_draft_images FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_draft_images" ON mobile_bg_draft_images;
CREATE POLICY "anon_insert_draft_images" ON mobile_bg_draft_images FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_draft_images" ON mobile_bg_draft_images;
CREATE POLICY "anon_update_draft_images" ON mobile_bg_draft_images FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_draft_images" ON mobile_bg_draft_images;
CREATE POLICY "anon_delete_draft_images" ON mobile_bg_draft_images FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_draft_images_draft ON mobile_bg_draft_images(draft_id);

-- ============================================================
-- 5. mobile_bg_draft_action_log
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_bg_draft_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_bg_draft_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_action_log" ON mobile_bg_draft_action_log;
CREATE POLICY "anon_select_action_log" ON mobile_bg_draft_action_log FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_action_log" ON mobile_bg_draft_action_log;
CREATE POLICY "anon_insert_action_log" ON mobile_bg_draft_action_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_action_log_draft ON mobile_bg_draft_action_log(draft_id);

-- ============================================================
-- 6. mobile_bg_dedup_checks
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_bg_dedup_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES mobile_bg_drafts(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  matched_draft_id uuid,
  matched_mobile_bg_url text,
  matched_broker_name text,
  matched_date timestamptz,
  is_duplicate boolean NOT NULL DEFAULT false,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by text,
  resolved_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mobile_bg_dedup_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dedup" ON mobile_bg_dedup_checks;
CREATE POLICY "anon_select_dedup" ON mobile_bg_dedup_checks FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_dedup" ON mobile_bg_dedup_checks;
CREATE POLICY "anon_insert_dedup" ON mobile_bg_dedup_checks FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_dedup" ON mobile_bg_dedup_checks;
CREATE POLICY "anon_update_dedup" ON mobile_bg_dedup_checks FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_dedup" ON mobile_bg_dedup_checks;
CREATE POLICY "anon_delete_dedup" ON mobile_bg_dedup_checks FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dedup_draft ON mobile_bg_dedup_checks(draft_id);
CREATE INDEX IF NOT EXISTS idx_dedup_unresolved ON mobile_bg_dedup_checks(is_duplicate, resolved);
