import { supabase } from '@/lib/supabase';
import type { VehicleWithMarketplace, VehicleMarketplace, Marketplace } from '@/types';

interface CatalogRecord {
  permanent_id: number;
  stable_key: string;
  make: string;
  model: string;
  model_year: number;
  fuel: string;
  priority: number;
  status: string;
  our_price_eur: number | null;
  korea: MarketSource | null;
  canada: MarketSource | null;
  mobile_bg: BgSource | null;
  calculations: Calculations | null;
  fingerprint: Fingerprint | null;
  history: unknown[];
  notes: string | null;
  flags: { needs_human_review: boolean; reasons: string[] };
}

interface MarketSource {
  filter_url: string | null;
  listing_url: string | null;
  listing_id: string | null;
  price_krw?: number | null;
  price_cad?: number | null;
  final_eur: number | null;
  mileage_km: number | null;
  vin: string | null;
  configuration: string | null;
  last_check: string | null;
  status: string;
}

interface BgSource {
  filter_url: string | null;
  listing_url: string | null;
  listing_id: string | null;
  price_eur: number | null;
  our_price_eur: number | null;
  our_listing_url: string | null;
  publication_status: string;
  market_status: string;
}

interface Calculations {
  korea_final_eur: number | null;
  canada_final_eur: number | null;
  cheaper_source: string | null;
  diff_eur: number | null;
  calculated_at: string | null;
  calculator_version: string | null;
}

interface Fingerprint {
  primary: {
    source: string;
    listing_id: string;
    vin: string | null;
    url: string;
    price: number;
    mileage: number | null;
    year: number;
    configuration: string | null;
  } | null;
  secondary: {
    source: string;
    listing_id: string;
    vin: string | null;
    url: string;
    price: number;
    mileage: number | null;
    year: number;
    configuration: string | null;
  } | null;
}

const FUEL_ORDER: Record<string, number> = {
  'Бензин': 1,
  'Дизел': 2,
  'Хибрид': 3,
  'Електрически': 4,
  'Газ (LPG)': 5,
};

function fuelRank(fuel: string): number {
  return FUEL_ORDER[fuel] ?? 99;
}

export interface CatalogDataset {
  records: VehicleWithMarketplace[];
  sorted: VehicleWithMarketplace[];
  stats: { total: number; active: number; review: number; noValid: number; publishedBg: number };
  filterOptions: { makes: string[]; fuels: string[]; models: string[] };
  years: number[];
}

function buildDataset(records: VehicleWithMarketplace[]): CatalogDataset {
  const sorted = [...records].sort((a, b) => {
    const fr = fuelRank(a.fuel) - fuelRank(b.fuel);
    if (fr !== 0) return fr;
    const mk = a.make.localeCompare(b.make, 'bg');
    if (mk !== 0) return mk;
    const md = a.model.localeCompare(b.model, 'bg');
    if (md !== 0) return md;
    return b.model_year - a.model_year;
  });

  return {
    records,
    sorted,
    stats: {
      total: sorted.length,
      active: sorted.filter((v) => v.status === 'ACTIVE').length,
      review: sorted.filter((v) => v.flags_needs_review).length,
      noValid: sorted.filter((v) => v.status === 'NO_VALID_REPLACEMENT').length,
      publishedBg: sorted.filter((v) =>
        v.vehicle_marketplace.some((m) => m.marketplace === 'mobile_bg' && m.publication_status === 'PUBLISHED'),
      ).length,
    },
    filterOptions: {
      makes: Array.from(new Set(sorted.map((v) => v.make))).sort((a, b) => a.localeCompare(b, 'bg')),
      fuels: Array.from(new Set(sorted.map((v) => v.fuel))).sort((a, b) => fuelRank(a) - fuelRank(b)),
      models: Array.from(new Set(sorted.map((v) => v.model))).sort((a, b) => a.localeCompare(b, 'bg')),
    },
    years: Array.from(new Set(sorted.map((v) => v.model_year))).sort((a, b) => b - a),
  };
}

/**
 * Reads the internal Cars Catalog from the database.
 *
 * It used to be a 12 MB JSON file imported by this module, which meant every
 * visitor downloaded all 4674 rows in the JavaScript bundle and the only thing
 * hiding it from a company was a menu entry that was not rendered. The table it
 * now comes from carries a policy that returns rows only to a system
 * administrator, so a broker or a company admin who asks the API directly is
 * given nothing. Reading a car for a draft a broker owns goes through
 * `master_catalog_card`, which is a separate and much narrower question.
 *
 * The rows are returned by the database in the shape the rest of the module
 * already worked with, so the mapping below is unchanged.
 */
export async function loadCatalog(): Promise<CatalogDataset> {
  const { data, error } = await supabase
    .from('master_catalog')
    .select('permanent_id, stable_key, make, model, model_year, fuel, priority, status, company_status, our_price_eur, payload')
    .order('make', { ascending: true });

  if (error) throw new Error(error.message);

  const records = ((data || []) as MasterCatalogRow[]).map((row) => mapRecord(row));
  return buildDataset(records);
}

