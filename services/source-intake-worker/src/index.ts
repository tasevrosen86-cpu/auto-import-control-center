import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

type SourceJob = { id: string; draft_id: string; source_type: 'encar' | 'autotrader_ca' | 'other'; source_url: string; attempt_count: number };
type JsonRecord = Record<string, unknown>;

for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[name]) throw new Error(`Липсва ${name}.`);
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ingestUrl = process.env.SOURCE_INGEST_URL || `${process.env.SUPABASE_URL}/functions/v1/ingest-source-listing`;
const workerName = process.env.WORKER_NAME || `source-intake-${process.pid}`;
const companyDescription = `RoyalCarsBG професионален внос на проверени автомобили от САЩ и Канада

Специализираме в директния внос на автомобили от САЩ, Канада и Южна Корея, като залагаме на качество, прозрачност и сигурност при всяка сделка. Работим само с внимателно подбрани автомобили и надеждни партньори, за да гарантираме реалното състояние и произход на всяка кола.

Към всеки автомобил предоставяме:
- Пълна сервизна история чрез Carfax / AutoCheck
- Допълнителни снимки и видео на автомобила
- Подробна проверка за удари и техническо състояние

Какво получавате с RoyalCarsBG:
- Финансиране възможно и без първоначална вноска
- Сигурен и прозрачен авто внос без скрити такси
- Автомобили от официални представителства и доверени дилъри
- Личен консултант от избора на автомобила до регистрацията
- Пълно съдействие с транспорт, мита, документи, технотест, миграция на мигачи и регистрация
- Съдействие при издаване на ГО и Каско
- Срок за доставка: от 2 до 3 месеца
- Ясни условия и коректно отношение

При нас няма скрити комисионни или неясни условия. Всички разходи се уточняват предварително, за да знаете точно какво получавате и на каква цена.

Свържете се с нас на 0887353653 за повече информация или конкретно запитване за автомобила.`;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}
function scalar(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim() || null;
  return null;
}
function addJson(value: unknown, output: JsonRecord[]) {
  if (Array.isArray(value)) return value.forEach(item => addJson(item, output));
  const record = asRecord(value);
  if (Object.keys(record).length) output.push(record);
}
async function pageJson(page: Page): Promise<JsonRecord[]> {
  const scripts = await page.locator('script').evaluateAll(nodes => nodes.map(node => ({
    type: node.getAttribute('type') || '', id: node.id || '', text: node.textContent || '',
  })));
  const parsed: JsonRecord[] = [];
  for (const script of scripts) {
    const type = script.type.toLowerCase();
    if (!(type.includes('json') || script.id === '__NEXT_DATA__' || script.id.includes('STATE'))) continue;
    try { addJson(JSON.parse(script.text), parsed); } catch { /* non-JSON script */ }
  }
  return parsed;
}
function walk(value: unknown, callback: (record: JsonRecord) => void, seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) return value.forEach(item => walk(item, callback, seen));
  const record = value as JsonRecord;
  callback(record);
  Object.values(record).forEach(item => walk(item, callback, seen));
}
function typeText(record: JsonRecord) {
  const type = record['@type'];
  return Array.isArray(type) ? type.map(String).join(' ').toLowerCase() : String(type || '').toLowerCase();
}
function vehicleRecord(documents: JsonRecord[]): JsonRecord {
  const candidates: Array<{ record: JsonRecord; score: number }> = [];
  documents.forEach(document => walk(document, record => {
    const type = typeText(record);
    const score =
      (type.includes('vehicle') ? 100 : 0) +
      ('brand' in record ? 12 : 0) +
      ('vehicleModelDate' in record ? 12 : 0) +
      ('mileageFromOdometer' in record ? 12 : 0) +
      ('fuelType' in record ? 8 : 0) +
      ('offers' in record ? 8 : 0);
    if (score) candidates.push({ record, score });
  }));
  return candidates.sort((a, b) => b.score - a.score)[0]?.record || documents[0] || {};
}
// AutoTrader renders structured listing data under props.pageProps.listingDetails
// rather than in the JSON-LD block that vehicleRecord() selects. That block is
// the only place modelYear, fuelCategory and mileageInKmRaw appear, so walk the
// whole page for the object carrying those keys.
const AUTOTRADER_DETAIL_KEYS = [
  'mileageInKmRaw', 'fuelCategory', 'modelYear', 'modelVersionInput',
  'transmissionType', 'bodyColor', 'numberOfSeats', 'bodyType',
];

