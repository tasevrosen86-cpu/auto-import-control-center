import type { Vehicle, VehicleMarketplace } from '@/types';

export interface DraftSeed {
  catalogPermanentId: number;
  title: string;
  sourceUrl: string | null;
  fields: Record<string, string>;
  fieldSources: Record<string, string>;
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export type ImportMarketplace = 'korea' | 'canada';

function chooseSource(marketplaces: VehicleMarketplace[], preferred?: ImportMarketplace): VehicleMarketplace | null {
  const importSources = marketplaces.filter(m =>
    (m.marketplace === 'korea' || m.marketplace === 'canada') && m.listing_url && (!preferred || m.marketplace === preferred),
  );
  return [...importSources].sort((a, b) => (a.final_eur ?? Number.MAX_SAFE_INTEGER) - (b.final_eur ?? Number.MAX_SAFE_INTEGER))[0] || null;
}

export function createDraftSeed(vehicle: Vehicle, marketplaces: VehicleMarketplace[], preferred?: ImportMarketplace): DraftSeed {
  const source = chooseSource(marketplaces, preferred);
  const raw = vehicle.raw_json as Record<string, unknown>;
  const sourceKind = source?.marketplace === 'korea' ? 'encar' : source?.marketplace === 'canada' ? 'autotrader' : 'catalog';
  const sourceLabel = source?.marketplace === 'korea' ? 'Encar' : source?.marketplace === 'canada' ? 'AutoTrader' : 'Каталог';
  const salePrice = vehicle.our_price_eur ?? source?.final_eur ?? null;
  const sourceUrl = source?.listing_url || null;
  const fields: Record<string, string> = {
    category: 'Автомобили и джипове',
    make: vehicle.make,
    model: vehicle.model,
    year: asText(vehicle.model_year),
    mileage: asText(source?.mileage_km ?? raw.mileage_km),
    fuel: vehicle.fuel,
    gearbox: asText(raw.gearbox),
    power: asText(raw.power_hp ?? raw.power),
    displacement: asText(raw.displacement_cc),
    color: asText(raw.color),
    condition: 'Използван',
    drivetrain: asText(raw.drivetrain),
    vin: asText(source?.vin ?? raw.vin),
    generation: asText(raw.generation),
    facelift: asText(raw.facelift),
    price: asText(salePrice),
    currency: 'EUR',
    our_calculated_price: asText(vehicle.our_price_eur),
    calc_source: sourceLabel,
    source_type: sourceLabel,
    source_url: sourceUrl || '',
    source_listing_id: asText(source?.listing_id),
    source_vin: asText(source?.vin),
    source_price: asText(source?.final_eur),
  };

  const fieldSources: Record<string, string> = Object.fromEntries(
    Object.keys(fields).map(key => [key, ['category', 'make', 'model', 'year', 'fuel'].includes(key) ? 'catalog' : sourceKind]),
  );

  return {
    catalogPermanentId: vehicle.permanent_id,
    title: `${vehicle.make} ${vehicle.model} ${vehicle.model_year}`,
    sourceUrl,
    fields,
    fieldSources,
  };
}
