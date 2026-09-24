import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'content-type, x-source-intake-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type JsonRecord = Record<string, unknown>;

type IncomingField = {
  key: string;
  value: string | number | boolean | null;
  proof?: string;
  source?: string;
  label?: string;
  db_key?: string;
  field_type?: string;
};

const fieldMeta: Record<string, { label: string; dbKey: string; fieldType: string }> = {
  category: { label: 'Категория', dbKey: 'category', fieldType: 'select' },
  make: { label: 'Марка', dbKey: 'make', fieldType: 'select' },
  model: { label: 'Модел', dbKey: 'model', fieldType: 'select' },
  modification: { label: 'Модификация', dbKey: 'modification', fieldType: 'text' },
  year: { label: 'Година на производство', dbKey: 'model_year', fieldType: 'number' },
  month: { label: 'Месец на производство', dbKey: 'production_month', fieldType: 'select' },
  mileage: { label: 'Пробег', dbKey: 'mileage_km', fieldType: 'number' },
  fuel: { label: 'Гориво', dbKey: 'fuel', fieldType: 'select' },
  gearbox: { label: 'Скоростна кутия', dbKey: 'gearbox', fieldType: 'select' },
  power: { label: 'Мощност', dbKey: 'power_hp', fieldType: 'number' },
  displacement: { label: 'Кубатура', dbKey: 'displacement_cc', fieldType: 'number' },
  euro_standard: { label: 'Екокатегория', dbKey: 'euro_standard', fieldType: 'select' },
  color: { label: 'Цвят', dbKey: 'color', fieldType: 'select' },
  doors: { label: 'Брой врати', dbKey: 'doors', fieldType: 'select' },
  seats: { label: 'Брой места', dbKey: 'seats', fieldType: 'number' },
  condition: { label: 'Състояние', dbKey: 'condition', fieldType: 'select' },
  drivetrain: { label: 'Задвижване', dbKey: 'drivetrain', fieldType: 'select' },
  vin: { label: 'VIN', dbKey: 'vin', fieldType: 'text' },
  generation: { label: 'Генерация', dbKey: 'generation', fieldType: 'text' },
  facelift: { label: 'Фейслифт', dbKey: 'facelift', fieldType: 'select' },
  price: { label: 'Цена', dbKey: 'price_eur', fieldType: 'number' },
  currency: { label: 'Валута', dbKey: 'currency', fieldType: 'select' },
  vat_included: { label: 'Цената с ДДС ли е', dbKey: 'vat_included', fieldType: 'select' },
  leasing: { label: 'Възможност за лизинг', dbKey: 'leasing_available', fieldType: 'select' },
  barter: { label: 'Бартер', dbKey: 'barter', fieldType: 'select' },
  extra_conditions: { label: 'Допълнителни условия', dbKey: 'extra_conditions', fieldType: 'text' },
  our_calculated_price: { label: 'Наша калкулирана цена', dbKey: 'our_price_eur', fieldType: 'number' },
  min_acceptable_price: { label: 'Минимална допустима цена', dbKey: 'min_price_eur', fieldType: 'number' },
  calc_source: { label: 'Източник на калкулацията', dbKey: 'calc_source', fieldType: 'select' },
  description_auto: { label: 'Автоматично описание', dbKey: 'description_auto', fieldType: 'textarea' },
  description_manual: { label: 'Ръчно добавен текст', dbKey: 'description_manual', fieldType: 'textarea' },
  description_final: { label: 'Финално описание за Mobile.bg', dbKey: 'description_final', fieldType: 'textarea' },
  title: { label: 'Заглавие', dbKey: 'title', fieldType: 'text' },
  description: { label: 'Описание', dbKey: 'description', fieldType: 'textarea' },
  final_description: { label: 'Финално описание за Mobile.bg', dbKey: 'final_description', fieldType: 'textarea' },
  company_template: { label: 'Шаблон на фирмата', dbKey: 'company_template', fieldType: 'select' },
  description_language: { label: 'Език на описанието', dbKey: 'description_language', fieldType: 'select' },
  location: { label: 'Населено място/област', dbKey: 'location', fieldType: 'text' },
  seller_name: { label: 'Име на продавача/фирмата', dbKey: 'seller_name', fieldType: 'text' },
  broker: { label: 'Брокер', dbKey: 'broker_name', fieldType: 'text' },
  phone: { label: 'Телефон', dbKey: 'phone', fieldType: 'text' },
  phone2: { label: 'Втори телефон', dbKey: 'phone2', fieldType: 'text' },
  email: { label: 'Email', dbKey: 'email', fieldType: 'text' },
  mobile_bg_profile: { label: 'Профил в Mobile.bg', dbKey: 'mobile_bg_profile', fieldType: 'text' },
  ad_type: { label: 'Тип обява/пакет', dbKey: 'ad_type', fieldType: 'select' },
  source_type: { label: 'Източник', dbKey: 'source_type', fieldType: 'select' },
  source_url: { label: 'URL на източниковата обява', dbKey: 'source_url', fieldType: 'text' },
  source_listing_id: { label: 'ID на източниковата обява', dbKey: 'source_listing_id', fieldType: 'text' },
  source_vin: { label: 'VIN от източника', dbKey: 'source_vin', fieldType: 'text' },
  source_price: { label: 'Цена на източника', dbKey: 'source_price_eur', fieldType: 'number' },
};

