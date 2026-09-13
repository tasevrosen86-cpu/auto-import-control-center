export type Marketplace = 'korea' | 'canada' | 'mobile_bg';

export type AppMode = 'admin' | 'broker';

export type VehicleStatus =
  | 'ACTIVE'
  | 'UNCHANGED'
  | 'CHANGED'
  | 'NEEDS_RECALCULATION'
  | 'NEEDS_PUBLISHING'
  | 'NO_VALID_REPLACEMENT'
  | 'SOLD'
  | 'PAUSED'
  | 'NEEDS_HUMAN_REVIEW'
  | 'INACTIVE'
  | 'REVIEW';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ImportMode = 'dry_run' | 'test' | 'full';

export interface Vehicle {
  permanent_id: number;
  stable_key: string;
  make: string;
  model: string;
  model_year: number;
  fuel: string;
  priority: number;
  status: string;
  our_price_eur: number | null;
  notes: string | null;
  flags_needs_review: boolean;
  flags_reasons: string[];
  raw_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_import_at: string | null;
  import_source: string | null;
  deleted_at: string | null;
}

export interface VehicleMarketplace {
  id: number;
  vehicle_id: number;
  marketplace: Marketplace;
  filter_url: string | null;
  listing_url: string | null;
  listing_id: string | null;
  price_native: number | null;
  price_currency: string | null;
  final_eur: number | null;
  mileage_km: number | null;
  vin: string | null;
  configuration: string | null;
  last_check: string | null;
  source_status: string | null;
  our_price_eur: number | null;
  our_listing_url: string | null;
  publication_status: string | null;
  market_status: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: number;
  vehicle_id: number;
  marketplace: string;
  listing_id: string | null;
  old_price: number | null;
  new_price: number | null;
  currency: string | null;
  change_type: string;
  reason: string | null;
  source: string;
  changed_at: string;
}

export interface ListingHistory {
  id: number;
  vehicle_id: number;
  marketplace: string;
  listing_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface VehicleStatusLog {
  id: number;
  vehicle_id: number;
  old_status: string | null;
  new_status: string;
  reason: string | null;
  actor: string;
  created_at: string;
}

export interface Job {
  job_id: number;
  job_type: string;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  parameters: Record<string, unknown>;
  max_items: number | null;
  progress: number;
  success_count: number;
  failed_count: number;
  error_info: Record<string, unknown> | null;
}

export interface ImportRecord {
  id: number;
  label: string;
  mode: ImportMode;
  source_path: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  files: unknown[];
  total_records: number;
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
  backup_id: number | null;
  error_info: Record<string, unknown> | null;
}

export interface ImportConflict {
  id: number;
  import_id: number;
  permanent_id: number | null;
  stable_key: string | null;
  conflict_type: string;
  details: Record<string, unknown>;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface ImageRecord {
  id: number;
  vehicle_id: number;
  marketplace: string | null;
  source_url: string;
  local_path: string | null;
  converted_jpg: boolean;
  size_bytes: number | null;
  status: string;
  created_at: string;
}

export interface ClientSearch {
  id: number;
  broker_name: string | null;
  client_name: string | null;
  make: string;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  fuel: string | null;
  found_vehicle_id: number | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
}

export interface Sale {
  id: number;
  vehicle_id: number;
  marketplace: string;
  sale_price_eur: number;
  buyer_name: string | null;
  sale_date: string;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export interface VehicleWithMarketplace extends Vehicle {
  vehicle_marketplace: VehicleMarketplace[];
}

// === Mobile.bg Draft System ===

export interface MobileBgDraft {
  id: string;
  company_id: string;
  catalog_permanent_id: number | null;
  title: string | null;
  status: string;
  source_type: string;
  source_url: string | null;
  source_listing_id: string | null;
  source_vin: string | null;
  source_price_eur: number | null;
  mobile_bg_url: string | null;
  mobile_bg_listing_id: string | null;
  dedup_hash: string | null;
  broker_name: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  published_at: string | null;
  last_checked_at: string | null;
  publish_error: string | null;
}

export interface MobileBgDraftField {
  id: string;
  draft_id: string;
  field_key: string;
  mobile_bg_label: string;
  our_db_key: string;
  value: string | null;
  field_type: string;
  source: string;
  proof: string | null;
  validation_status: string;
  filled_at: string | null;
  is_manual_edit: boolean;
  created_at: string;
  updated_at: string;
}

export interface MobileBgDraftExtra {
  id: string;
  draft_id: string;
  extra_key: string;
  mobile_bg_label: string;
  group_name: string;
  selected: boolean;
  proof: string | null;
  source: string;
  created_at: string;
}

export interface MobileBgDraftImage {
  id: string;
  draft_id: string;
  source_url: string | null;
  local_path: string | null;
  converted_jpg: boolean;
  is_selected: boolean;
  is_main: boolean;
  display_order: number;
  real_car_photo_check: boolean;
  processing_status: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface MobileBgDraftActionLog {
  id: string;
  draft_id: string | null;
  action: string;
  actor: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface MobileBgDedupCheck {
  id: string;
  draft_id: string;
  check_type: string;
  matched_draft_id: string | null;
  matched_mobile_bg_url: string | null;
  matched_broker_name: string | null;
  matched_date: string | null;
  is_duplicate: boolean;
  resolved: boolean;
  resolved_by: string | null;
  resolved_reason: string | null;
  created_at: string;
}
