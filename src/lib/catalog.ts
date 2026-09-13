import part1 from '@/data/master_catalog_v40_part_01_of_03.json';
import part2 from '@/data/master_catalog_v40_part_02_of_03.json';
import part3 from '@/data/master_catalog_v40_part_03_of_03.json';
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

function mapRecord(rec: CatalogRecord): VehicleWithMarketplace {
  const marketplaces: VehicleMarketplace[] = [];
  if (rec.korea) marketplaces.push(mapMarketplace('korea', rec));
  if (rec.canada) marketplaces.push(mapMarketplace('canada', rec));
  if (rec.mobile_bg) marketplaces.push(mapMarketplace('mobile_bg', rec));

  return {
    permanent_id: rec.permanent_id,
    stable_key: rec.stable_key,
    make: rec.make,
    model: rec.model,
    model_year: rec.model_year,
    fuel: rec.fuel,
    priority: rec.priority,
    status: rec.status,
    our_price_eur: rec.our_price_eur,
    notes: rec.notes,
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

const allParts = [part1, part2, part3] as unknown as { catalog: CatalogRecord[] }[];

const rawRecords: CatalogRecord[] = allParts.flatMap((p) => p.catalog);

export const catalogRecords: VehicleWithMarketplace[] = rawRecords.map(mapRecord);

export const catalogSorted: VehicleWithMarketplace[] = [...catalogRecords].sort((a, b) => {
  const fr = fuelRank(a.fuel) - fuelRank(b.fuel);
  if (fr !== 0) return fr;
  const mk = a.make.localeCompare(b.make, 'bg');
  if (mk !== 0) return mk;
  const md = a.model.localeCompare(b.model, 'bg');
  if (md !== 0) return md;
  return b.model_year - a.model_year;
});

export const catalogStats = {
  total: catalogSorted.length,
  active: catalogSorted.filter((v) => v.status === 'ACTIVE').length,
  review: catalogSorted.filter((v) => v.flags_needs_review).length,
  noValid: catalogSorted.filter((v) => v.status === 'NO_VALID_REPLACEMENT').length,
  publishedBg: catalogSorted.filter((v) =>
    v.vehicle_marketplace.some((m) => m.marketplace === 'mobile_bg' && m.publication_status === 'PUBLISHED'),
  ).length,
};

export const catalogFilterOptions = {
  makes: Array.from(new Set(catalogSorted.map((v) => v.make))).sort((a, b) => a.localeCompare(b, 'bg')),
  fuels: Array.from(new Set(catalogSorted.map((v) => v.fuel))).sort((a, b) => fuelRank(a) - fuelRank(b)),
  models: Array.from(new Set(catalogSorted.map((v) => v.model))).sort((a, b) => a.localeCompare(b, 'bg')),
};

export function getCatalogModelsForMake(make: string): string[] {
  return Array.from(
    new Set(catalogSorted.filter((v) => v.make === make).map((v) => v.model)),
  ).sort((a, b) => a.localeCompare(b, 'bg'));
}

export function filterCatalog(opts: {
  make: string;
  model: string;
  fuel: string;
  yearFrom: string;
  yearTo: string;
}): VehicleWithMarketplace[] {
  return catalogSorted.filter((v) => {
    if (opts.make !== 'ALL' && v.make !== opts.make) return false;
    if (opts.model !== 'ALL' && v.model !== opts.model) return false;
    if (opts.fuel !== 'ALL' && v.fuel !== opts.fuel) return false;
    if (opts.yearFrom !== 'ALL' && v.model_year < Number(opts.yearFrom)) return false;
    if (opts.yearTo !== 'ALL' && v.model_year > Number(opts.yearTo)) return false;
    return true;
  });
}
