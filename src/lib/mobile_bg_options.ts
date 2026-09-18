import type { MobileBgDraftField, MobileBgDraftExtra } from '@/types';

export const MONTHS_BG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

// The proven mapping, lifted from the working «Обяви» publisher rather than
// re-derived. Mobile.bg names its controls f5..f32 and accepts only its own
// option wording, so every value has to be translated before it is typed in.
export const MOBILE_BG_SELECTORS: Record<string, string> = {
  make: 'f5', model: 'f6', modification: 'f7', fuel: 'f8', condition: 'f25',
  power: 'f9', euro_standard: 'f29', gearbox: 'f10', displacement: 'f30',
  price: 'f12', currency: 'f13', vat_included: 'f31', mileage: 'f16',
  month: 'f14', year: 'f15', color: 'f17', location: 'f18', country: 'f19', vin: 'f32',
};

export const MOBILE_BG_TEXT_SELECTORS: Record<string, string> = {
  description: 'f21',
  phone: 'f22',
};

// «Заглавие» is not one of the f-fields, so it is found by its visible label.
export const TITLE_BY_LABEL = 'Заглавие';

// Mobile.bg splits the origin across two lists: f18 is the market area and f19
// the country. The draft stores them joined, so each is resolved separately.
export const LOCATION_ALIASES: Record<string, string> = {
  'Извън страната → Канада': 'Извън страната',
  'Извън страната → Южна Корея': 'Извън страната',
};

export const COUNTRY_CANDIDATES: Array<[string, string[]]> = [
  ['Канада', ['Канада']],
  ['Южна Корея', ['Южна Корея', 'Корея', 'Южна Корея (Република Корея)']],
];

// These are the strings the agent-driven session used when it published real
// listings, so they were read off the live form rather than guessed. They are
// still unvalidated by us: every fill this repository has attempted died at the
// Cloudflare interstitial before reaching a single field.
export const VALUE_ALIASES: Record<string, Record<string, string>> = {
  fuel: { Бензин: 'Бензинов', Дизел: 'Дизелов', Хибрид: 'Хибриден', 'Газ (LPG)': 'Газ' },
  condition: { Използван: 'Употребяван' },
  euro_standard: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`Euro ${n}`, `Евро ${n}`])),
  month: Object.fromEntries(MONTHS_BG.map(value => [value, value.toLocaleLowerCase('bg')])),
  vat_included: {
    Да: 'Цената е с включено ДДС',
    Не: 'Цената е без ДДС',
    'Цената е с включено ДДС': 'Цената е с включено ДДС',
    'Цената е без ДДС': 'Цената е без ДДС',
    'Частна продажба./Освободена от ДДС продажба': 'Частна продажба./Освободена от ДДС продажба',
  },
};

export const EXTRA_ALIASES: Record<string, string> = {
  ABS: 'Антиблокираща система', ESP: 'Електронна програма за стабилизиране', ISOFIX: 'Система ISOFIX',
  'Автоматичен климатик': 'Климатроник', 'Подгряване на предни седалки': 'Подгряване на седалките',
  'Подгряване на задни седалки': 'Подгряване на седалките', 'Вентилирани седалки': 'Вентилация на седалките',
  'Подгряване на волан': 'Отопление на волана', 'Електрически седалки': 'Ел. регулиране на седалките',
  'Панорамен покрив': 'Панорамен люк', 'Парктроник преден': 'Парктроник', 'Парктроник заден': 'Парктроник',
  'Камера за назад': '360 camera \\ Задна камера', '360° камера': '360 camera \\ Задна камера',
  'Apple CarPlay': 'Apple CarPlay \\ Android Auto', 'Android Auto': 'Apple CarPlay \\ Android Auto',
  Bluetooth: 'Bluetooth \\ handsfree система', USB: 'USB, audio\\video, IN\\AUX изводи',
  'Keyless Go': 'Безключово палене', 'Адаптивни фарове': 'Адаптивни предни светлини',
  'Сензор за светлина': 'Датчик за светлина', 'Уред за теглене': 'Теглич',
  'Пневматично окачване': 'Адаптивно въздушно окачване', 'Адаптивно окачване': 'Адаптивно въздушно окачване',
  'Диференциална блокировка': 'Блокаж на диференциала', 'Офроуд пакет': 'OFFROAD пакет',
};

