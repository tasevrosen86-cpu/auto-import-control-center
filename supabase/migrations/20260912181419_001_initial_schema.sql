/*
# Vehicle Catalog — Initial Schema

## Overview
Creates the complete vehicle catalog/inventory management system. This is a single-tenant
application (no sign-in required) for managing vehicle listings across multiple marketplaces
(Korea, Canada, mobile.bg), tracking prices, running import/agent jobs, and publishing listings.

## New Tables

1. **vehicles** — Core vehicle records with permanent IDs (immutable), make/model/year/fuel,
   priority, status, pricing, review flags, and raw JSON import data.
2. **vehicle_marketplace** — Per-marketplace listing data for each vehicle (Korea, Canada,
   mobile.bg), including native price, EUR-converted price, mileage, VIN, listing URLs,
   publication/market status.
3. **market_fingerprint** — Snapshots of marketplace search results for change detection.
4. **price_history** — Tracks price changes over time per vehicle/marketplace.
5. **listing_history** — Tracks listing events (created, updated, removed, etc.).
6. **vehicle_status_log** — Audit trail of vehicle status changes.
7. **audit_log** — Generic audit trail for all entities.
8. **backups** — Metadata for pre-import database backups.
9. **imports** — Import job records with progress tracking (dry_run, test, full modes).
10. **import_conflicts** — Conflicts detected during import (immutable field mismatches, etc.).
11. **agents** — External agent registrations with API tokens.
12. **jobs** — Background job queue (market checks, publishing, etc.).
13. **job_items** — Per-vehicle items within a job.
14. **agent_logs** — Log messages from agents during job execution.
15. **agent_actions** — Actions performed by agents during job execution.
16. **calculator_versions** — Price calculator versions (only one active at a time).
17. **calculations** — Price calculation results per vehicle/marketplace.
18. **images** — Vehicle images with source URLs and local paths.
19. **publish_attempts** — Attempts to publish listings to mobile.bg.
20. **saved_filters** — Saved search/filter presets.

## Security
- RLS enabled on all tables.
- All policies use `TO anon, authenticated` (single-tenant, no sign-in app).
- Full CRUD access for anon + authenticated roles on all tables.

## Important Notes
- `vehicles.permanent_id` is IMMUTABLE — never renumbered.
- `touch_updated_at()` trigger auto-updates `updated_at` on vehicles and vehicle_marketplace.
- Marketplaces are constrained to: korea, canada, mobile_bg.
- Import modes: dry_run, test, full.
*/

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============ vehicles ============
CREATE TABLE IF NOT EXISTS vehicles (
  permanent_id        INTEGER PRIMARY KEY,
  stable_key          TEXT NOT NULL,
  make                TEXT NOT NULL,
  model               TEXT NOT NULL,
  model_year          INTEGER NOT NULL,
  fuel                TEXT NOT NULL,
  priority            SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status              TEXT NOT NULL DEFAULT 'ACTIVE',
  our_price_eur       NUMERIC(12,2),
  notes               TEXT,
  flags_needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
  flags_reasons       TEXT[] NOT NULL DEFAULT '{}',
  raw_json            JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_import_at      TIMESTAMPTZ,
  import_source       TEXT,
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicles_make ON vehicles (make);
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model ON vehicles (make, model);
CREATE INDEX IF NOT EXISTS idx_vehicles_combo ON vehicles (make, model, model_year, fuel);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_priority ON vehicles (priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_review ON vehicles (flags_needs_review) WHERE flags_needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_vehicles_raw_json ON vehicles USING GIN (raw_json jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_vehicles_stable_key ON vehicles (stable_key);

-- ============ vehicle_marketplace ============
CREATE TABLE IF NOT EXISTS vehicle_marketplace (
  id                  BIGSERIAL PRIMARY KEY,
  vehicle_id          INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace         TEXT NOT NULL CHECK (marketplace IN ('korea','canada','mobile_bg')),
  filter_url          TEXT,
  listing_url         TEXT,
  listing_id          TEXT,
  price_native        NUMERIC(14,2),
  price_currency      TEXT,
  final_eur           NUMERIC(12,2),
  mileage_km          INTEGER,
  vin                 TEXT,
  configuration       TEXT,
  last_check          TIMESTAMPTZ,
  source_status       TEXT,
  our_price_eur       NUMERIC(12,2),
  our_listing_url     TEXT,
  publication_status  TEXT,
  market_status       TEXT,
  extra               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, marketplace)
);

CREATE INDEX IF NOT EXISTS idx_vmp_vehicle ON vehicle_marketplace (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vmp_marketplace ON vehicle_marketplace (marketplace);
CREATE INDEX IF NOT EXISTS idx_vmp_source_status ON vehicle_marketplace (marketplace, source_status);
CREATE INDEX IF NOT EXISTS idx_vmp_last_check ON vehicle_marketplace (last_check);

-- ============ market_fingerprint ============
CREATE TABLE IF NOT EXISTS market_fingerprint (
  id                BIGSERIAL PRIMARY KEY,
  vehicle_id        INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace       TEXT NOT NULL CHECK (marketplace IN ('korea','canada','mobile_bg')),
  fingerprint_hash  TEXT NOT NULL,
  top_results       JSONB NOT NULL,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fingerprint_vehicle ON market_fingerprint (vehicle_id, marketplace, captured_at DESC);

-- ============ price_history ============
CREATE TABLE IF NOT EXISTS price_history (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace   TEXT NOT NULL,
  listing_id    TEXT,
  old_price     NUMERIC(14,2),
  new_price     NUMERIC(14,2),
  currency      TEXT,
  change_type   TEXT NOT NULL,
  reason        TEXT,
  source        TEXT NOT NULL DEFAULT 'import',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_vehicle ON price_history (vehicle_id, marketplace, changed_at DESC);

-- ============ listing_history ============
CREATE TABLE IF NOT EXISTS listing_history (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace   TEXT NOT NULL,
  listing_id    TEXT,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_history_vehicle ON listing_history (vehicle_id, marketplace, created_at DESC);

-- ============ vehicle_status_log ============
CREATE TABLE IF NOT EXISTS vehicle_status_log (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  old_status    TEXT,
  new_status    TEXT NOT NULL,
  reason        TEXT,
  actor         TEXT NOT NULL DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_log_vehicle ON vehicle_status_log (vehicle_id, created_at DESC);

-- ============ audit_log ============
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  before        JSONB,
  after         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

-- ============ backups ============
CREATE TABLE IF NOT EXISTS backups (
  id            BIGSERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  location      TEXT NOT NULL,
  size_bytes    BIGINT,
  checksum      TEXT,
  record_count  INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT NOT NULL DEFAULT 'system'
);

-- ============ imports ============
CREATE TABLE IF NOT EXISTS imports (
  id            BIGSERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('dry_run','test','full')),
  source_path   TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'RUNNING',
  files         JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_records INTEGER NOT NULL DEFAULT 0,
  inserted      INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  conflicts     INTEGER NOT NULL DEFAULT 0,
  backup_id     BIGINT REFERENCES backups(id),
  error_info    JSONB
);

-- ============ import_conflicts ============
CREATE TABLE IF NOT EXISTS import_conflicts (
  id            BIGSERIAL PRIMARY KEY,
  import_id     BIGINT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  permanent_id  INTEGER,
  stable_key    TEXT,
  conflict_type TEXT NOT NULL,
  details       JSONB NOT NULL,
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_conflicts_import ON import_conflicts (import_id, resolved);

-- ============ agents ============
CREATE TABLE IF NOT EXISTS agents (
  id            BIGSERIAL PRIMARY KEY,
  agent_key     TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ jobs ============
CREATE TABLE IF NOT EXISTS jobs (
  job_id        BIGSERIAL PRIMARY KEY,
  job_type      TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'QUEUED',
  parameters    JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_items     INTEGER,
  progress      INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  error_info    JSONB
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at DESC);

-- ============ job_items ============
CREATE TABLE IF NOT EXISTS job_items (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id),
  marketplace   TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  result        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  UNIQUE (job_id, vehicle_id, marketplace)
);

CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items (job_id, status);

-- ============ agent_logs ============
CREATE TABLE IF NOT EXISTS agent_logs (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT REFERENCES jobs(job_id) ON DELETE SET NULL,
  agent_id      TEXT,
  level         TEXT NOT NULL DEFAULT 'INFO',
  message       TEXT NOT NULL,
  context       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_job ON agent_logs (job_id, created_at DESC);

-- ============ agent_actions ============
CREATE TABLE IF NOT EXISTS agent_actions (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT REFERENCES jobs(job_id) ON DELETE SET NULL,
  vehicle_id    INTEGER REFERENCES vehicles(permanent_id),
  action_type   TEXT NOT NULL,
  payload       JSONB,
  result        JSONB,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_job ON agent_actions (job_id, created_at DESC);

-- ============ calculator_versions ============
CREATE TABLE IF NOT EXISTS calculator_versions (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  description   TEXT,
  active        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

-- ============ calculations ============
CREATE TABLE IF NOT EXISTS calculations (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace   TEXT NOT NULL,
  calculator_id BIGINT NOT NULL REFERENCES calculator_versions(id),
  inputs        JSONB NOT NULL,
  outputs       JSONB NOT NULL,
  final_eur     NUMERIC(12,2),
  confidence    NUMERIC(4,3),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calculations_vehicle ON calculations (vehicle_id, marketplace, calculated_at DESC);

-- ============ images ============
CREATE TABLE IF NOT EXISTS images (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace   TEXT,
  source_url    TEXT NOT NULL,
  local_path    TEXT,
  converted_jpg BOOLEAN NOT NULL DEFAULT FALSE,
  size_bytes    BIGINT,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, source_url)
);

-- ============ publish_attempts ============
CREATE TABLE IF NOT EXISTS publish_attempts (
  id            BIGSERIAL PRIMARY KEY,
  job_id        BIGINT REFERENCES jobs(job_id) ON DELETE SET NULL,
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(permanent_id) ON DELETE CASCADE,
  marketplace   TEXT NOT NULL DEFAULT 'mobile_bg',
  our_price_eur NUMERIC(12,2),
  listing_url   TEXT,
  listing_id    TEXT,
  status        TEXT NOT NULL,
  error         TEXT,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publish_attempts_vehicle ON publish_attempts (vehicle_id, attempted_at DESC);

-- ============ saved_filters ============
CREATE TABLE IF NOT EXISTS saved_filters (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  scope         TEXT NOT NULL,
  filter_json   JSONB NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Triggers ============
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicles_touch ON vehicles;
CREATE TRIGGER trg_vehicles_touch BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_vmp_touch ON vehicle_marketplace;
CREATE TRIGGER trg_vmp_touch BEFORE UPDATE ON vehicle_marketplace
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============ RLS Policies ============
-- Single-tenant app: anon + authenticated have full CRUD on all tables.

-- Helper: enable RLS on all tables
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_marketplace ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_fingerprint ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

-- Vehicles policies
DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
CREATE POLICY "anon_select_vehicles" ON vehicles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
CREATE POLICY "anon_insert_vehicles" ON vehicles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
CREATE POLICY "anon_update_vehicles" ON vehicles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
CREATE POLICY "anon_delete_vehicles" ON vehicles FOR DELETE TO anon, authenticated USING (true);

-- vehicle_marketplace policies
DROP POLICY IF EXISTS "anon_select_vmp" ON vehicle_marketplace;
CREATE POLICY "anon_select_vmp" ON vehicle_marketplace FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vmp" ON vehicle_marketplace;
CREATE POLICY "anon_insert_vmp" ON vehicle_marketplace FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vmp" ON vehicle_marketplace;
CREATE POLICY "anon_update_vmp" ON vehicle_marketplace FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vmp" ON vehicle_marketplace;
CREATE POLICY "anon_delete_vmp" ON vehicle_marketplace FOR DELETE TO anon, authenticated USING (true);

-- market_fingerprint policies
DROP POLICY IF EXISTS "anon_select_fingerprint" ON market_fingerprint;
CREATE POLICY "anon_select_fingerprint" ON market_fingerprint FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_fingerprint" ON market_fingerprint;
CREATE POLICY "anon_insert_fingerprint" ON market_fingerprint FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_fingerprint" ON market_fingerprint;
CREATE POLICY "anon_update_fingerprint" ON market_fingerprint FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_fingerprint" ON market_fingerprint;
CREATE POLICY "anon_delete_fingerprint" ON market_fingerprint FOR DELETE TO anon, authenticated USING (true);

-- price_history policies
DROP POLICY IF EXISTS "anon_select_price_history" ON price_history;
CREATE POLICY "anon_select_price_history" ON price_history FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_price_history" ON price_history;
CREATE POLICY "anon_insert_price_history" ON price_history FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_price_history" ON price_history;
CREATE POLICY "anon_update_price_history" ON price_history FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_price_history" ON price_history;
CREATE POLICY "anon_delete_price_history" ON price_history FOR DELETE TO anon, authenticated USING (true);

-- listing_history policies
DROP POLICY IF EXISTS "anon_select_listing_history" ON listing_history;
CREATE POLICY "anon_select_listing_history" ON listing_history FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_listing_history" ON listing_history;
CREATE POLICY "anon_insert_listing_history" ON listing_history FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_listing_history" ON listing_history;
CREATE POLICY "anon_update_listing_history" ON listing_history FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_listing_history" ON listing_history;
CREATE POLICY "anon_delete_listing_history" ON listing_history FOR DELETE TO anon, authenticated USING (true);

-- vehicle_status_log policies
DROP POLICY IF EXISTS "anon_select_status_log" ON vehicle_status_log;
CREATE POLICY "anon_select_status_log" ON vehicle_status_log FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_status_log" ON vehicle_status_log;
CREATE POLICY "anon_insert_status_log" ON vehicle_status_log FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_status_log" ON vehicle_status_log;
CREATE POLICY "anon_update_status_log" ON vehicle_status_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_status_log" ON vehicle_status_log;
CREATE POLICY "anon_delete_status_log" ON vehicle_status_log FOR DELETE TO anon, authenticated USING (true);

-- audit_log policies
DROP POLICY IF EXISTS "anon_select_audit_log" ON audit_log;
CREATE POLICY "anon_select_audit_log" ON audit_log FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_audit_log" ON audit_log;
CREATE POLICY "anon_insert_audit_log" ON audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_audit_log" ON audit_log;
CREATE POLICY "anon_update_audit_log" ON audit_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_audit_log" ON audit_log;
CREATE POLICY "anon_delete_audit_log" ON audit_log FOR DELETE TO anon, authenticated USING (true);

-- backups policies
DROP POLICY IF EXISTS "anon_select_backups" ON backups;
CREATE POLICY "anon_select_backups" ON backups FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_backups" ON backups;
CREATE POLICY "anon_insert_backups" ON backups FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_backups" ON backups;
CREATE POLICY "anon_update_backups" ON backups FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_backups" ON backups;
CREATE POLICY "anon_delete_backups" ON backups FOR DELETE TO anon, authenticated USING (true);

-- imports policies
DROP POLICY IF EXISTS "anon_select_imports" ON imports;
CREATE POLICY "anon_select_imports" ON imports FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_imports" ON imports;
CREATE POLICY "anon_insert_imports" ON imports FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_imports" ON imports;
CREATE POLICY "anon_update_imports" ON imports FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_imports" ON imports;
CREATE POLICY "anon_delete_imports" ON imports FOR DELETE TO anon, authenticated USING (true);

-- import_conflicts policies
DROP POLICY IF EXISTS "anon_select_import_conflicts" ON import_conflicts;
CREATE POLICY "anon_select_import_conflicts" ON import_conflicts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_import_conflicts" ON import_conflicts;
CREATE POLICY "anon_insert_import_conflicts" ON import_conflicts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_import_conflicts" ON import_conflicts;
CREATE POLICY "anon_update_import_conflicts" ON import_conflicts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_import_conflicts" ON import_conflicts;
CREATE POLICY "anon_delete_import_conflicts" ON import_conflicts FOR DELETE TO anon, authenticated USING (true);

-- agents policies
DROP POLICY IF EXISTS "anon_select_agents" ON agents;
CREATE POLICY "anon_select_agents" ON agents FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_agents" ON agents;
CREATE POLICY "anon_insert_agents" ON agents FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_agents" ON agents;
CREATE POLICY "anon_update_agents" ON agents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_agents" ON agents;
CREATE POLICY "anon_delete_agents" ON agents FOR DELETE TO anon, authenticated USING (true);

-- jobs policies
DROP POLICY IF EXISTS "anon_select_jobs" ON jobs;
CREATE POLICY "anon_select_jobs" ON jobs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_jobs" ON jobs;
CREATE POLICY "anon_insert_jobs" ON jobs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_jobs" ON jobs;
CREATE POLICY "anon_update_jobs" ON jobs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_jobs" ON jobs;
CREATE POLICY "anon_delete_jobs" ON jobs FOR DELETE TO anon, authenticated USING (true);

-- job_items policies
DROP POLICY IF EXISTS "anon_select_job_items" ON job_items;
CREATE POLICY "anon_select_job_items" ON job_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_job_items" ON job_items;
CREATE POLICY "anon_insert_job_items" ON job_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_job_items" ON job_items;
CREATE POLICY "anon_update_job_items" ON job_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_job_items" ON job_items;
CREATE POLICY "anon_delete_job_items" ON job_items FOR DELETE TO anon, authenticated USING (true);

-- agent_logs policies
DROP POLICY IF EXISTS "anon_select_agent_logs" ON agent_logs;
CREATE POLICY "anon_select_agent_logs" ON agent_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_agent_logs" ON agent_logs;
CREATE POLICY "anon_insert_agent_logs" ON agent_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_agent_logs" ON agent_logs;
CREATE POLICY "anon_update_agent_logs" ON agent_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_agent_logs" ON agent_logs;
CREATE POLICY "anon_delete_agent_logs" ON agent_logs FOR DELETE TO anon, authenticated USING (true);

-- agent_actions policies
DROP POLICY IF EXISTS "anon_select_agent_actions" ON agent_actions;
CREATE POLICY "anon_select_agent_actions" ON agent_actions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_agent_actions" ON agent_actions;
CREATE POLICY "anon_insert_agent_actions" ON agent_actions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_agent_actions" ON agent_actions;
CREATE POLICY "anon_update_agent_actions" ON agent_actions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_agent_actions" ON agent_actions;
CREATE POLICY "anon_delete_agent_actions" ON agent_actions FOR DELETE TO anon, authenticated USING (true);

-- calculator_versions policies
DROP POLICY IF EXISTS "anon_select_calc_versions" ON calculator_versions;
CREATE POLICY "anon_select_calc_versions" ON calculator_versions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_calc_versions" ON calculator_versions;
CREATE POLICY "anon_insert_calc_versions" ON calculator_versions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_calc_versions" ON calculator_versions;
CREATE POLICY "anon_update_calc_versions" ON calculator_versions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_calc_versions" ON calculator_versions;
CREATE POLICY "anon_delete_calc_versions" ON calculator_versions FOR DELETE TO anon, authenticated USING (true);

-- calculations policies
DROP POLICY IF EXISTS "anon_select_calculations" ON calculations;
CREATE POLICY "anon_select_calculations" ON calculations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_calculations" ON calculations;
CREATE POLICY "anon_insert_calculations" ON calculations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_calculations" ON calculations;
CREATE POLICY "anon_update_calculations" ON calculations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_calculations" ON calculations;
CREATE POLICY "anon_delete_calculations" ON calculations FOR DELETE TO anon, authenticated USING (true);

-- images policies
DROP POLICY IF EXISTS "anon_select_images" ON images;
CREATE POLICY "anon_select_images" ON images FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_images" ON images;
CREATE POLICY "anon_insert_images" ON images FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_images" ON images;
CREATE POLICY "anon_update_images" ON images FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_images" ON images;
CREATE POLICY "anon_delete_images" ON images FOR DELETE TO anon, authenticated USING (true);

-- publish_attempts policies
DROP POLICY IF EXISTS "anon_select_publish_attempts" ON publish_attempts;
CREATE POLICY "anon_select_publish_attempts" ON publish_attempts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_publish_attempts" ON publish_attempts;
CREATE POLICY "anon_insert_publish_attempts" ON publish_attempts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_publish_attempts" ON publish_attempts;
CREATE POLICY "anon_update_publish_attempts" ON publish_attempts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_publish_attempts" ON publish_attempts;
CREATE POLICY "anon_delete_publish_attempts" ON publish_attempts FOR DELETE TO anon, authenticated USING (true);

-- saved_filters policies
DROP POLICY IF EXISTS "anon_select_saved_filters" ON saved_filters;
CREATE POLICY "anon_select_saved_filters" ON saved_filters FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_saved_filters" ON saved_filters;
CREATE POLICY "anon_insert_saved_filters" ON saved_filters FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_saved_filters" ON saved_filters;
CREATE POLICY "anon_update_saved_filters" ON saved_filters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_saved_filters" ON saved_filters;
CREATE POLICY "anon_delete_saved_filters" ON saved_filters FOR DELETE TO anon, authenticated USING (true);