function autotraderVehicle(documents: JsonRecord[]): JsonRecord {
  let best: JsonRecord = {};
  let bestScore = 0;
  documents.forEach(document => walk(document, record => {
    const score = AUTOTRADER_DETAIL_KEYS.filter(key => key in record).length;
    if (score > bestScore) { bestScore = score; best = record; }
  }));
  return best;
}
// AutoTrader publishes the listing headline as the last breadcrumb entry, which
// repeats in both the JSON-LD itemListElement and the Next.js breadcrumbs array.
// Both are used as independent confirmations; generic navigation labels and bare
// taxonomy terms (make/model) are skipped so the headline itself is what remains.
// AutoTrader keeps the trim in the Next.js listing payload rather than JSON-LD:
// modelVersionInput holds the dealer-written trim ("Progressiv * CARPLAY / ...")
// and variant the body style ("Sportback"). Mobile.bg shows this as Модификация.
function autotraderModification(documents: JsonRecord[]): { value: string | null; from: string } {
  const vehicle = autotraderVehicle(documents);
  return withSource([
    ['listingDetails.vehicle.modelVersionInput', scalar(vehicle.modelVersionInput)],
    ['listingDetails.vehicle.variant', scalar(vehicle.variant)],
    ['listingDetails.vehicle.modelVersionCustom', scalar(vehicle.modelVersionCustom)],
  ]);
}

const GENERIC_TITLE = /^(?:home|search|shared\.home|shared\.search_noun)$/i;

function listingTitleFromBreadcrumbs(documents: JsonRecord[]): string | null {
  const names: string[] = [];
  documents.forEach(document => walk(document, record => {
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'breadcrumbs' && key !== 'itemListElement') continue;
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const name = scalar(asRecord(item).name);
        if (name) names.push(name.replace(/\s+/g, ' ').trim());
      }
    }
  }));
  const meaningful = names.filter(name => name.length >= 8 && !GENERIC_TITLE.test(name));
  return meaningful[meaningful.length - 1] || null;
}

function normalizeTitle(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length >= 4 ? text.slice(0, 200) : null;
}

// The same car photo is served at several sizes (1280x960, 720x540 ...). Group by
// photo identity so each car photo yields exactly one draft image, keeping the
// largest variant. Distinct photos stay distinct.
function photoIdentity(url: string): string {
  const listing = url.match(/listing-images\/([0-9a-f-]+_[0-9a-f-]+)\./i);
  if (listing) return `listing:${listing[1].toLowerCase()}`;
  return `url:${url.replace(/\/(?:resize|quality)\/[^/]*/gi, '').toLowerCase()}`;
}

function pixelArea(url: string): number {
  const size = url.match(/(\d{2,4})x(\d{2,4})/);
  if (size) return Number(size[1]) * Number(size[2]);
  return /original/i.test(url) ? Number.MAX_SAFE_INTEGER : 0;
}

