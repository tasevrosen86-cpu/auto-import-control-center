// The deterministic translation tables from the proven direct publisher
// (run-mobilebg-direct-v19-batch.mjs, section 4 and 4.1 of the report).
//
// Copied rather than re-derived: Mobile.bg accepts only its own option wording,
// and these are the strings the session that published the real listings sent.
// Anything not in these tables is reported as an unknown value instead of being
// guessed, because a near-miss option is worse than a stopped row.

export const FUEL_LABELS = {
  petrol: 'Бензинов',
  diesel: 'Дизелов',
  electric: 'Електрически',
  hybrid: 'Хибриден',
};

export const TRANSMISSION_LABELS = {
  automatic: 'Автоматична',
  manual: 'Ръчна',
  'semi-automatic': 'Полуавтоматична',
};

export const BODY_LABELS = {
  van: 'Ван',
  large_suv: 'Джип',
  small_suv: 'Джип',
  pickup: 'Пикап',
  coupe: 'Купе',
  convertible: 'Кабрио',
  wagon: 'Комби',
  hatchback: 'Хечбек',
  sedan: 'Седан',
  other: 'Други',
};

export const COLOR_LABELS = {
  white: 'Бял',
  black: 'Черен',
  grey: 'Сив',
  silver: 'Сребърен',
  blue: 'Син',
  red: 'Червен',
  brown: 'Кафяв',
  green: 'Зелен',
  orange: 'Оранжев',
  beige: 'Бежов',
  gold: 'Златист',
};

// Make aliases: the source name as Mobile.bg spells it.
export const MAKE_ALIASES = { RAM: 'Dodge', Volkswagen: 'VW' };

// Model aliases, exact pairs from the report. Matched on the source make and
// model together, because «1500» means different things under RAM and GMC.
export const MODEL_ALIASES = [
  ['RAM', '1500', 'RAM 1500'],
  ['MINI', 'Cooper Countryman', 'Countryman'],
  ['MINI', 'Cooper Clubman', 'Clubman'],
  ['MINI', '3 Door', 'Cooper s'],
  ['Nissan', 'Titan', 'Titan crew cab'],
  ['Nissan', 'Titan XD', 'Titan crew cab'],
  ['Ford', 'F 150', 'F150'],
  ['Toyota', 'RAV 4', 'Rav4'],
  ['Chevrolet', 'Unspecified', 'Blazer'],
];

// GMC and Chevrolet use a prefix rather than an exact pair, so they are kept as
// predicates next to the exact table instead of being forced into it.
const PREFIX_ALIASES = [
  { make: 'GMC', startsWith: 'Sierra', model: 'Sierra' },
  { make: 'Chevrolet', startsWith: 'Silverado', model: 'Silverado' },
];

export function makeLabel(make) {
  return MAKE_ALIASES[make] || make;
}

export function modelLabel(make, model) {
  const exact = MODEL_ALIASES.find(([m, source]) => m === make && source === model);
  if (exact) return exact[2];
  const prefixed = PREFIX_ALIASES.find((a) => a.make === make && String(model || '').startsWith(a.startsWith));
  return prefixed ? prefixed.model : model;
}

// «other» is not a body style on the form, so the proven script picked one from
// the make. Kept exactly as it was, including the Dodge/RAM case.
export function bodyLabel(item) {
  if (item.body && item.body !== 'other') return BODY_LABELS[item.body] || '';
  if (item.make === 'Mercedes-Benz') return 'Седан';
  if (item.make === 'Dodge' || item.make === 'RAM') return 'Пикап';
  return 'Джип';
}

export function fuelLabel(value) {
  return FUEL_LABELS[value] || '';
}

export function transmissionLabel(value) {
  return TRANSMISSION_LABELS[value] || '';
}

export function colorLabel(value) {
  return COLOR_LABELS[String(value || '').toLowerCase()] || '';
}