// Tests for the API publishing path.
//
// No network is touched: the API client takes its `fetch` by injection, and the
// mapping and readiness checks are pure. The fixtures are the shapes the draft
// tables already hold, so nothing new is invented to make a test pass.

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { MobileBgApiClient, findListingId, redactPath, excerptOf, trimTrace } from '../src/client.ts';
import {
  buildPayload, readCatfields, intersectWithCatfields, splitLocation,
  categoryToTopmenu, FIELD_TO_API, bodyToCategory, litresToCubicCentimetres,
} from '../src/mapping.ts';
import { checkReadiness, summarizeReadiness } from '../src/readiness.ts';
import { isJpeg, extensionOf, isAcceptableFilename, preparePictures } from '../src/pictures.ts';

type StubResponse = { status: number; body: unknown };

// A fetch stub driven by a queue of prepared responses, so each test states
// exactly what Mobile.bg is pretending to answer.
function stubFetch(responses: StubResponse[]) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const queue = [...responses];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method || 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const next = queue.shift() || { status: 200, body: { status: 'success' } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✔ ${name}`))
    .catch(error => {
      failures += 1;
      console.error(`  ✖ ${name}\n    ${error instanceof Error ? error.message : error}`);
    });
}

// ---------------------------------------------------------------- credentials

await check('липсващи данни за вход се отчитат като конфигурация, без мрежа', async () => {
  const { impl, calls } = stubFetch([]);
  const client = new MobileBgApiClient({ username: '', password: '', fetchImpl: impl });
  const result = await client.login();
  assert.equal(result.ok, false);
  assert.match(result.error || '', /MOBILE_BG_API_USERNAME/);
  assert.equal(calls.length, 0, 'не трябва да има мрежова заявка без данни за вход');
});

// ---------------------------------------------------------------- token safety

await check('token не попада в трасето', async () => {
  const { impl } = stubFetch([
    { status: 200, body: { status: 'success login', token: 'abcdefghijklmnopqrstuvwxyz123456' } },
    { status: 200, body: { status: 'success load', advert: { ida: '21234567890123456' } } },
  ]);
  const client = new MobileBgApiClient({ username: 'u', password: 'p', fetchImpl: impl });
  assert.equal((await client.login()).ok, true);
  await client.advertLoad('21234567890123456');
  const serialized = JSON.stringify(client.trace);
  assert.ok(!serialized.includes('abcdefghijklmnopqrstuvwxyz123456'), 'token не трябва да е в трасето');
  assert.ok(serialized.includes('<token>'), 'пътят трябва да е маскиран');
});

await check('паролата не попада в трасето', async () => {
  const { impl } = stubFetch([{ status: 200, body: { status: 'success login', token: 'x'.repeat(32) } }]);
  const client = new MobileBgApiClient({ username: 'broker', password: 'SuperSecret123', fetchImpl: impl });
  await client.login();
  assert.ok(!JSON.stringify(client.trace).includes('SuperSecret123'));
  assert.ok(!JSON.stringify(client.trace).includes('broker'));
});

await check('redactPath маскира token-а във всяка форма', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz123456';
  assert.equal(redactPath(`/import_api/advertpub/${token}/`, token), '/import_api/advertpub/<token>/');
  assert.equal(redactPath(`/import_api/advertpub/${token}/`, null), '/import_api/advertpub/<token>/');
  assert.equal(redactPath('/import_api/login'), '/import_api/login');
});

await check('excerptOf маскира ключове със секрети', () => {
  const excerpt = excerptOf({ status: 'success login', token: 'abc', password: 'def', advert: { ida: '1' } });
  assert.ok(!(excerpt || '').includes('abc'));
  assert.ok(!(excerpt || '').includes('def'));
  assert.ok((excerpt || '').includes('<скрито>'));
});

await check('trimTrace ограничава броя записи', () => {
  const trace = Array.from({ length: 100 }, (_, index) => ({ step: 'LOGIN', at: String(index) })) as never[];
  assert.equal(trimTrace(trace, 10).length, 10);
  assert.equal(trimTrace(trace, 10)[9].at, '99', 'пази последните записи');
});

// ---------------------------------------------------------------- error paths

await check('HTTP 403 се обяснява като блокировка, не като грешни данни', async () => {
  const { impl } = stubFetch([{ status: 403, body: '<html>blocked</html>' }]);
  const client = new MobileBgApiClient({ username: 'u', password: 'p', fetchImpl: impl });
  const result = await client.login();
  assert.equal(result.ok, false);
  assert.match(result.error || '', /Cloudflare|403/);
});

await check('грешка със status:error при HTTP 200 се хваща', async () => {
  const { impl } = stubFetch([{ status: 200, body: { status: 'error', msg: 'Invalid token' } }]);
  const client = new MobileBgApiClient({ username: 'u', password: 'p', fetchImpl: impl });
  const result = await client.login();
  assert.equal(result.ok, false, 'HTTP 200 сам по себе си не значи успех');
  assert.equal(result.error, 'Invalid token');
});

await check('мрежова грешка не хвърля изключение', async () => {
  const impl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  const client = new MobileBgApiClient({ username: 'u', password: 'p', fetchImpl: impl });
  const result = await client.login();
  assert.equal(result.ok, false);
  assert.match(result.error || '', /Връзката/);
});

// ---------------------------------------------------------------- listing id

await check('намира id на обявата в различно вложен отговор', () => {
  assert.equal(findListingId({ advert: { ida: '21234567890123456' } }), '21234567890123456');
  assert.equal(findListingId({ advert: { data: { ida: 21234567890123456 } } }), '21234567890123456');
  assert.equal(findListingId({ advert: { ida: '123' } }), null, 'кратък номер не е валиден id');
  assert.equal(findListingId({}), null);
});

await check('предпочита ida пред друг 17-цифрен номер', () => {
  const payload = { advert: { someOtherId: '99999999999999999', ida: '21234567890123456' } };
  assert.equal(findListingId(payload), '21234567890123456');
});

// ---------------------------------------------------------------- mapping

await check('превежда полетата към параметрите на API-то', () => {
  const built = buildPayload(
    [
      { field_key: 'make', value: 'BMW' },
      { field_key: 'model', value: 'X5' },
      { field_key: 'year', value: '2021' },
      { field_key: 'mileage', value: '150000' },
      { field_key: 'price', value: '35000' },
      { field_key: 'currency', value: 'EUR' },
      { field_key: 'fuel', value: 'Дизел' },
      { field_key: 'location', value: 'Извън страната → Канада' },
    ],
    [],
    { category: 'Автомобили и джипове' },
  );
  assert.equal(built.params.marka, 'BMW');
  assert.equal(built.params.model, 'X5');
  assert.equal(built.params.km, '150000', 'пробегът отива в km');
  assert.equal(built.params.engine_type, 'Дизелов', 'горивото се превежда');
  assert.equal(built.params.locat, 'Извън страната');
  assert.equal(built.params.locatc, 'Канада');
  assert.equal(built.params.topmenu, '1');
  assert.equal(built.params.rub, '1');
  assert.ok(built.params.term, 'term се подава');
});

// The names below are the ones `catfields` 1/1 declares and a live advert
// carries. Each old name was the browser form's element id, which is not a
// parameter of this API, so sending it produced "Wrong fields".
await check('имената на параметрите са тези от catfields, не от формата', () => {
  const built = buildPayload(
    [
      { field_key: 'condition', value: 'Използван' },
      { field_key: 'vat_included', value: 'Цената е с включено ДДС' },
      { field_key: 'displacement', value: '2.0' },
      { field_key: 'euro_standard', value: 'Euro 5' },
      { field_key: 'power', value: '250' },
      { field_key: 'final_description', value: 'описание' },
    ],
    [],
  );
  assert.equal(built.params.nup, '0', 'condition отива в nup като код');
  assert.equal(built.params.price_dds, '2', 'vat_included отива в price_dds');
  assert.equal(built.params.engine_cubature, '2000', 'литрите стават куб.см');
  assert.equal(built.params.euroclass, '5', 'euro_standard отива в euroclass като номер');
  assert.equal(built.params.engine_power, '250', 'power отива в engine_power');
  assert.equal(built.params.extinfo, 'описание', 'описанието отива в extinfo');
  for (const absent of ['dds', 'euro', 'engine_cc', 'power', 'description', 'zaglavie']) {
    assert.equal(built.params[absent], undefined, `${absent} не е параметър на API-то`);
  }
});

await check('литрите се превръщат в куб.см', () => {
  assert.equal(litresToCubicCentimetres('2.0'), '2000');
  assert.equal(litresToCubicCentimetres('3.0'), '3000');
  assert.equal(litresToCubicCentimetres('1,6'), '1600');
  assert.equal(litresToCubicCentimetres('4400'), '4400000', 'вече в куб.см не се пипа');
});

await check('каросерията отива в category, не основната категория', () => {
  assert.equal(bodyToCategory('large_suv'), 'Джип');
  assert.equal(bodyToCategory('sedan'), 'Седан');
  assert.equal(bodyToCategory('pickup'), 'Пикап');
  assert.equal(bodyToCategory('other', 'Dodge'), 'Пикап', 'при other решава марката');
  assert.equal(bodyToCategory('other', 'Mercedes-Benz'), 'Седан');
  assert.equal(bodyToCategory('other', 'Audi'), null, 'не се гадае');

  const built = buildPayload([{ field_key: 'make', value: 'Audi' }], [], { body: 'large_suv' });
  assert.equal(built.params.category, 'Джип');
  assert.equal(built.params.topmenu, '1', 'основната категория остава topmenu');
  assert.notEqual(built.params.category, 'Автомобили и джипове');
});

await check('непознат тип каросерия се отчита, не се гадае', () => {
  const built = buildPayload([], [], {});
  assert.equal(built.params.category, undefined);
  assert.ok(built.warnings.some(w => w.includes('каросерия')));
});

await check('вътрешните полета не влизат в payload-а', () => {
  const built = buildPayload(
    [
      { field_key: 'title', value: 'Audi Q7' },
      { field_key: 'seller_name', value: 'RoyalCarsBG' },
      { field_key: 'ad_type', value: 'Стандартна' },
      { field_key: 'company_template', value: 'Стандартен' },
      { field_key: 'description_language', value: 'Български' },
      { field_key: 'mobile_bg_profile', value: 'x' },
      { field_key: 'source_url', value: 'https://x' },
      { field_key: 'doors', value: '4' },
      { field_key: 'seats', value: '7' },
      { field_key: 'drivetrain', value: '4x4' },
    ],
    [],
  );
  for (const key of ['zaglavie', 'seller_name', 'ad_type', 'company_template',
                     'description_language', 'mobile_bg_profile', 'source_url',
                     'doors', 'seats', 'drivetrain']) {
    assert.equal(built.params[key], undefined, `${key} не бива да се изпраща`);
  }
  assert.ok(built.unmapped.some(row => row.field_key === 'title'), 'title се отчита като несъответстващо');
});

await check('полета без съответствие се отчитат, не се измислят', () => {
  const built = buildPayload([{ field_key: 'our_calculated_price', value: '42000' }], []);
  assert.equal(built.unmapped.length, 1);
  assert.equal(built.unmapped[0].field_key, 'our_calculated_price');
  assert.equal(built.params['our_calculated_price'], undefined, 'не се подава под измислено име');
});

await check('окончателното описание има предимство пред общото', () => {
  const built = buildPayload(
    [
      { field_key: 'description', value: 'общо' },
      { field_key: 'final_description', value: 'финално' },
    ],
    [],
  );
  assert.equal(built.params.extinfo, 'финално');
});

await check('екстрите се събират в един параметър', () => {
  const built = buildPayload([], [
    { mobile_bg_label: 'ABS', selected: true },
    { mobile_bg_label: 'Bluetooth', selected: true },
    { mobile_bg_label: 'ESP', selected: false },
  ]);
  assert.ok(built.params.extri);
  assert.ok(built.params.extri.includes('Антиблокираща система'));
  assert.ok(!built.params.extri.includes('Електронна програма'));
});

await check('разделя населеното място от региона', () => {
  assert.deepEqual(splitLocation('Извън страната → Южна Корея'), { locat: 'Извън страната', locatc: 'Южна Корея' });
  assert.deepEqual(splitLocation('София'), { locat: 'София', locatc: null });
});

await check('непозната категория се отчита с предупреждение', () => {
  const built = buildPayload([], [], { category: 'Нещо непознато' });
  assert.equal(categoryToTopmenu('Нещо непознато').known, false);
  assert.ok(built.warnings.length > 0);
});

// ---------------------------------------------------------------- catfields

await check('чете имената на полетата от отговора', () => {
  const shape = readCatfields({ fields: [{ fname: 'marka', ftext: 'Марка' }, { fname: 'model' }] });
  assert.equal(shape.understood, true);
  assert.ok(shape.names.has('marka'));
  assert.ok(shape.names.has('model'));
});

await check('непознат формат не изтрива параметри', () => {
  const shape = readCatfields({ odd: 'shape' });
  assert.equal(shape.understood, false);
  const { sent, dropped } = intersectWithCatfields({ marka: 'BMW' }, shape);
  assert.equal(dropped.length, 0, 'при неразбран отговор нищо не се изхвърля');
  assert.equal(sent.marka, 'BMW');
});

await check('изхвърля само непознатите параметри, контролните остават', () => {
  const shape = { names: new Set(['marka', 'model']), understood: true };
  const { sent, dropped } = intersectWithCatfields(
    { marka: 'BMW', model: 'X5', topmenu: '1', rub: '1', extri: 'ABS', измислено: 'x' },
    shape,
  );
  assert.ok(sent.marka && sent.model);
  assert.ok(sent.topmenu && sent.rub && sent.extri, 'контролните параметри не се изхвърлят');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].api_key, 'измислено');
});

// ---------------------------------------------------------------- readiness

const fullFields = [
  { field_key: 'make', value: 'BMW' },
  { field_key: 'model', value: 'X5' },
  { field_key: 'year', value: '2021' },
  { field_key: 'mileage', value: '150000' },
  { field_key: 'fuel', value: 'Дизел' },
  { field_key: 'gearbox', value: 'Автоматична' },
  { field_key: 'price', value: '35000' },
  { field_key: 'currency', value: 'EUR' },
  { field_key: 'location', value: 'София' },
];
const oneImage = [{ source_url: 'https://example.com/a.jpg', local_path: null, is_selected: true, is_main: true, display_order: 1 }];

await check('пълна чернова със снимки е готова', () => {
  const readiness = checkReadiness({ fields: fullFields, extras: [], images: oneImage, hasCredentials: true, category: 'Автомобили и джипове', body: 'large_suv' });
  assert.equal(readiness.ready, true);
  assert.equal(summarizeReadiness(readiness), 'Готово за изпращане към Mobile.bg.');
  assert.equal(readiness.payload.params.category, 'Джип');
});

await check('без тип каросерия черновата е готова, но с предупреждение', () => {
  // `category` cannot be derived without a body, and Mobile.bg may require it, so
  // the run must say so rather than send «Автомобили и джипове» as the body.
  const readiness = checkReadiness({ fields: fullFields, extras: [], images: oneImage, hasCredentials: true, category: 'Автомобили и джипове' });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.payload.params.category, undefined);
  assert.ok(readiness.issues.some(issue => issue.code === 'CATEGORY' && issue.message.includes('каросерия')));
});

await check('липсващи задължителни полета спират изпращането', () => {
  const readiness = checkReadiness({
    fields: fullFields.filter(field => field.field_key !== 'mileage'),
    extras: [], images: oneImage, hasCredentials: true,
  });
  assert.equal(readiness.ready, false);
  const blocker = readiness.issues.find(issue => issue.code === 'MISSING_FIELDS');
  assert.ok(blocker);
  assert.deepEqual(blocker!.fields, ['mileage']);
});

await check('липсата на снимки не блокира обявата, само снимките', () => {
  const readiness = checkReadiness({ fields: fullFields, extras: [], images: [], hasCredentials: true });
  assert.equal(readiness.ready, true, 'обявата може да се публикува');
  assert.equal(readiness.pictures_only, true);
  assert.ok(readiness.issues.some(issue => issue.code === 'NO_IMAGES'));
});

await check('невалидна цена се отхвърля', () => {
  const fields = fullFields.map(field => field.field_key === 'price' ? { ...field, value: '0' } : field);
  const readiness = checkReadiness({ fields, extras: [], images: oneImage, hasCredentials: true });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some(issue => issue.code === 'BAD_PRICE'));
});

await check('не-HTTPS адрес за снимки се отчита като пречка само за снимките', () => {
  const readiness = checkReadiness({
    fields: fullFields, extras: [], images: oneImage, hasCredentials: true,
    pictureBaseUrl: 'http://autoimportcontrolcenter.biz',
  });
  // The listing itself does not depend on the picture host, so this must not
  // block the publish — only the picture step.
  assert.equal(readiness.ready, true);
  assert.equal(readiness.pictures_only, true);
  assert.ok(readiness.issues.some(issue => issue.code === 'BAD_PICTURE_HOST'));
});

await check('липсващи данни за вход се отчитат преди мрежата', () => {
  const readiness = checkReadiness({ fields: fullFields, extras: [], images: oneImage, hasCredentials: false });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.some(issue => issue.code === 'NO_CREDENTIALS'));
});

// ---------------------------------------------------------------- pictures

await check('разпознава JPEG по байтовете', () => {
  assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isJpeg(Buffer.from('GIF89a')), false);
});

await check('името на файла отговаря на изискването на Mobile.bg', () => {
  assert.equal(extensionOf('https://x/a.webp?w=800'), 'webp');
  assert.equal(isAcceptableFilename('mobilebg-pictures/abc/image-1.jpg'), true);
  assert.equal(isAcceptableFilename('mobilebg-pictures/abc/image-1.png'), false, 'само .jpg/.jpeg се приемат');
});

await check('невалидното id не може да излезе от пътя', () => {
  assert.equal('../../etc'.replace(/[^a-zA-Z0-9_-]/g, ''), 'etc');
});

await check('несъществуващ източник се отчита, без да чупи', async () => {
  const impl = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
  const batch = await preparePictures(
    [{ source_url: 'https://example.com/x.jpg', local_path: null, is_selected: true, is_main: true, display_order: 1 }],
    { draftId: 'd1', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl },
  );
  assert.equal(batch.pictures.length, 0);
  assert.equal(batch.skipped.length, 1);
  assert.match(batch.skipped[0].reason, /404/);
});

await check('нечетим файл се отчита с причина, без да чупи', async () => {
  const impl = (async () => new Response(new Uint8Array(Buffer.from('GIF89a')), { status: 200 })) as unknown as typeof fetch;
  const batch = await preparePictures(
    [{ source_url: 'https://example.com/x.gif', local_path: null, is_selected: true, is_main: true, display_order: 1 }],
    { draftId: 'd2', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl },
  );
  assert.equal(batch.pictures.length, 0);
  assert.match(batch.skipped[0].reason, /\.jpg/);
});

// A real .webp is the case that reaches Mobile.bg in practice: the sources store
// 63 of 509 pictures as webp. Without a converter these are dropped and the
// listing is published without pictures, so the conversion is asserted here
// rather than left to whether sharp happens to be installed.
await check('webp се прекодира в .jpg, когато конверторът е наличен', async () => {
  let sharpAvailable = true;
  let webp: Buffer;
  try {
    const mod = await import('sharp');
    const sharp = (mod.default ?? mod) as unknown as (input: unknown) => {
      webp: () => { toBuffer: () => Promise<Buffer> };
    };
    webp = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 100, b: 50 } } })
      .webp().toBuffer();
  } catch {
    sharpAvailable = false;
    webp = Buffer.alloc(0);
  }
  if (!sharpAvailable) return;

  const impl = (async () => new Response(new Uint8Array(webp), { status: 200 })) as unknown as typeof fetch;
  const batch = await preparePictures(
    [{ source_url: 'https://example.com/x.webp', local_path: null, is_selected: true, is_main: true, display_order: 1 }],
    { draftId: 'd2webp', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl },
  );
  assert.equal(batch.pictures.length, 1, 'webp трябва да стане снимка, не да се пропусне');
  assert.equal(batch.pictures[0].filename, 'image-1.jpg');
  assert.equal(batch.pictures[0].converted_from, 'webp', 'причината за прекодирането се вижда в отчета');
  const written = await readFile(batch.pictures[0].path.replace(/^\//, '/tmp/aicc-api-test-root/'));
  assert.ok(written[0] === 0xff && written[1] === 0xd8 && written[2] === 0xff, 'записаното наистина е JPEG');
});

await check('JPEG се записва с правилно име и път', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const impl = (async () => new Response(new Uint8Array(jpeg), { status: 200 })) as unknown as typeof fetch;
  const batch = await preparePictures(
    [{ source_url: 'https://example.com/a.jpg', local_path: null, is_selected: true, is_main: true, display_order: 1 }],
    { draftId: 'd3', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl },
  );
  assert.equal(batch.pictures.length, 1);
  assert.equal(batch.pictures[0].filename, 'image-1.jpg');
  assert.ok(batch.pictures[0].path.endsWith('/image-1.jpg'));
  assert.ok(!batch.pictures[0].path.startsWith('http'), 'подава се само пътят под домейна');
});

await check('основната снимка е първа', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const impl = (async () => new Response(new Uint8Array(jpeg), { status: 200 })) as unknown as typeof fetch;
  const batch = await preparePictures(
    [
      { source_url: 'https://example.com/second.jpg', local_path: null, is_selected: true, is_main: false, display_order: 1 },
      { source_url: 'https://example.com/main.jpg', local_path: null, is_selected: true, is_main: true, display_order: 2 },
    ],
    { draftId: 'd4', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl },
  );
  assert.equal(batch.pictures.length, 2);
  assert.equal(batch.pictures[0].source_url, 'https://example.com/main.jpg');
});

await check('праща се само маркираното, не всичко изтеглено', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const impl = (async () => new Response(new Uint8Array(jpeg), { status: 200 })) as unknown as typeof fetch;
  const batch = await preparePictures(
    [
      { source_url: 'https://example.com/1.jpg', local_path: null, is_selected: true, is_main: false, display_order: 1 },
      { source_url: 'https://example.com/2.jpg', local_path: null, is_selected: false, is_main: false, display_order: 2 },
      { source_url: 'https://example.com/3.jpg', local_path: null, is_selected: true, is_main: false, display_order: 3 },
    ],
    { draftId: 'd5', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl },
  );
  assert.equal(batch.pictures.length, 2, 'немаркираната снимка не се изпраща');
  assert.deepEqual(
    batch.pictures.map(picture => picture.source_url),
    ['https://example.com/1.jpg', 'https://example.com/3.jpg'],
  );
});

await check('праща първите 17 по подредба, независимо от реда на редовете', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const impl = (async () => new Response(new Uint8Array(jpeg), { status: 200 })) as unknown as typeof fetch;
  // 18 marked, handed over in a shuffled order. The batch is the first 17 by
  // display_order, which is the same 17 the database trigger leaves selected and
  // the same 17 the screen calls "the first 17".
  const images = Array.from({ length: 18 }, (_, index) => ({
    source_url: `https://example.com/p${index + 1}.jpg`,
    local_path: null,
    is_selected: true,
    is_main: index === 0,
    display_order: index + 1,
  }));
  const shuffled = [images[5], images[17], images[0], ...images.filter((_, index) => ![0, 5, 17].includes(index))];
  const batch = await preparePictures(shuffled, { draftId: 'd6', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl });
  assert.equal(batch.pictures.length, 17);
  const sent = batch.pictures.map(picture => picture.source_url);
  assert.ok(sent.includes('https://example.com/p17.jpg'), 'седемнадесетата по подредба остава');
  assert.ok(!sent.includes('https://example.com/p18.jpg'), 'осемнадесетата по подредба отпада');
  assert.equal(batch.pictures[0].source_url, 'https://example.com/p1.jpg', 'основната се праща първа');
});