export function getCatalogModelsForMake(dataset: CatalogDataset, make: string): string[] {
  return Array.from(
    new Set(dataset.sorted.filter((v) => v.make === make).map((v) => v.model)),
  ).sort((a, b) => a.localeCompare(b, 'bg'));
}

export function filterCatalog(dataset: CatalogDataset, opts: {
  make: string;
  model: string;
  fuel: string;
  yearFrom: string;
  yearTo: string;
}): VehicleWithMarketplace[] {
  return dataset.sorted.filter((v) => {
    if (opts.make !== 'ALL' && v.make !== opts.make) return false;
    if (opts.model !== 'ALL' && v.model !== opts.model) return false;
    if (opts.fuel !== 'ALL' && v.fuel !== opts.fuel) return false;
    if (opts.yearFrom !== 'ALL' && v.model_year < Number(opts.yearFrom)) return false;
    if (opts.yearTo !== 'ALL' && v.model_year > Number(opts.yearTo)) return false;
    return true;
  });
}

function mapMarketplace(
  mp: Marketplace,
  rec: CatalogRecord,
): VehicleMarketplace {
  const src = mp === 'korea' ? rec.korea : mp === 'canada' ? rec.canada : rec.mobile_bg;
  const isBg = mp === 'mobile_bg';

  const priceNative = isBg
    ? (rec.mobile_bg?.price_eur ?? null)
    : mp === 'korea'
      ? (rec.korea?.price_krw ?? null)
      : (rec.canada?.price_cad ?? null);

  const currency = isBg ? 'EUR' : mp === 'korea' ? 'KRW' : 'CAD';

  return {
    id: rec.permanent_id * 10 + (mp === 'korea' ? 1 : mp === 'canada' ? 2 : 3),
    vehicle_id: rec.permanent_id,
    marketplace: mp,
    filter_url: src?.filter_url ?? null,
    listing_url: src?.listing_url ?? null,
    listing_id: src?.listing_id ?? null,
    price_native: priceNative,
    price_currency: currency,
    final_eur: isBg ? (rec.mobile_bg?.price_eur ?? null) : (src as MarketSource | null)?.final_eur ?? null,
    mileage_km: isBg ? null : (src as MarketSource | null)?.mileage_km ?? null,
    vin: isBg ? null : (src as MarketSource | null)?.vin ?? null,
    configuration: isBg ? null : (src as MarketSource | null)?.configuration ?? null,
    last_check: isBg ? null : (src as MarketSource | null)?.last_check ?? null,
    source_status: isBg ? null : (src as MarketSource | null)?.status ?? null,
    our_price_eur: isBg ? (rec.mobile_bg?.our_price_eur ?? null) : null,
    our_listing_url: isBg ? (rec.mobile_bg?.our_listing_url ?? null) : null,
    publication_status: isBg ? (rec.mobile_bg?.publication_status ?? null) : null,
    market_status: isBg ? (rec.mobile_bg?.market_status ?? null) : null,
    extra: {},
    created_at: '2026-09-12T16:57:17Z',
    updated_at: '2026-09-12T16:57:17Z',
  };
}

interface MasterCatalogRow {
  permanent_id: number;
  stable_key: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  fuel: string | null;
  priority: number | null;
  status: string | null;
  company_status: string | null;
  our_price_eur: number | null;
  payload: Record<string, unknown> | null;
}

function mapRecord(row: MasterCatalogRow): VehicleWithMarketplace {
  // The row keeps the whole original catalogue record in `payload`, so the
  // per-marketplace detail is read from there and the columns are the filterable
  // summary the table exposes.
  const rec = (row.payload || {}) as unknown as CatalogRecord;

  const marketplaces: VehicleWithMarketplace['vehicle_marketplace'] = [];
  if (rec.korea) marketplaces.push(mapMarketplace('korea', rec));
  if (rec.canada) marketplaces.push(mapMarketplace('canada', rec));
  if (rec.mobile_bg) marketplaces.push(mapMarketplace('mobile_bg', rec));

  return {
    permanent_id: row.permanent_id,
    stable_key: row.stable_key ?? rec.stable_key ?? '',
    make: row.make ?? rec.make ?? '',
    model: row.model ?? rec.model ?? '',
    model_year: row.model_year ?? rec.model_year ?? 0,
    fuel: row.fuel ?? rec.fuel ?? '',
    priority: row.priority ?? rec.priority ?? 0,
    status: (row.company_status || row.status || rec.status || 'ACTIVE') as VehicleWithMarketplace['status'],
    our_price_eur: row.our_price_eur ?? rec.our_price_eur ?? null,
    notes: rec.notes ?? null,
    flags_needs_review: rec.flags?.needs_human_review ?? false,
    flags_reasons: rec.flags?.reasons ?? [],
    raw_json: rec as unknown as Record<string, unknown>,
    created_at: '2026-09-12T16:57:17Z',
    updated_at: '2026-09-12T16:57:17Z',
    last_import_at: '2026-09-12T16:57:17Z',
    import_source: 'Cars Catalog v40.html',
    deleted_at: null,
    vehicle_marketplace: marketplaces,
  };
}
