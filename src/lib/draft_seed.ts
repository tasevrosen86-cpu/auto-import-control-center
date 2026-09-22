import type { Vehicle, VehicleMarketplace } from '@/types';
import { composeRoyalCarsDescription, ROYAL_CARS_PUBLISH_DEFAULTS } from '@/lib/company_profile';

export interface DraftSeed {
  catalogPermanentId: number;
  title: string;
  sourceUrl: string | null;
  fields: Record<string, string>;
  fieldSources: Record<string, string>;
  images: Array<{ source_url: string; is_main: boolean; display_order: number }>;
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
  const text = value.trim();
  if (/^[1-6][a-z]?$/i.test(text)) return `Euro ${text.toLowerCase()}`;
  const match = text.match(/(?:euro|евро)\s*([1-6][a-z]?)/i);
  return match ? `Euro ${match[1].toLowerCase()}` : text;
}

// f11 is «Категория», and its list is the body style. The catalog stores it as
// «configuration» in its own wording («Голям 7-местен SUV»), while the URL
// importer sends the internal vocabulary. Both are resolved here so the two
// flows reach the publisher as the same field, and an unknown style stays empty
// rather than guessing a category.
function normaliseBody(value: string): string {
  const source = value.trim().toLowerCase();
  if (!source) return '';
  if (source.includes('кабрио') || source.includes('convertible') || source.includes('cabriolet')) return 'convertible';
  if (source.includes('пикап') || source.includes('pickup') || source.includes('pick-up') || source.includes('truck')) return 'pickup';
  if (source.includes('хечбек') || source.includes('hatchback') || source.includes('hatch')) return 'hatchback';
  if (source.includes('комби') || source.includes('wagon') || source.includes('estate') || source.includes('avant')) return 'wagon';
  if (source.includes('купе') || source.includes('coupe')) return 'coupe';
  if (source.includes('седан') || source.includes('sedan') || source.includes('saloon')) return 'sedan';
  if (source.includes('ван') || source.includes('van')) return 'van';
  if (source.includes('suv') || source.includes('джип') || source.includes('crossover') || source.includes('sport utility') || source.includes('utility vehicle')) return 'large_suv';
  return '';
}

function imageSeed(raw: Record<string, unknown>) {
  const urls = new Set<string>();
  const keys = new Set(['image','images','photo','photos','imageUrl','imageUrls','photoUrl','photoUrls','contentUrl','original','large']);
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(walk); return; }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key) || keys.has(key.toLowerCase())) {
        const values = Array.isArray(item) ? item : [item];
        for (const candidate of values) {
          const text = asText(candidate).trim();
          const record = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
          for (const url of [text, asText(record.url), asText(record.contentUrl), asText(record.original), asText(record.large)]) {
            if (/^https?:\/\//i.test(url) && (/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) || /(?:image|photo|carimg|encar|autotrader|cdn)/i.test(url))) urls.add(url);
          }
        }
      }
      walk(item);
    }
  };
  walk(raw);
  return [...urls].slice(0, 40).map((source_url, index) => ({ source_url, is_main: index === 0, display_order: index + 1 }));
}

function detailFallback(raw: Record<string, unknown>) {
  const text = JSON.stringify(raw);
  const pick = (patterns: RegExp[]) => patterns.map(pattern => text.match(pattern)?.[1]?.trim()).find(Boolean) || '';
  return {
    mileage: pick([/(?:mileage|odometer|пробег)[a-z_]*"?\s*:\s*"?([0-9][0-9, .]*)/i]),
    gearbox: pick([/(?:transmission|gearbox|скоростна кутия)[^:"]{0,10}[:"]\s*([^,"}]+)/i]),
    power: pick([/(?:horsepower|power|мощност)[^0-9]{0,20}([0-9][0-9 .]*)/i]),
    displacement: pick([/(?:displacement|engineDisplacement|кубатура|работен обем)[^0-9]{0,20}([0-9][0-9 .]*)/i]),
    euro: pick([/(?:euroStandard|euro_standard|emissionClass|екокатегория)[^:"]{0,10}[:"]\s*([^,"}]+)/i]),
    color: pick([/(?:colou?r|vehicleColor|exteriorColor|bodyColor|цвят)[^:"]{0,10}[:"]\s*([^,"}]+)/i]),
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
  // "Заглавие" must carry the original listing title when the source supplied
  // one; only fall back to make/model/year when it did not.
  const sourceTitle = firstRaw(raw, ['title', 'listing_title', 'ad_title', 'offer_title', 'offerTitle']);
  const fields: Record<string, string> = {
    category: 'Автомобили и джипове',
    title: sourceTitle || `${vehicle.make} ${vehicle.model} ${vehicle.model_year}`,
    make: vehicle.make,
    model: vehicle.model,
    year: asText(vehicle.model_year),
    month: source?.marketplace === 'canada' ? 'Април' : asText(raw.production_month || raw.month),
    mileage: asText(source?.mileage_km ?? raw.mileage_km) || detail.mileage,
    fuel: vehicle.fuel,
    gearbox: firstRaw(raw, ['gearbox', 'transmission', 'vehicleTransmission']) || detail.gearbox,
    power: firstRaw(raw, ['power_hp', 'power', 'horsepower', 'enginePower']) || detail.power,
    displacement: firstRaw(raw, ['displacement_cc', 'displacement', 'engineDisplacement', 'engineSize']) || detail.displacement,
    euro_standard: normaliseEuro(firstRaw(raw, ['euro_standard', 'euroStandard', 'emissionClass', 'emissions', 'euro']) || detail.euro),
    color: firstRaw(raw, ['color', 'vehicleColor', 'exteriorColor', 'bodyColor', 'colour']) || detail.color,
    condition: 'Използван',
    // The catalog path carries the body style in `configuration`; the URL import
    // path already normalised it into raw_json. Both land here as `body`, the
    // key f11 is selected by, so the red Korea and blue Canada buttons need no
    // extra page opened and no listing link.
    body: normaliseBody(source?.configuration || firstRaw(raw, ['body_type', 'bodyType', 'body_style', 'bodyStyle', 'configuration', 'vehicleConfiguration', 'body'])),
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
    Object.keys(fields).map(key => [key, ['category', 'make', 'model', 'year', 'fuel', 'body'].includes(key) ? 'catalog' : (Object.prototype.hasOwnProperty.call(ROYAL_CARS_PUBLISH_DEFAULTS, key) || ['description', 'final_description'].includes(key) ? 'company_profile' : sourceKind)]),
  );

  return {
    catalogPermanentId: vehicle.permanent_id,
    title: `${vehicle.make} ${vehicle.model} ${vehicle.model_year}`,
    sourceUrl,
    fields,
    fieldSources,
    images: imageSeed(raw),
  };
}