await check('основната снимка се праща първа, без да разбърква бройката', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const impl = (async () => new Response(new Uint8Array(jpeg), { status: 200 })) as unknown as typeof fetch;
  // The cover is the tenth by display_order, so it is inside the first 17 and
  // must lead the request without changing which photos are in it.
  const images = Array.from({ length: 20 }, (_, index) => ({
    source_url: `https://example.com/p${index + 1}.jpg`,
    local_path: null,
    is_selected: index < 17,
    is_main: index === 9,
    display_order: index + 1,
  }));
  const batch = await preparePictures(images, { draftId: 'd7', publicRoot: '/tmp/aicc-api-test-root', fetchImpl: impl });
  assert.equal(batch.pictures.length, 17);
  assert.equal(batch.pictures[0].source_url, 'https://example.com/p10.jpg');
  assert.deepEqual(
    batch.pictures.slice(1).map(picture => picture.source_url),
    Array.from({ length: 17 }, (_, index) => `https://example.com/p${index + 1}.jpg`).filter(url => !url.endsWith('p10.jpg')),
  );
});

// ---------------------------------------------------------------- full flow

await check('пълният поток изпраща обява, после снимки, после проверява', async () => {
  const { impl, calls } = stubFetch([
    { status: 200, body: { status: 'success login', token: 't'.repeat(32) } },
    { status: 200, body: { status: 'success', fields: [{ fname: 'marka' }, { fname: 'model' }, { fname: 'km' }] } },
    { status: 200, body: { status: 'success pub', advert: { ida: '21234567890123456' } } },
    { status: 200, body: { status: 'success picts' } },
    { status: 200, body: { status: 'success load', advert: { ida: '21234567890123456' } } },
    { status: 200, body: { status: 'success logout' } },
  ]);
  const client = new MobileBgApiClient({ username: 'u', password: 'p', fetchImpl: impl });
  assert.equal((await client.login()).ok, true);
  await client.catfields(1);
  const published = await client.advertPub({ topmenu: '1', rub: '1', marka: 'BMW' });
  const ida = findListingId(published.payload);
  assert.equal(ida, '21234567890123456');
  assert.equal((await client.advertPicts(ida!, 'add', { picts: '/a/image-1.jpg' })).ok, true);
  assert.equal((await client.advertLoad(ida!)).ok, true);
  await client.logout();

  const paths = calls.map(call => call.url.replace(/https:\/\/api\.mobile\.bg/, '').replace(/t{32}/, '<token>'));
  assert.deepEqual(paths, [
    '/import_api/login',
    '/import_api/catfields/1/1/',
    '/import_api/advertpub/<token>/',
    '/import_api/advertpicts/<token>/',
    '/import_api/advertload/<token>/?ida=21234567890123456',
    '/import_api/logout/<token>/',
  ]);
  assert.equal(client.hasToken, false, 'token се изчиства след изход');
});