// Some brands are stored under a name Mobile.bg does not list.
const MAKE_ALIASES: Record<string, string> = { RAM: 'Dodge', Volkswagen: 'VW' };

export type PlanStep = {
  selector: string;
  value: string;
  kind: 'select' | 'input' | 'textarea';
  label: string;
  // True when the value came from the draft untouched, so a mismatch with
  // Mobile.bg's own option list can be told apart from a translation we made.
  translated: boolean;
};

export type FillPlan = {
  site: 'mobile.bg';
  title: string;
  steps: PlanStep[];
  extras: string[];
  missing: string[];
};

function resolveValue(key: string, values: Map<string, string>): string {
  const raw = values.get(key) || '';
  if (!raw) return '';
  return VALUE_ALIASES[key]?.[raw] || raw;
}

// Turns a draft into the exact list of choices Mobile.bg has to receive. Kept
// in one place so the extension stays a dumb executor and cannot drift from the
// mapping the worker uses.
export function buildMobileBgPlan(fields: MobileBgDraftField[], extras: MobileBgDraftExtra[] = []): FillPlan {
  const values = new Map(fields.map(field => [field.field_key, String(field.value || '').trim()]));
  const steps: PlanStep[] = [];
  const missing: string[] = [];

  for (const [key, selector] of Object.entries(MOBILE_BG_SELECTORS)) {
    let value = resolveValue(key, values);
    if (key === 'location') {
      value = LOCATION_ALIASES[value] || value;
    } else if (key === 'country') {
      // The draft has no country field: it is joined into the origin value.
      const joined = values.get('location') || '';
      value = COUNTRY_CANDIDATES.find(([, names]) => names.some(name => joined.includes(name)))?.[0] || '';
    } else if (key === 'make') {
      value = MAKE_ALIASES[value] || value;
    }
    if (!value) continue;
    const raw = values.get(key) || '';
    steps.push({
      selector,
      value,
      kind: ['price', 'power', 'displacement', 'mileage', 'vin'].includes(key) ? 'input' : 'select',
      label: key,
      // «country» is derived rather than translated, and every alias is a real
      // change of wording, so this is what the operator needs to see.
      translated: value !== raw,
    });
  }

  const title = values.get('title') || '';
  if (title) steps.push({ selector: 'title', value: title, kind: 'input', label: 'title', translated: false });
  const description = values.get('final_description') || values.get('description') || '';
  if (description) steps.push({ selector: MOBILE_BG_TEXT_SELECTORS.description, value: description, kind: 'textarea', label: 'description', translated: false });

  const derived: string[] = [
    values.get('drivetrain') === '4x4' ? '4x4' : '',
    values.get('doors') === '2/3' ? '2(3) Врати' : values.get('doors') === '4/5' ? '4(5) Врати' : '',
    values.get('seats') === '7' ? '7 места' : '',
    values.get('leasing') === 'Да' ? 'Лизинг' : '',
    values.get('barter') === 'Да' ? 'Бартер' : '',
  ].filter(Boolean);

  const extraLabels = [...new Set([
    ...extras.filter(extra => extra.selected).map(extra => EXTRA_ALIASES[extra.mobile_bg_label] || extra.mobile_bg_label),
    ...derived,
  ])];

  for (const key of ['make', 'model', 'price', 'currency', 'condition', 'fuel', 'gearbox', 'year', 'mileage']) {
    if (!steps.some(step => step.label === key)) missing.push(key);
  }

  return { site: 'mobile.bg', title, steps, extras: extraLabels, missing };
}