// Translates a draft into the parameter set `advertpub` expects.
//
// The documentation gives one worked example of a body and states the general
// rule: the parameters are "all the parameters from the Catfields section for
// the chosen topmenu and rub". It does not publish a fixed schema, so the
// mapping below is deliberately split into two kinds of entry:
//
//   * `confirmed` — the parameter name appears by that exact name in the
//     documentation's example body (`marka`, `model`, `km`, `locat`, `price`,
//     `currency`, `month`, `year`, `transmission`, `engine_type`, `phone`,
//     `email`, `extri`).
//   * the rest — a best-effort name taken from the browser form's identifiers,
//     which may or may not be the name the API uses.
//
// Guessing is kept safe by never trusting this table alone. The worker asks the
// API for `catfields` of the target category and intersects: a parameter the API
// does not declare is dropped rather than sent, and every dropped or unmapped
// draft field is reported by name. That way the first real run produces an exact
// list of what Mobile.bg accepts, instead of a blind failure.

export type ApiFieldKind = 'text' | 'number' | 'list' | 'flag' | 'textarea';

export type ApiFieldMapping = {
  // Parameter name sent to the API.
  apiKey: string;
  kind: ApiFieldKind;
  // True when the documentation's example body uses this exact parameter name.
  confirmed: boolean;
  // How a broker should see the parameter in the diagnostics panel.
  label: string;
};

// Categories are numeric. Only the ones the draft can actually produce are
// listed; the draft's own `category` field holds the Bulgarian name.
export const TOPMENU_BY_CATEGORY: Record<string, number> = {
  'Автомобили и джипове': 1,
  'Автомобили и Джипове': 1,
  Бусове: 3,
  Камиони: 4,
  Мотоциклети: 5,
  'Селскостопанска техника': 6,
  'Строителна техника': 7,
  Кари: 8,
  Каравани: 9,
  'Яхти и Лодки': 10,
  Ремаркета: 11,
  Велосипеди: 12,
};

export const DEFAULT_TOPMENU = 1;
export const DEFAULT_RUB = 1;

// Draft field key -> API parameter. Keys absent from this table are reported as
// unmapped instead of being sent under a made-up name.
export const FIELD_TO_API: Record<string, ApiFieldMapping> = {
  make: { apiKey: 'marka', kind: 'list', confirmed: true, label: 'Марка' },
  model: { apiKey: 'model', kind: 'list', confirmed: true, label: 'Модел' },
  year: { apiKey: 'year', kind: 'list', confirmed: true, label: 'Година' },
  month: { apiKey: 'month', kind: 'list', confirmed: true, label: 'Месец' },
  mileage: { apiKey: 'km', kind: 'number', confirmed: true, label: 'Пробег' },
  price: { apiKey: 'price', kind: 'number', confirmed: true, label: 'Цена' },
  currency: { apiKey: 'currency', kind: 'list', confirmed: true, label: 'Валута' },
  fuel: { apiKey: 'engine_type', kind: 'list', confirmed: true, label: 'Гориво' },
  gearbox: { apiKey: 'transmission', kind: 'list', confirmed: true, label: 'Скоростна кутия' },
  phone: { apiKey: 'phone', kind: 'text', confirmed: true, label: 'Телефон' },
  email: { apiKey: 'email', kind: 'text', confirmed: true, label: 'Email' },
  location: { apiKey: 'locat', kind: 'list', confirmed: true, label: 'Регион' },
  // The example sends both `locat` (region) and `locatc` (settlement). The draft
  // stores them joined, so both are derived from one value.
  title: { apiKey: 'zaglavie', kind: 'text', confirmed: false, label: 'Заглавие' },
  description: { apiKey: 'description', kind: 'textarea', confirmed: false, label: 'Описание' },
  final_description: { apiKey: 'description', kind: 'textarea', confirmed: false, label: 'Описание' },
  color: { apiKey: 'color', kind: 'list', confirmed: false, label: 'Цвят' },
  power: { apiKey: 'power', kind: 'number', confirmed: false, label: 'Мощност' },
  displacement: { apiKey: 'engine_cc', kind: 'number', confirmed: false, label: 'Кубатура' },
  euro_standard: { apiKey: 'euro', kind: 'list', confirmed: false, label: 'Екокатегория' },
  condition: { apiKey: 'nup', kind: 'list', confirmed: false, label: 'Състояние' },
  doors: { apiKey: 'doors', kind: 'list', confirmed: false, label: 'Брой врати' },
  seats: { apiKey: 'seats', kind: 'number', confirmed: false, label: 'Брой места' },
  drivetrain: { apiKey: 'drivetrain', kind: 'list', confirmed: false, label: 'Задвижване' },
  vat_included: { apiKey: 'dds', kind: 'list', confirmed: false, label: 'ДДС' },
  vin: { apiKey: 'vin', kind: 'text', confirmed: false, label: 'VIN' },
  modification: { apiKey: 'modification', kind: 'text', confirmed: false, label: 'Модификация' },
  leasing: { apiKey: 'leasing', kind: 'list', confirmed: false, label: 'Лизинг' },
  barter: { apiKey: 'barter', kind: 'list', confirmed: false, label: 'Бартер' },
  seller_name: { apiKey: 'seller_name', kind: 'text', confirmed: false, label: 'Продавач' },
  extra_conditions: { apiKey: 'extra_conditions', kind: 'text', confirmed: false, label: 'Допълнителни условия' },
};