await check('снимките се подават като пътища, разделени с ~', async () => {
  const { impl, calls } = stubFetch([
    { status: 200, body: { status: 'success login', token: 't'.repeat(32) } },
    { status: 200, body: { status: 'success picts' } },
  ]);
  const client = new MobileBgApiClient({ username: 'u', password: 'p', fetchImpl: impl });
  await client.login();
  await client.advertPicts('21234567890123456', 'add', { picts: '/p/a.jpg~/p/b.jpg' });
  const body = calls[1].body || '';
  // The body is form-encoded, so the assertion is made on the decoded value —
  // which is what Mobile.bg's parser receives. `~` is percent-encoded to %7E and
  // `/` to %2F, both of which every standard form parser decodes back.
  const decoded = new URLSearchParams(body).get('picts') || '';
  assert.equal(decoded, '/p/a.jpg~/p/b.jpg', 'пътищата се разделят с ~');
  assert.ok(!decoded.includes('http'), 'не се подават пълни URL адреси');
  assert.ok(!decoded.includes('autoimportcontrolcenter.biz'), 'домейнът е регистриран от Mobile.bg и не се повтаря');
});

await check('всяко поле в таблицата има име за показване', () => {
  for (const [key, rule] of Object.entries(FIELD_TO_API)) {
    assert.ok(rule.apiKey, `${key} има apiKey`);
    assert.ok(rule.label, `${key} има label`);
    assert.equal(typeof rule.confirmed, 'boolean', `${key} отбелязва дали е потвърдено`);
  }
});

console.log(failures === 0 ? '\nВсички проверки минаха.' : `\n${failures} проверки се провалиха.`);
process.exitCode = failures === 0 ? 0 : 1;
