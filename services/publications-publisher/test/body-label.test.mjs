// Guards «Категория» end to end: a draft value must survive into the exact
// option wording Mobile.bg shows, and must never become empty.
//
// The old body() re-translated keys that were already in BODY_LABELS, so a «van»
// was posted as «Джип». Fixing that by returning "" for an unknown style looked
// right but broke the other end: preflight requires a body style, so an unknown
// style blocked the listing before the browser opened. This test pins both ends.

import { body } from '../src/index.mjs';
import { BODY_LABELS } from '../src/mappings.mjs';
import { preflight } from '../src/preflight.mjs';

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

// Every internal key the intake worker can emit must keep its own wording.
for (const key of Object.keys(BODY_LABELS)) {
  const mapped = body(key);
  check(`вътрешен ключ «${key}» остава «${BODY_LABELS[key]}»`, mapped === key, `получено «${mapped}»`);
}

// Mobile.bg's own wording is accepted too, for a manually entered draft.
for (const [text, expected] of [['Джип', 'large_suv'], ['Пикап', 'pickup'], ['Седан', 'sedan'], ['Кабрио', 'convertible'], ['Ван', 'van'], ['Купе', 'coupe'], ['Комби', 'wagon'], ['Хечбек', 'hatchback']]) {
  check(`текст «${text}» → «${expected}»`, body(text) === expected, `получено «${body(text)}»`);
}

// The regression that broke a listing: empty must not be produced, because
// preflight treats it as missing data and refuses to publish.
for (const value of ['', null, undefined, 'Nonsense', '   ']) {
  const mapped = body(value);
  check(`непознато ${JSON.stringify(value)} не дава празно`, Boolean(mapped), `получено «${mapped}»`);
}

const base = {
  source_url: 'https://www.autotrader.ca/a/x/1', price_eur: 20000, make: 'Dodge', model: 'RAM',
  year: 2023, mileage: 1000, fuel: 'petrol', transmission: 'automatic', source_images: ['a.jpg'],
};
// This is the exact sequence index.mjs uses: body() feeds preflight.
for (const draftValue of ['van', 'convertible', 'other', '', 'Nonsense']) {
  const item = { ...base, body: body(draftValue) };
  const result = preflight(item);
  check(`чернова «${draftValue}» минава preflight като «${BODY_LABELS[item.body]}»`, result.ok,
    result.failures.map(f => f.message).join(' '));
}

console.log(`\n${passed} успешни, ${failed} неуспешни`);
process.exit(failed === 0 ? 0 : 1);