// Mobile.bg accepts at most 17 photos per listing.
const MOBILE_BG_MAX_PHOTOS = 17;

const requiredForReview = [
  'category', 'make', 'model', 'year', 'mileage', 'fuel', 'gearbox', 'color',
  'condition', 'drivetrain', 'price', 'currency', 'location', 'seller_name',
  'phone', 'ad_type',
];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function normaliseSourceType(value: unknown): 'encar' | 'autotrader_ca' | 'other' {
  const text = String(value || '').toLowerCase();
  if (text.includes('encar')) return 'encar';
  if (text.includes('autotrader')) return 'autotrader_ca';
  return 'other';
}

function safeHostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function collectFields(payload: JsonRecord): IncomingField[] {
  const rawFields = payload.fields;
  if (Array.isArray(rawFields)) {
    return rawFields
      .filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map(item => ({
        key: String(item.key || '').trim(), value: (item.value ?? null) as IncomingField['value'],
        proof: asString(item.proof) || undefined, source: asString(item.source) || undefined,
        label: asString(item.label) || undefined, db_key: asString(item.db_key) || undefined,
        field_type: asString(item.field_type) || undefined,
      }))
      .filter(item => item.key.length > 0 && asString(item.value) !== null);
  }

  const record = asRecord(rawFields);
  return Object.entries(record)
    .filter(([, value]) => asString(value) !== null)
    .map(([key, value]) => ({ key, value: value as IncomingField['value'] }));
}