// Both keys write the same parameter, so one has to win. `final_description` is
// the value the broker composed for Mobile.bg specifically, so it is preferred.
const DESCRIPTION_PREFERENCE = ['final_description', 'description'];

// Value translations carried over from the browser publisher, which validated
// them against the real form. The API's list values come from `Dictionary`, and
// are checked against it at run time; these only cover the cases where the
// draft's wording differs from the form's.
export const VALUE_ALIASES: Record<string, Record<string, string>> = {
  fuel: { Бензин: 'Бензинов', Дизел: 'Дизелов', Хибрид: 'Хибриден', 'Газ (LPG)': 'Газ' },
  condition: { Използван: 'Употребяван', Нов: 'Нов', 'За части': 'За части' },
  euro_standard: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`Euro ${n}`, `Евро ${n}`])),
  month: Object.fromEntries(
    ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември']
      .map(v => [v, v.toLocaleLowerCase('bg')]),
  ),
  currency: { EUR: 'EUR', BGN: 'лв.', USD: 'USD' },
};

// The draft stores the origin as one joined value; the API takes a region and a
// settlement separately. Mirrors the browser publisher's LOCATION_ALIASES.
export const LOCATION_ALIASES: Record<string, string> = {
  'Извън страната → Канада': 'Извън страната',
  'Извън страната → Южна Корея': 'Извън страната',
};

// Extras are sent as one parameter. The documentation is self-contradictory
// about the separator — its example body uses "/" while the sentence explaining
// it uses "~" — so the separator is configurable and the choice is recorded in
// the diagnostics. The explicit instruction wins by default.
export const EXTRI_SEPARATOR = process.env.MOBILE_BG_API_EXTRI_SEPARATOR || '~';

// Extras accepted by the API differ from the browser form's labels in a few
// cases. Inherited from the browser publisher's EXTRA_ALIASES.
export const EXTRA_ALIASES: Record<string, string> = {
  ABS: 'Антиблокираща система',
  ESP: 'Електронна програма за стабилизиране',
  ISOFIX: 'Система ISOFIX',
  'Автоматичен климатик': 'Климатроник',
  'Подгряване на предни седалки': 'Подгряване на седалките',
  'Подгряване на задни седалки': 'Подгряване на седалките',
  'Вентилирани седалки': 'Вентилация на седалките',
  'Подгряване на волан': 'Отопление на волана',
  'Електрически седалки': 'Ел. регулиране на седалките',
  'Панорамен покрив': 'Панорамен люк',
  'Парктроник преден': 'Парктроник',
  'Парктроник заден': 'Парктроник',
  'Камера за назад': '360 camera \\ Задна камера',
  '360° камера': '360 camera \\ Задна камера',
  'Apple CarPlay': 'Apple CarPlay \\ Android Auto',
  'Android Auto': 'Apple CarPlay \\ Android Auto',
  Bluetooth: 'Bluetooth \\ handsfree система',
  USB: 'USB, audio\\video, IN\\AUX изводи',
  'Keyless Go': 'Безключово палене',
  'Адаптивни фарове': 'Адаптивни предни светлини',
  'Сензор за светлина': 'Датчик за светлина',
  'Уред за теглене': 'Теглич',
  'Пневматично окачване': 'Адаптивно въздушно окачване',
  'Адаптивно окачване': 'Адаптивно въздушно окачване',
  'Диференциална блокировка': 'Блокаж на диференциала',
  'Офроуд пакет': 'OFFROAD пакет',
};

export type DraftFieldRow = { field_key: string; value: string | null };
export type DraftExtraRow = { mobile_bg_label: string; selected: boolean };

export type BuiltPayload = {
  params: Record<string, string>;
  // Draft fields that went into `params`, for the diagnostics panel.
  mapped: Array<{ field_key: string; api_key: string; value: string; confirmed: boolean; label: string }>;
  // Draft fields the table has no entry for. Reported, never sent.
  unmapped: Array<{ field_key: string; value: string }>;
  extras: string[];
  warnings: string[];
};

function applyAlias(key: string, value: string): string {
  const table = VALUE_ALIASES[key];
  if (table && table[value]) return table[value];
  return value;
}

// Mobile.bg takes the origin as region plus settlement. The draft keeps one
// joined string, so the settlement is taken from the part after the arrow when
// there is one, and the region from the alias table.
export function splitLocation(value: string): { locat: string; locatc: string | null } {
  const locat = LOCATION_ALIASES[value] || value.split('→')[0].trim();
  const after = value.includes('→') ? value.split('→').slice(1).join('→').trim() : '';
  return { locat, locatc: after || null };
}