// AutoTrader (autoscout24) serves the same photo as .webp or .jpg depending on
// the trailing size path. The draft is published into Mobile.bg as .jpg files,
// so ask for the JPEG variant of the largest available size.
function publishablePhotoUrl(url: string): string {
  if (!/pictures\.autoscout24\.net\/listing-images\//i.test(url)) return url;
  return url.replace(/\.webp(?:\?.*)?$/i, '.jpg');
}

// AutoTrader serves site chrome, dealer logos, tracking pixels and icons from
// the same DOM <img> collection as the car photos. Only actual listing photos
// belong in the draft, so off-site tracking and non-photo assets are dropped.
const JUNK_IMAGE = /doubleclick|googletagmanager|google-analytics|trackimp|tracking|pixel|\/ad\/|\/ads\/|dealer-info|dealer-logo|logo|icon|arrow|sprite|placeholder|no-photo|noimage|banner|facebook|instagram/i;

function isListingPhoto(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.svg(?:\?|$)/i.test(url)) return false;
  return !JUNK_IMAGE.test(url);
}

// Mobile.bg accepts at most 17 photos per listing, but the draft keeps every
// unique photo the source exposed so the broker can choose which 17 to publish.
const MAX_DRAFT_PHOTOS = 60;

function dedupeImages(images: Array<{ source_url: string; is_main: boolean; display_order: number }>) {
  const best = new Map<string, { source_url: string; is_main: boolean; display_order: number }>();
  for (const image of images) {
    if (!isListingPhoto(image.source_url)) continue;
    const key = photoIdentity(image.source_url);
    const current = best.get(key);
    if (!current || pixelArea(image.source_url) > pixelArea(current.source_url)) best.set(key, image);
  }
  return [...best.values()].slice(0, MAX_DRAFT_PHOTOS).map((image, index) => ({
    source_url: publishablePhotoUrl(image.source_url),
    is_main: index === 0,
    display_order: index + 1,
  }));
}
// Keeps track of which source actually supplied a value, so a field that ends
// up empty can be traced back to the fallback chain instead of guessed at.
function withSource(candidates: Array<[string, string | null]>): { value: string | null; from: string } {
  for (const [from, value] of candidates) if (value) return { value, from };
  return { value: null, from: 'none' };
}
function firstValue(root: unknown, keys: string[]): string | null {
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  let found: string | null = null;
  walk(root, record => {
    if (found) return;
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(key.toLowerCase())) continue;
      const text = scalar(value) || scalar(asRecord(value).name) || scalar(asRecord(value).value);
      if (text) { found = text; return; }
    }
  });
  return found;
}
function nested(root: JsonRecord, key: string, child: string[]): string | null {
  const parent = asRecord(root[key]);
  return firstValue(parent, child);
}
function numberText(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9.]/g, '');
  return digits || value;
}
function detailValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
function valuesFromDetailText(text: string) {
  return {
    mileage: detailValue(text, [
      /(?:mileage|odometer|kilomet(?:er|re)s?|пробег)\s*[:-]?\s*([0-9][0-9, .]*)\s*(?:km|км)?/i,
    ]),
    gearbox: detailValue(text, [
      /(?:transmission|gearbox|скоростна\s+кутия)\s*[:-]?\s*([^\n|,;]+)/i,
    ]),
    power: detailValue(text, [
      /(?:horsepower|horse\s*power|power|мощност)\s*[:-]?\s*([0-9][0-9 .]*)\s*(?:hp|kw|к\.?с\.?)?/i,
    ]),
    displacement: detailValue(text, [
      /(?:engine\s*(?:size|displacement)|displacement|кубатура|работен\s+обем)\s*[:-]?\s*([0-9][0-9 .]*)\s*(?:cc|cm3|l|литра)?/i,
    ]),
    euro: detailValue(text, [
      /(?:euro\s*(?:standard|class)?|екокатегория|евро\s*стандарт)\s*[:-]?\s*(euro\s*[1-6][a-z]?|евро\s*[1-6][a-z]?)/i,
    ]),
    color: detailValue(text, [
      /(?:exterior\s+colou?r|vehicle\s+colou?r|colou?r|цвят)\s*[:-]?\s*([^\n|,;]+)/i,
    ]),
  };
}
function normalizeFuel(value: string | null): string | null {
  if (!value) return null;
  const source = value.toLowerCase();
  if (source.includes('diesel')) return 'Дизел';
  if (source.includes('gas') || source.includes('petrol')) return 'Бензин';
  if (source.includes('hybrid')) return 'Хибрид';
  if (source.includes('electric')) return 'Електрически';
  return value;
}
function normalizeGearbox(value: string | null): string | null {
  if (!value) return null;
  const source = value.toLowerCase();
  if (source.includes('automatic') || source.includes('auto')) return 'Автоматична';
  if (source.includes('manual')) return 'Ръчна';
  return value;
}
function normalizeCondition(value: string | null): string | null {
  if (!value) return 'Използван';
  return value.toLowerCase().includes('new') ? 'Нов' : 'Използван';
}
function normalizeEuro(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(?:euro|евро)\s*([1-6][a-z]?)/i);
  return match ? `Euro ${match[1].toLowerCase()}` : value;
}
function normalizeColor(value: string | null): string | null {
  if (!value) return null;
  const source = value.toLowerCase();
  if (source.includes('grey') || source.includes('gray')) return 'Сив';
  if (source.includes('black')) return 'Черен';
  if (source.includes('white')) return 'Бял';
  if (source.includes('silver')) return 'Сребърен';
  if (source.includes('beige') || source.includes('tan')) return 'Бежов';
  if (source.includes('brown')) return 'Кафяв';
  if (source.includes('green')) return 'Зелен';
  if (source.includes('orange')) return 'Оранжев';
  if (source.includes('purple')) return 'Лилав';
  if (source.includes('yellow') || source.includes('gold')) return 'Златен';
  if (source.includes('red')) return 'Червен';
  if (source.includes('blue')) return 'Син';
  return value;
}
function imagesFrom(root: unknown): JsonRecord[] {
  const urls = new Set<string>();
  const imageKeys = new Set(['image', 'images', 'photo', 'photos', 'imageurl', 'imageurls', 'photourl', 'photourls', 'contenturl', 'largeimage', 'originalimage']);

  const addUrl = (value: unknown) => {
    const text = scalar(value);
    if (!text || !/^https?:\/\//i.test(text)) return;
    if (!/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(text) && !/(?:image|photo|cdn|carimg|encar)/i.test(text)) return;
    if (/(?:logo|icon|sprite|avatar|banner|placeholder|tracking|pixel)/i.test(text)) return;
    urls.add(text.replace(/&amp;/g, '&'));
  };

  walk(root, record => {
    for (const [key, value] of Object.entries(record)) {
      if (!imageKeys.has(key.toLowerCase())) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        const image = asRecord(item);
        addUrl(item);
        addUrl(image.url);
        addUrl(image.contentUrl);
        addUrl(image.source_url);
        addUrl(image.large);
        addUrl(image.original);
      }
    }
  });

  return [...urls].slice(0, 40).map((source_url, index) => ({
    source_url,
    is_main: index === 0,
    display_order: index + 1,
  }));
}
function normalizeDrivetrain(value: string | null): string | null {
  if (!value) return null;
  const source = value.toLowerCase();
  if (source.includes('all wheel') || source.includes('awd') || source.includes('4wd') || source.includes('4x4')) return '4x4';
  if (source.includes('rear')) return 'Задно';
  if (source.includes('front') || source.includes('fwd')) return 'Предно';
  return value;
}
function makePayload(job: SourceJob, documents: JsonRecord[], pageTitle: string, detail: ReturnType<typeof valuesFromDetailText> = valuesFromDetailText(''), domImageUrls: string[] = []) {
  const vehicle = vehicleRecord(documents);
  const source = job.source_type;
  const autoDetail = source === 'autotrader_ca' ? autotraderVehicle(documents) : {};
  const brand = nested(vehicle, 'brand', ['name']) || firstValue(vehicle, ['make', 'manufacturer']);
  const model = firstValue(vehicle, ['model', 'modelName']);
  const vehicleTitle = withSource([
    ['jsonld.itemListElement', normalizeTitle(listingTitleFromBreadcrumbs(documents))],
    ['page_title', normalizeTitle(pageTitle)],
  ]);
  const yearPick = withSource([
    ['jsonld', firstValue(vehicle, ['vehicleModelDate', 'modelYear', 'year'])],
    ['autotrader.listingDetails', scalar(autoDetail.modelYear)],
  ]);
  const mileagePick = withSource([
    ['detail_text', detail.mileage],
    ['jsonld.mileageFromOdometer', nested(vehicle, 'mileageFromOdometer', ['value'])],
    ['autotrader.listingDetails', scalar(autoDetail.mileageInKmRaw)],
    ['jsonld.odometer', firstValue(vehicle, ['mileage', 'odometer'])],
    ['page_title', pageTitle.match(/([0-9][0-9, .]*)\s*km\b/i)?.[1] || null],
  ]);
  const fuelPick = withSource([
    ['autotrader.listingDetails', scalar(asRecord(autoDetail.fuelCategory).formatted)],
    ['jsonld', firstValue(vehicle, ['fuelType', 'fuel'])],
  ]);
  const year = yearPick.value;
  const mileage = numberText(mileagePick.value);
  const fuel = normalizeFuel(fuelPick.value);
  const gearbox = normalizeGearbox(detail.gearbox || firstValue(vehicle, ['vehicleTransmission', 'transmission', 'gearbox']));
  const power = numberText(detail.power || nested(vehicle, 'vehicleEngine', ['enginePower', 'power']) || firstValue(vehicle, ['horsepower', 'powerHp', 'enginePower']));
  const displacement = numberText(detail.displacement || nested(vehicle, 'vehicleEngine', ['engineDisplacement', 'displacement']) || firstValue(vehicle, ['engineDisplacement', 'displacement']));
  const price = nested(vehicle, 'offers', ['price']) || firstValue(vehicle, ['price', 'salePrice']);
  const currency = nested(vehicle, 'offers', ['priceCurrency']) || firstValue(vehicle, ['priceCurrency', 'currency']);
  const euroStandard = normalizeEuro(detail.euro || firstValue(vehicle, ['euroStandard', 'euro_standard', 'emissionClass', 'emissions', 'euro']));
  const color = normalizeColor(detail.color || firstValue(vehicle, ['color', 'vehicleColor', 'exteriorColor', 'bodyColor', 'colour']));
  const description = companyDescription;
  const fields: Array<{ key: string; value: string; source: string; proof: string }> = [];
  const push = (key: string, value: string | null) => { if (value) fields.push({ key, value, source, proof: job.source_url }); };
  const pushTrace = (key: string, pick: { value: string | null; from: string }) => {
    if (pick.value) fields.push({ key, value: pick.value, source: pick.from, proof: job.source_url });
  };

  push('category', 'Автомобили и джипове');
  push('make', brand);
  push('model', model);
  pushTrace('title', vehicleTitle);
  pushTrace('modification', source === 'autotrader_ca' ? autotraderModification(documents) : withSource([]));
  push('year', year);
  push('mileage', mileage);
  push('fuel', fuel);
  push('gearbox', gearbox);
  push('power', power);
  push('displacement', displacement);
  push('euro_standard', euroStandard);
  push('color', color);
  push('doors', firstValue(vehicle, ['numberOfDoors', 'doors']));
  push('seats', firstValue(vehicle, ['seatingCapacity', 'seats']));
  push('vin', firstValue(vehicle, ['vehicleIdentificationNumber', 'vin']));
  push('condition', normalizeCondition(firstValue(vehicle, ['itemCondition', 'condition'])));
  push('drivetrain', normalizeDrivetrain(firstValue(vehicle, ['driveWheelConfiguration', 'drivetrain', 'driveType']) || scalar(autoDetail.driveTrain)));
  push('description', description);
  push('final_description', description);
  push('location', source === 'encar' ? 'Извън страната → Южна Корея' : 'Извън страната → Канада');
  push('seller_name', 'RoyalCarsBG');
  push('phone', '0887353653');
  push('ad_type', 'Стандартна');
  push('company_template', 'Стандартен');
  push('description_language', 'Български');
  push('source_type', source === 'encar' ? 'Encar' : 'AutoTrader Canada');
  push('source_url', job.source_url);
  push('source_listing_id', firstValue(vehicle, ['sku', 'listingId', 'id']) || job.source_url.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0] || null);
  push('source_price', price);
  // Mobile.bg listings are entered in EUR, so the currency control is fixed to
  // EUR while the source price keeps its own number. The source currency (CAD on
  // AutoTrader, KRW on Encar) is never copied into the publish price.
  push('currency', 'EUR');

  const payloadImages = dedupeImages([
    ...imagesFrom(documents),
    ...domImageUrls.filter(url => /^https?:\/\//i.test(url)).slice(0, 40).map(source_url => ({ source_url, is_main: false, display_order: 0 })),
  ]);

  console.log(JSON.stringify({
    event: 'source_field_trace',
    source_type: source,
    source_url: job.source_url,
    title: { value: vehicleTitle.value, from: vehicleTitle.from },
    year: { value: year, from: yearPick.from },
    mileage: { value: mileage, from: mileagePick.from },
    fuel: { value: fuel, from: fuelPick.from },
    images: { count: payloadImages.length, main: payloadImages[0]?.source_url || null },
  }));

  return {
    draft_id: job.draft_id,
    source: {
      type: source,
      url: job.source_url,
      listing_id: fields.find(field => field.key === 'source_listing_id')?.value || null,
      price_eur: currency === 'EUR' ? price : null,
      page_title: pageTitle,
    },
    fields,
    extras: [],
    images: payloadImages,
    raw_json: documents,
  };
}
async function updateJob(job: SourceJob, values: Record<string, unknown>) {
  const { error } = await db.from('source_listing_jobs').update({ ...values, updated_at: new Date().toISOString() }).eq('id', job.id);
  if (error) throw error;
}
async function claim(): Promise<SourceJob | null> {
  const { data, error } = await db.from('source_listing_jobs').select('id,draft_id,source_type,source_url,attempt_count').eq('status', 'QUEUED').order('created_at').limit(1).maybeSingle();
  if (error || !data) return null;
  const { data: claimed, error: updateError } = await db.from('source_listing_jobs')
    .update({ status: 'RUNNING', attempt_count: Number(data.attempt_count || 0) + 1, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', data.id).eq('status', 'QUEUED').select('id,draft_id,source_type,source_url,attempt_count').maybeSingle();
  if (updateError) throw updateError;
  return claimed as SourceJob | null;
}
async function run() {
  const job = await claim();
  if (!job) return console.log('Няма чакаща URL заявка.');
  const browser = await chromium.launch({ headless: process.env.SOURCE_INTAKE_HEADLESS !== 'false' });
  try {
    const page = await browser.newPage();
    await page.goto(job.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    const documents = await pageJson(page);
    if (!documents.length) throw new Error('В страницата не е намерен JSON.');
    const detailText = await page.locator('body').innerText().catch(() => '');
    const detail = valuesFromDetailText(detailText);
    const domImageUrls = await page.locator('img').evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src).filter(Boolean));
    const payload = makePayload(job, documents, await page.title(), detail, domImageUrls);
    const response = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Ingest върна ${response.status}: ${await response.text()}`);
    console.log(await response.text());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Непозната грешка.';
    await updateJob(job, { status: 'FAILED', error_message: message, finished_at: new Date().toISOString() });
    await db.from('mobile_bg_drafts').update({ extraction_status: 'FAILED', extraction_error: message, status: 'ERROR', updated_at: new Date().toISOString() }).eq('id', job.draft_id);
    await db.from('mobile_bg_draft_action_log').insert({ draft_id: job.draft_id, action: 'SOURCE_JSON_EXTRACTION_FAILED', actor: workerName, details: { message, source_url: job.source_url } });
    throw cause;
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