function response(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Използвай POST.' }, 405);

  const expectedToken = Deno.env.get('SOURCE_INTAKE_TOKEN');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const receivedToken = request.headers.get('x-source-intake-token');
  const authorization = request.headers.get('authorization') || '';
  const serviceRoleRequest = Boolean(serviceRole) && authorization === `Bearer ${serviceRole}`;
  const tokenRequest = Boolean(expectedToken) && receivedToken === expectedToken;
  if (!tokenRequest && !serviceRoleRequest) return response({ error: 'Невалиден intake token.' }, 401);

  let payload: JsonRecord;
  try {
    payload = asRecord(await request.json());
  } catch {
    return response({ error: 'Тялото трябва да е валиден JSON.' }, 400);
  }

  const source = asRecord(payload.source);
  const fields = collectFields(payload);
  if (fields.length === 0) return response({ error: 'JSON трябва да съдържа поне едно поле в fields.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || !serviceRole) return response({ error: 'Supabase server configuration is incomplete.' }, 500);
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const byKey = new Map(fields.map(field => [field.key, asString(field.value) || '']));
  const sourceType = normaliseSourceType(source.type || byKey.get('source_type'));
  const sourceUrl = asString(source.url) || byKey.get('source_url') || null;
  const listingId = asString(source.listing_id) || byKey.get('source_listing_id') || null;
  const sourceVin = asString(source.vin) || byKey.get('source_vin') || byKey.get('vin') || null;
  const sourcePriceRaw = source.price_eur ?? byKey.get('source_price');
  const sourcePrice = Number(sourcePriceRaw);
  const priceEur = Number.isFinite(sourcePrice) ? sourcePrice : null;
  if (!sourceUrl) return response({ error: 'JSON трябва да съдържа source.url.' }, 400);
  const missing = requiredForReview.filter(key => !byKey.get(key));
  const nextStatus = missing.length === 0 ? 'READY_FOR_REVIEW' : 'DRAFT';
  const extractedTitle = byKey.get('title');
  const title = extractedTitle
    || [byKey.get('make'), byKey.get('model'), byKey.get('year')].filter(Boolean).join(' ')
    || `Извлечена обява ${listingId || ''}`.trim();

  const requestedDraftId = asString(payload.draft_id);
  let draftId = requestedDraftId;
  if (draftId) {
    const { data: existing, error } = await db.from('mobile_bg_drafts').select('id').eq('id', draftId).maybeSingle();
    if (error) return response({ error: error.message }, 500);
    if (!existing) return response({ error: 'Черновата не е намерена.' }, 404);
  } else {
    const { data, error } = await db.from('mobile_bg_drafts').insert({
      title, status: nextStatus, source_type: sourceType, source_url: sourceUrl,
      source_listing_id: listingId, source_vin: sourceVin, source_price_eur: priceEur,
      intake_origin: 'SCRIPT_JSON', extraction_status: 'PROCESSING',
      source_domain: safeHostname(sourceUrl),
      created_by: 'Source script',
    }).select('id').single();
    if (error || !data) return response({ error: error?.message || 'Черновата не беше създадена.' }, 500);
    draftId = data.id;
  }

  const normalisedPayload = { source: { type: sourceType, url: sourceUrl, listing_id: listingId }, field_count: fields.length, missing_required_fields: missing };
  const { error: draftError } = await db.from('mobile_bg_drafts').update({
    title, status: nextStatus, source_type: sourceType, source_url: sourceUrl,
    source_listing_id: listingId, source_vin: sourceVin, source_price_eur: priceEur,
    intake_origin: 'SCRIPT_JSON', extraction_status: missing.length ? 'COMPLETED_NEEDS_REVIEW' : 'COMPLETED',
    extraction_error: null, source_domain: safeHostname(sourceUrl),
    updated_at: new Date().toISOString(),
  }).eq('id', draftId);
  if (draftError) return response({ error: draftError.message }, 500);

  const fieldRows = fields.map(field => {
    const meta = fieldMeta[field.key];
    return {
      draft_id: draftId, field_key: field.key,
      mobile_bg_label: field.label || meta?.label || field.key,
      our_db_key: field.db_key || meta?.dbKey || field.key,
      value: asString(field.value), field_type: field.field_type || meta?.fieldType || 'text',
      source: field.source || sourceType, proof: field.proof || sourceUrl,
      validation_status: 'pending', filled_at: new Date().toISOString(), is_manual_edit: false,
    };
  });
  const { error: fieldsError } = await db.from('mobile_bg_draft_fields').upsert(fieldRows, { onConflict: 'draft_id,field_key' });
  if (fieldsError) return response({ error: fieldsError.message }, 500);

  const extras = Array.isArray(payload.extras) ? payload.extras : [];
  const extraRows = extras
    .map(item => typeof item === 'string' ? { key: item, selected: true } : asRecord(item))
    .map(item => ({
      draft_id: draftId, extra_key: String(item.key || '').trim(),
      mobile_bg_label: asString(item.label) || String(item.key || '').trim(),
      group_name: asString(item.group) || 'Други', selected: item.selected !== false,
      proof: asString(item.proof) || sourceUrl, source: asString(item.source) || sourceType,
    }))
    .filter(item => item.extra_key.length > 0);
  if (extraRows.length) {
    const { error } = await db.from('mobile_bg_draft_extras').upsert(extraRows, { onConflict: 'draft_id,extra_key' });
    if (error) return response({ error: error.message }, 500);
  }

  const images = Array.isArray(payload.images) ? payload.images.map(asRecord) : [];
  if (images.length) {
    await db.from('mobile_bg_draft_images').delete().eq('draft_id', draftId);
    const imageRows = images
      .map((image, index) => ({
        draft_id: draftId, source_url: asString(image.source_url || image.url), local_path: asString(image.local_path),
        converted_jpg: image.converted_jpg === true, is_selected: image.selected !== false,
        is_main: image.is_main === true || index === 0, display_order: Number(image.display_order ?? index + 1),
        real_car_photo_check: image.real_car_photo_check === true, processing_status: asString(image.processing_status) || 'pending',
        size_bytes: Number.isFinite(Number(image.size_bytes)) ? Number(image.size_bytes) : null,
      }))
      .filter(image => image.source_url);
    // Mobile.bg caps a listing at 17 photos. Every unique source photo is stored
    // so the broker can swap picks, but only the first 17 by display_order start
    // selected. Deciding it by position after ordering — rather than by the order
    // the payload happened to list them in, which the previous check used — means
    // the selection matches what the screen and the publisher call "the first 17".
    const ordered = [...imageRows].sort((a, b) => a.display_order - b.display_order);
    ordered.forEach((image, position) => {
      if (position >= MOBILE_BG_MAX_PHOTOS) image.is_selected = false;
    });
    if (imageRows.length) {
      const { error } = await db.from('mobile_bg_draft_images').insert(imageRows);
      if (error) return response({ error: error.message }, 500);
    }
  }

  const { error: jobError } = await db.from('source_listing_jobs').update({
    source_type: sourceType, source_url: sourceUrl || '', status: 'COMPLETED',
    raw_payload: payload, normalized_payload: normalisedPayload, payload_received_at: new Date().toISOString(),
    result: normalisedPayload, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    error_message: null,
  }).eq('draft_id', draftId);
  if (jobError) return response({ error: jobError.message }, 500);

  await db.from('mobile_bg_draft_action_log').insert({
    draft_id: draftId, action: 'SCRIPT_JSON_INGESTED', actor: 'Source script',
    details: normalisedPayload,
  });

  return response({ draft_id: draftId, status: nextStatus, missing_required_fields: missing, publish_allowed: false });
});
