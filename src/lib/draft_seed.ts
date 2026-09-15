import type { Vehicle, VehicleMarketplace } from '@/types';
import { composeRoyalCarsDescription, ROYAL_CARS_PUBLISH_DEFAULTS } from '@/lib/company_profile';

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

function firstRaw(raw: Record<string, unknown>, keys: string[]): string {
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  const seen = new Set<unknown>();
  const walk = (value: unknown): string => {
    if (!value || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) { const found = walk(item); if (found) return found; }
      return '';
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (wanted.has(key.toLowerCase())) {
        const text = asText(item).trim();
        if (text) return text;
      }
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = walk(item); if (found) return found;
    }
    return '';
  };
  return walk(raw);
}

function normaliseEuro(value: string): string {
  const match = value.match(/(?:euro|евро)\\s*([1-6][a-z]?)/i);
  return match ? `Euro ${match[1].toLowerCase()}` : value;
}

function detailFallback(raw: Record<string, unknown>) {
  const text = JSON.stringify(raw);
  const pick = (patterns: RegExp[]) => patterns.map(pattern => text.match(pattern)?.[1]?.trim()).find(Boolean) || '';
  return {
    mileage: pick([/(?:mileage|odometer|пробег)[^0-9]{0,20}([0-9][0-9, .]*)/i]),
    gearbox: pick([/(?:transmission|gearbox|скоростна кутия)[^:"]{0,10}[:"]\\s*([^,"}]+)/i]),
    power: pick([/(?:horsepower|power|мощност)[^0-9]{0,20}([0-9][0-9 .]*)/i]),
    displacement: pick([/(?:displacement|engineDisplacement|кубатура|работен обем)[^0-9]{0,20}([0-9][0-9 .]*)/i]),
    euro: pick([/(?:euroStandard|euro_standard|emissionClass|екокатегория)[^:"]{0,10}[:"]\\s*([^,"}]+)/i]),
    color: pick([/(?:color|vehicleColor|exteriorColor|цвят)[^:"]{0,10}[:"]\\s*([^,"}]+)/i]),
  };
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
  const detail = detailFallback(raw);
  const fields: Record<string, string> = {
    category: 'Автомобили и джипове',
    title: `${vehicle.make} ${vehicle.model} ${vehicle.model_year}`,
    make: vehicle.make,
    model: vehicle.model,
    year: asText(vehicle.model_year),
    month: source?.marketplace === 'canada' ? 'Декември' : asText(raw.production_month || raw.month),
    mileage: asText(source?.mileage_km ?? raw.mileage_km) || detail.mileage,
    fuel: vehicle.fuel,
    gearbox: firstRaw(raw, ['gearbox', 'transmission', 'vehicleTransmission']) || detail.gearbox,
    power: firstRaw(raw, ['power_hp', 'power', 'horsepower', 'enginePower']) || detail.power,
    displacement: firstRaw(raw, ['displacement_cc', 'displacement', 'engineDisplacement', 'engineSize']) || detail.displacement,
    euro_standard: normaliseEuro(firstRaw(raw, ['euro_standard', 'euroStandard', 'emissionClass', 'emissions', 'euro']) || detail.euro),
    color: firstRaw(raw, ['color', 'vehicleColor', 'exteriorColor']) || detail.color,
    condition: 'Използван',
    drivetrain: asText(raw.drivetrain),
    vin: asText(source?.vin ?? raw.vin),
    generation: asText(raw.generation),
    facelift: asText(raw.facelift),
    price: asText(salePrice),
    currency: 'EUR',
    our_calculated_price: asText(vehicle.our_price_eur),
    calc_source: sourceLabel,
    location: source?.marketplace === 'canada' ? 'Извън страната → Канада' : source?.marketplace === 'korea' ? 'Извън страната → Южна Корея' : '',
    source_type: sourceLabel,
    source_url: sourceUrl || '',
    source_listing_id: asText(source?.listing_id),
    source_vin: asText(source?.vin),
    source_price: asText(source?.price_native),
    description: composeRoyalCarsDescription(),
    final_description: composeRoyalCarsDescription(),
    ...ROYAL_CARS_PUBLISH_DEFAULTS,
  };

  const fieldSources: Record<string, string> = Object.fromEntries(
    Object.keys(fields).map(key => [key, ['category', 'make', 'model', 'year', 'fuel'].includes(key) ? 'catalog' : (Object.prototype.hasOwnProperty.call(ROYAL_CARS_PUBLISH_DEFAULTS, key) || ['description', 'final_description'].includes(key) ? 'company_profile' : sourceKind)]),
  );

  return {
    catalogPermanentId: vehicle.permanent_id,
    title: `${vehicle.make} ${vehicle.model} ${vehicle.model_year}`,
    sourceUrl,
    fields,
    fieldSources,
  };
}