export function categoryToTopmenu(value: string | null | undefined): { topmenu: number; known: boolean } {
  const key = (value || '').trim();
  if (!key) return { topmenu: DEFAULT_TOPMENU, known: false };
  const found = TOPMENU_BY_CATEGORY[key];
  return found ? { topmenu: found, known: true } : { topmenu: DEFAULT_TOPMENU, known: false };
}

export function buildPayload(
  fields: DraftFieldRow[],
  extras: DraftExtraRow[],
  options: { category?: string | null; term?: number } = {},
): BuiltPayload {
  const values = new Map<string, string>();
  for (const row of fields) {
    const value = String(row.value ?? '').trim();
    if (value) values.set(row.field_key, value);
  }

  const params: Record<string, string> = {};
  const mapped: BuiltPayload['mapped'] = [];
  const unmapped: BuiltPayload['unmapped'] = [];
  const warnings: string[] = [];

  // Two draft keys can target the same parameter; the preferred one is placed
  // first and the later write is skipped rather than overwriting it.
  const claimed = new Set<string>();
  const orderedKeys = [
    ...DESCRIPTION_PREFERENCE.filter(key => values.has(key)),
    ...[...values.keys()].filter(key => !DESCRIPTION_PREFERENCE.includes(key)),
  ];

  for (const key of orderedKeys) {
    const value = values.get(key) as string;
    const rule = FIELD_TO_API[key];
    if (!rule) {
      unmapped.push({ field_key: key, value });
      continue;
    }
    if (claimed.has(rule.apiKey)) continue;

    if (key === 'location') {
      const { locat, locatc } = splitLocation(value);
      params.locat = locat;
      claimed.add('locat');
      mapped.push({ field_key: key, api_key: 'locat', value: locat, confirmed: true, label: 'Регион' });
      if (locatc) {
        params.locatc = locatc;
        claimed.add('locatc');
        mapped.push({ field_key: key, api_key: 'locatc', value: locatc, confirmed: true, label: 'Населено място' });
      }
      continue;
    }

    const translated = applyAlias(key, value);
    params[rule.apiKey] = translated;
    claimed.add(rule.apiKey);
    mapped.push({
      field_key: key, api_key: rule.apiKey, value: translated,
      confirmed: rule.confirmed, label: rule.label,
    });
  }

  const { topmenu, known } = categoryToTopmenu(options.category);
  params.topmenu = String(topmenu);
  params.rub = String(DEFAULT_RUB);
  if (!known && options.category) {
    warnings.push(`Категорията „${options.category}“ не е разпозната; използвана е основна категория ${topmenu}. Провери преди публикуване.`);
  }
  params.term = String(options.term ?? Number(process.env.MOBILE_BG_API_TERM || 35));

  const extraLabels = [...new Set(
    extras.filter(extra => extra.selected)
      .map(extra => EXTRA_ALIASES[extra.mobile_bg_label] || extra.mobile_bg_label)
      .filter(Boolean),
  )];
  if (extraLabels.length > 0) params.extri = extraLabels.join(EXTRI_SEPARATOR);

  return { params, mapped, unmapped, extras: extraLabels, warnings };
}

// The API declares what it accepts; anything else is dropped rather than sent.
// `catfields` returns rows carrying `fname`; a response missing `fname` entirely
// means the shape was not understood, and then nothing is dropped, because
// dropping on a bad parse would silently strip a valid payload.
export type CatfieldsShape = { names: Set<string>; understood: boolean };

export function readCatfields(payload: unknown): CatfieldsShape {
  const names = new Set<string>();
  let understood = false;
  const walk = (node: unknown, depth: number): void => {
    if (depth > 5 || node === null || node === undefined) return;
    if (Array.isArray(node)) { node.forEach(item => walk(item, depth + 1)); return; }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' && /^fname$/i.test(key)) { names.add(value.trim()); understood = true; }
      else if (/^(fname|field|name)$/i.test(key) && typeof value === 'string' && depth > 0) {
        names.add(value.trim()); understood = true;
      } else walk(value, depth + 1);
    }
  };
  walk(payload, 0);
  return { names, understood };
}

// The parameters the API always needs and that no draft field provides, so a
// run cannot proceed without them.
export const REQUIRED_API_PARAMS = ['topmenu', 'rub', 'marka', 'model', 'price', 'currency'];

export function intersectWithCatfields(
  params: Record<string, string>,
  catfields: CatfieldsShape,
): { sent: Record<string, string>; dropped: Array<{ api_key: string; value: string }> } {
  if (!catfields.understood || catfields.names.size === 0) {
    return { sent: { ...params }, dropped: [] };
  }
  const sent: Record<string, string> = {};
  const dropped: Array<{ api_key: string; value: string }> = [];
  // `topmenu`, `rub`, `ida` and `extri` are documented as control parameters
  // rather than category fields, so they are never dropped.
  const alwaysKeep = new Set(['topmenu', 'rub', 'ida', 'extri', 'pretty']);
  for (const [key, value] of Object.entries(params)) {
    if (alwaysKeep.has(key) || catfields.names.has(key)) sent[key] = value;
    else dropped.push({ api_key: key, value });
  }
  return { sent, dropped };
}
