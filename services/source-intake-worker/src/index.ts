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
function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter(v => Object.keys(v).length > 0) : [];
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
  const match = value.match(/(?:euro|евро)\\s*([1-6][a-z]?)/i);
  return match ? `Euro ${match[1].toLowerCase()}` : value;
}
function normalizeColor(value: string | null): string | null {
  if (!value) return null;
  const source = value.toLowerCase();
  if (source.includes('grey') || source.includes('gray')) return 'Сив';
  if (source.includes('black')) return 'Черен';
  if (source.includes('white')) return 'Бял';
  if (source.includes('red')) return 'Червен';
  if (source.includes('blue')) return 'Син';
  if (source.includes('silver')) return 'Сребърен';
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
function extrasFrom(root: JsonRecord): string[] {
  const known = ['feature', 'features', 'additionalProperty', 'vehicleEquipment', 'equipment'];
  const result = new Set<string>();
  for (const key of known) {
    const values = root[key];
    const list = Array.isArray(values) ? values : values ? [values] : [];
    for (const item of list) {
      const record = asRecord(item);
      const text = scalar(item) || scalar(record.name) || scalar(record.value);
      if (text && text.length < 120) result.add(text);
    }
  }
  return [...result];
}
function makePayload(job: SourceJob, documents: JsonRecord[], pageTitle: string) {
  const vehicle = vehicleRecord(documents);
  const source = job.source_type;
  const brand = nested(vehicle, 'brand', ['name']) || firstValue(vehicle, ['make', 'manufacturer']);
  const model = firstValue(vehicle, ['model', 'modelName']);
  const year = firstValue(vehicle, ['vehicleModelDate', 'modelYear', 'year']);
  const mileage = numberText(
    nested(vehicle, 'mileageFromOdometer', ['value']) ||
    firstValue(vehicle, ['mileage', 'odometer']) ||
    pageTitle.match(/([\\d, .]+)\\s*km\\b/i)?.[1] || null,
  );
  const fuel = normalizeFuel(firstValue(vehicle, ['fuelType', 'fuel']));
  const gearbox = normalizeGearbox(firstValue(vehicle, ['vehicleTransmission', 'transmission', 'gearbox']));
  const power = numberText(nested(vehicle, 'vehicleEngine', ['enginePower', 'power']) || firstValue(vehicle, ['horsepower', 'powerHp', 'enginePower']));
  const displacement = numberText(nested(vehicle, 'vehicleEngine', ['engineDisplacement', 'displacement']) || firstValue(vehicle, ['engineDisplacement', 'displacement']));
  const price = nested(vehicle, 'offers', ['price']) || firstValue(vehicle, ['price', 'salePrice']);
  const currency = nested(vehicle, 'offers', ['priceCurrency']) || firstValue(vehicle, ['priceCurrency', 'currency']);
  const modification = firstValue(vehicle, ['trim', 'variant', 'package', 'modification']) ||
    (source === 'autotrader_ca' && /technik/i.test(pageTitle) ? 'Technik' : null);
  const euroStandard = normalizeEuro(firstValue(vehicle, ['euroStandard', 'euro_standard', 'emissionClass', 'emissions', 'euro']));
  const color = normalizeColor(firstValue(vehicle, ['color', 'vehicleColor', 'exteriorColor']));
  const description = companyDescription;
  const fields: Array<{ key: string; value: string; source: string; proof: string }> = [];
  const push = (key: string, value: string | null) => { if (value) fields.push({ key, value, source, proof: job.source_url }); };

  push('category', 'Автомобили и джипове');
  push('make', brand);
  push('model', model);
  push('modification', modification);
  push('year', year);
  if (source === 'autotrader_ca') push('month', 'Декември');
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
  push('drivetrain', firstValue(vehicle, ['driveWheelConfiguration', 'drivetrain', 'driveType']));
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
  push('currency', currency === 'EUR' ? 'EUR' : null);

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
    extras: extrasFrom(vehicle),
    images: imagesFrom(documents),
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
    const payload = makePayload(job, documents, await page.title());
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
