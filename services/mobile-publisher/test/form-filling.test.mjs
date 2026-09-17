// Exercises the real form-filling against a stub of the Mobile.bg form.
//
// The stub reproduces the two behaviours that broke publishing and that a
// mocked test would not catch:
//   * the model and country option lists arrive after the field they depend on
//     is chosen, so reading them straight away finds an empty list;
//   * the origin is split across two controls, f18 for the area and f19 for the
//     country.
//
// Run with: npm test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-key';
process.env.MOBILE_BG_USER_DATA_DIR ||= join(tmpdir(), 'aicc-mobile-bg-test');

const here = dirname(fileURLToPath(import.meta.url));
const { populateStepOneForTest: populateStepOne } = await import('../src/index.ts');

const html = await readFile(join(here, 'mobilebg-form-stub.html'), 'utf8');
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];

const readForm = () => page.evaluate(() => {
  const form = document.forms.namedItem('pub');
  const value = (name) => {
    const element = form.elements[name];
    if (!element) return '<поле липсва>';
    if (element.tagName === 'SELECT') {
      const chosen = [...element.options].find((option) => option.value === element.value);
      return chosen ? chosen.text.trim() : '';
    }
    return element.value;
  };
  return {
    make: value('f5'), model: value('f6'), fuel: value('f8'), condition: value('f25'),
    month: value('f14'), year: value('f15'), location: value('f18'), country: value('f19'),
    color: value('f17'), title: value('title'), description: value('f21'), vin: value('f32'),
  };
});

async function scenario(name, fields, expected) {
  await page.goto(url);
  const result = await populateStepOne(page, fields, []);
  const actual = await readForm();
  console.log(`\n=== ${name} ===`);
  console.log('попълнени:', result.filled.join(', ') || '(никой)');
  console.log('пропуснати:', result.skipped.map((entry) => `${entry.key} — ${entry.reason}`).join(' | ') || '(никое)');
  console.log('във формата:', JSON.stringify(actual));
  if (result.blockedBy) console.log('спряно от:', result.blockedBy.join(', '));
  for (const [key, want] of Object.entries(expected)) {
    if (actual[key] !== want) failures.push(`${name}: ${key} — очаквано "${want}", получено "${actual[key]}"`);
  }
  return result;
}

const canadaFields = [
  { field_key: 'title', value: 'Dodge RAM 1500 2023' },
  { field_key: 'make', value: 'Dodge' },
  { field_key: 'model', value: 'RAM 1500' },
  { field_key: 'fuel', value: 'Дизел' },
  { field_key: 'condition', value: 'Използван' },
  { field_key: 'price', value: '42000' },
  { field_key: 'currency', value: 'EUR' },
  { field_key: 'gearbox', value: 'Автоматична' },
  { field_key: 'vat_included', value: 'Да' },
  { field_key: 'mileage', value: '51000' },
  { field_key: 'month', value: 'Април' },
  { field_key: 'year', value: '2023' },
  { field_key: 'location', value: 'Извън страната → Канада' },
  { field_key: 'description', value: 'Тестово описание' },
];
const withKorea = canadaFields.map((field) => {
  if (field.field_key === 'location') return { field_key: 'location', value: 'Извън страната → Южна Корея' };
  if (field.field_key === 'make') return { field_key: 'make', value: 'Kia' };
  if (field.field_key === 'model') return { field_key: 'model', value: 'Sorento' };
  return field;
});

// The dependent lists must be waited for, and the joined origin must be split.
await scenario('пълна канадска чернова', canadaFields, {
  title: 'Dodge RAM 1500 2023',
  make: 'Dodge', model: 'RAM 1500', month: 'април',
  condition: 'Употребяван', fuel: 'Дизелов',
  location: 'Извън страната', country: 'Канада', description: 'Тестово описание',
});

await scenario('пълна корейска чернова', withKorea, { country: 'Южна Корея', model: 'Sorento' });

// An optional value that does not exist must be reported, not fatal: colour and
// VIN, the Canada-only extras and the modification stay free for the broker.
const optionalGap = await scenario('незадължителен цвят без съвпадение', [...canadaFields, { field_key: 'color', value: 'Червен' }, { field_key: 'vin', value: '1FTFW1E84MFA00000' }], { color: '-', vin: '1FTFW1E84MFA00000' });
if (optionalGap.blockedBy) failures.push('незадължителен цвят спря обявата, а не трябва');
if (!optionalGap.skipped.some((entry) => entry.key === 'color')) failures.push('незадължителният цвят не беше отчетен като пропуснат');

// A required value that does not exist must stop the run and name itself.
const requiredGap = await scenario('задължителен модел без съвпадение', [
  ...canadaFields.filter((field) => !['model', 'description'].includes(field.field_key)),
  { field_key: 'model', value: 'НямаТакъвМодел' },
], {});
if (!requiredGap.blockedBy?.includes('model')) failures.push('липсващ задължителен модел не спря обявата');

// An empty draft must not crash.
await scenario('празна чернова', [], {});

await browser.close();
server.close();

console.log('\n================ РЕЗУЛТАТ ================');
if (failures.length) {
  for (const failure of failures) console.log(' ПРОВАЛ:', failure);
  process.exitCode = 1;
} else {
  console.log('Всички проверки минаха.');
}