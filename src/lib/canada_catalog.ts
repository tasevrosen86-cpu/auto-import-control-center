import canadaCatalog from '@/data/canada_catalog_v45.json';

export type ComparisonKind = 'canada_cheaper' | 'no_comparison' | 'plain';

export interface CanadaCatalogRow {
  position: number;
  make: string;
  model: string;
  model_year: number;
  fuel: string;
  canada_listing_url: string | null;
  canada_filter_url: string | null;
  price_cad: number | null;
  final_eur: number | null;
  comparison: ComparisonKind;
  bg_filter_url: string | null;
  bg_listing_url: string | null;
  bg_price_eur: number | null;
  bg_found: boolean;
  published: boolean;
}

export const canadaCatalogRows: CanadaCatalogRow[] = (canadaCatalog as { rows: CanadaCatalogRow[] }).rows;

export const canadaCatalogMeta = (canadaCatalog as { meta: { version: string; title: string; generated_at: string; total_rows: number } }).meta;

const FUEL_ORDER = ['Бензин', 'Дизел', 'Хибрид', 'Електрически', 'Газ (LPG)'];
function fuelRank(fuel: string): number {
  return FUEL_ORDER.indexOf(fuel) < 0 ? 99 : FUEL_ORDER.indexOf(fuel);
}

export const canadaCatalogStats = {
  total: canadaCatalogRows.length,
  withCanadaPrice: canadaCatalogRows.filter(r => r.price_cad !== null).length,
  canadaCheaper: canadaCatalogRows.filter(r => r.comparison === 'canada_cheaper').length,
  noComparison: canadaCatalogRows.filter(r => r.comparison === 'no_comparison').length,
  withBgPrice: canadaCatalogRows.filter(r => r.bg_price_eur !== null).length,
  published: canadaCatalogRows.filter(r => r.published).length,
};

export const canadaCatalogFilterOptions = {
  makes: Array.from(new Set(canadaCatalogRows.map(r => r.make))).sort((a, b) => a.localeCompare(b, 'bg')),
  models: Array.from(new Set(canadaCatalogRows.map(r => r.model))).sort((a, b) => a.localeCompare(b, 'bg')),
  fuels: Array.from(new Set(canadaCatalogRows.map(r => r.fuel))).sort((a, b) => fuelRank(a) - fuelRank(b)),
  years: Array.from(new Set(canadaCatalogRows.map(r => r.model_year))).sort((a, b) => b - a),
};

export function getCanadaCatalogModelsForMake(make: string): string[] {
  return Array.from(
    new Set(canadaCatalogRows.filter(r => r.make === make).map(r => r.model)),
  ).sort((a, b) => a.localeCompare(b, 'bg'));
}

export function filterCanadaCatalog(opts: {
  make: string;
  model: string;
  fuel: string;
  yearFrom: string;
  yearTo: string;
  comparison: string;
}): CanadaCatalogRow[] {
  return canadaCatalogRows.filter((r) => {
    if (opts.make !== 'ALL' && r.make !== opts.make) return false;
    if (opts.model !== 'ALL' && r.model !== opts.model) return false;
    if (opts.fuel !== 'ALL' && r.fuel !== opts.fuel) return false;
    if (opts.yearFrom !== 'ALL' && r.model_year < Number(opts.yearFrom)) return false;
    if (opts.yearTo !== 'ALL' && r.model_year > Number(opts.yearTo)) return false;
    if (opts.comparison !== 'ALL' && r.comparison !== opts.comparison) return false;
    return true;
  });
}
