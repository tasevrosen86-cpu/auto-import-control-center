// Exercises the rewritten form steps against the existing Mobile.bg stub form.
//
// The stub has no step 2, so the run is expected to stop there. What this test
// proves is the part that was broken: that the mapping tables, the aliases, the
// dependent-list waits and the fill order produce the exact values the report
// records. Those values are read from the POST the stub form sends, so they are
// the form's own view of what was filled, not our own bookkeeping.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { publishOne } from '../src/form.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// The stub lives here rather than under services/mobile-publisher. A test of
// this section must not break when the other section changes its own fixture,
// and that is exactly what happened: the fill order needs f11, «Обяви»'s copy
// of the stub grew f11 in a later commit, and this test failed on a file it
// does not own. The copy is frozen at the shape the proven flow was recorded
// against.
const stubPath = join(here, 'fixtures/mobilebg-form-stub.html');

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

// Serves the stub from a real URL: the step logic navigates by URL, and a
// file:// page would not exercise that path.
async function startStub() {
  const html = await readFile(stubPath, 'utf8');
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/form` };
}

async function run() {
  const { server, url } = await startStub();
  process.env.PUBLICATIONS_FORM_URL = url;
  // The module reads FORM_URL at import time, so it is imported after the URL is
  // known. Re-importing with a cache-busting query gives a fresh module.
  const { publishOne: publish } = await import(`../src/form.mjs?url=${encodeURIComponent(url)}`);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage();
  const context = page.context();
  const cdp = await context.newCDPSession(page);

  // Capture the form's own POST body. This is what actually landed in the form.
  let posted = '';
  page.on('request', (request) => {
    if (request.method() === 'POST') posted = request.postData() || '';
  });

  const session = {
    page,
    send: (method, params) => cdp.send(method, params),
    // The stub has no real photo files, and photos are not what this test is
    // about; staging returns nothing so the run stops at the photo step.
    async stageImages() { return []; },
  };

  // The stub is the simplified form already in the repository, and it only
  // offers the makes, models, colours and years it lists. Row 2942 of the
  // report is an S 550, which this stub does not carry, so the row used here is
  // a Toyota RAV 4 instead: it exists in the stub and it exercises the alias
  // table rather than only the trivial case.
  const item = {
    row: 2942,
    make: 'Toyota',
    model: 'RAV 4',
    year: '2023',
    month: '1',
    mileage: 138512,
    price_eur: 20721,
    horsepower: null,
    body: 'large_suv',
    fuel: 'petrol',
    transmission: 'automatic',
    color: 'black',
    source_images: [],
    description: '',
    phone: '0887353653',
  };

  console.log('Попълване на стъба (RAV 4, alias RAV 4 → Rav4):');
  const result = await publish(session, item);

  const fields = new URLSearchParams(posted);
  const value = (name) => fields.get(name);

  check('марка Toyota (без alias)', value('f5') === 'Toyota', value('f5'));
  check('модел RAV 4 → Rav4 (alias от отчета)', value('f6') === 'Rav4', value('f6'));
  check('гориво petrol → Бензинов', value('f8') === 'Бензинов', value('f8'));
  check('състояние → Употребяван', value('f25') === 'Употребяван', value('f25'));
  check('цена 20721', value('f12') === '20721', value('f12'));
  check('валута EUR', value('f13') === 'EUR', value('f13'));
  check('скорости automatic → Автоматична', value('f10') === 'Автоматична', value('f10'));
  check('каросерия large_suv → Джип', value('f11') === 'Джип', value('f11'));
  check('ДДС с включено', value('f31') === 'Цената е с включено ДДС', value('f31'));
  check('пробег 138512', value('f16') === '138512', value('f16'));
  check('месец 1 → януари (доказаната стойност)', value('f14') === 'януари', value('f14'));
  check('година 2023', value('f15') === '2023', value('f15'));
  check('цвят black → Черен', value('f17') === 'Черен', value('f17'));
  check('място → Извън страната', value('f18') === 'Извън страната', value('f18'));
  check('държава → Канада (заредена след f11/f18)', value('f19') === 'Канада', value('f19'));
  check('телефон 0887353653', value('f22') === '0887353653', value('f22'));
  // The report is explicit that the proven script kept an empty description
  // empty: the Hyundai batch passed description: "" on purpose. Only a missing
  // value falls back to the placeholder, which the second run below checks.
  check('празно описание остава празно (както в доказания скрипт)', (value('f21') || '') === '', JSON.stringify(value('f21')));
  check('f9 остава празно при липсваща мощност', (value('f9') || '') === '', value('f9'));

  // Second run with the description absent entirely, to prove the fallback is
  // reached when the value is missing rather than empty.
  posted = '';
  const noDescription = { ...item };
  delete noDescription.description;
  noDescription.model = 'Camry';
  await publish(session, noDescription);
  const fallbackFields = new URLSearchParams(posted);
  check('липсващо описание → fallback текстът',
    fallbackFields.get('f21') === '!!!реална крайна цена!!!', JSON.stringify(fallbackFields.get('f21')));

  // Third run with the colour absent, which is what the extraction now sends for
  // a colour it does not recognise ("and Upholstery"). The listing must still
  // reach step 1 instead of stopping on an unusable colour.
  posted = '';
  const noColour = { ...item, color: '' };
  const colourResult = await publish(session, noColour);
  const colourFields = new URLSearchParams(posted);
  check('непознат цвят не спира публикацията (стига до стъпка 1)',
    /step2_not_reached/.test(colourResult.message || ''), colourResult.message);
  check('непознат цвят не се записва като стойност',
    (colourFields.get('f17') || '') === '', JSON.stringify(colourFields.get('f17')));
  check('останалите полета влизат въпреки липсващия цвят',
    colourFields.get('f5') === 'Toyota' && colourFields.get('f19') === 'Канада' && colourFields.get('f11') === 'Джип',
    JSON.stringify({ f5: colourFields.get('f5'), f11: colourFields.get('f11'), f19: colourFields.get('f19') }));

  console.log('');
  check('стъпка 1 е изпратена (стъбът няма стъпка 2, спира там)',
    /step2_not_reached/.test(result.message || ''), result.message);
  check('резултатът е failed, не published', result.state === 'failed', result.state);

  await browser.close();
  server.close();

  console.log(`\n${passed} успешни, ${failed} неуспешни`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => { console.error('ГРЕШКА:', error); process.exit(1); });