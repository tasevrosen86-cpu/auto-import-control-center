import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type PublishJob = { id: string; draft_id: string; mode: 'PREVIEW' | 'LIVE' };
type DraftField = { field_key: string; value: string | null };
type DraftExtra = { mobile_bg_label: string; selected: boolean };
type DraftImage = { source_url: string | null; local_path: string | null; is_selected: boolean; is_main: boolean; display_order: number; };

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
for (const [name, value] of [
  ['SUPABASE_URL', process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY', supabaseKey],
  ['MOBILE_BG_USER_DATA_DIR', process.env.MOBILE_BG_USER_DATA_DIR],
] as const) {
  if (!value) throw new Error(`Липсва ${name}.`);
}
const db = createClient(process.env.SUPABASE_URL!, supabaseKey!, { auth: { persistSession: false } });
const workerName = process.env.WORKER_NAME || `mobile-publisher-${process.pid}`;
const profileDir = process.env.MOBILE_BG_USER_DATA_DIR!;
const newListingUrl = process.env.MOBILE_BG_NEW_LISTING_URL || 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';
// Mobile.bg rejects a listing with more than 17 photos.
const MOBILE_BG_MAX_PHOTOS = 17;

const FIELD_SELECTORS: Record<string, string> = {
  make: '[name="f5"]', model: '[name="f6"]', modification: '[name="f7"]', fuel: '[name="f8"]',
  condition: '[name="f25"]', power: '[name="f9"]', euro_standard: '[name="f29"]', gearbox: '[name="f10"]',
  displacement: '[name="f30"]', price: '[name="f12"]', currency: '[name="f13"]', vat_included: '[name="f31"]',
  mileage: '[name="f16"]', month: '[name="f14"]', year: '[name="f15"]',
  color: '[name="f17"]',
  // f11 is the body style and the publish form requires it. It is listed before
  // the location on purpose: choosing it reloads the area and country lists.
  body_type: '[name="f11"]',
  location: '[name="f18"]', country: '[name="f19"]', vin: '[name="f32"]',
};

// Mobile.bg splits the origin in two: f18 is the market area and f19 is the
// country. The draft keeps them joined as "Извън страната → Канада", which never
// matched the f18 option list, so the area was dropped and the country was never
// set at all. Both are derived from the joined value.
const LOCATION_ALIASES: Record<string, string> = {
  'Извън страната → Канада': 'Извън страната',
  'Извън страната → Южна Корея': 'Извън страната',
};
const COUNTRY_CANDIDATES: Array<[string, string[]]> = [
  ['Канада', ['Канада']],
  ['Южна Корея', ['Южна Корея', 'Корея', 'Южна Корея (Република Корея)']],
];

// Fields that must land in Mobile.bg for the listing to be worth publishing.
// Everything else — colour, modification, extras, the Canada-only additions and
// the VIN — stays optional and is reported without blocking.
const STRICT_FIELDS = (process.env.MOBILE_BG_STRICT_FIELDS
  || 'title,make,model,body_type,price,currency,condition,fuel,gearbox,year,mileage,location,country')
  .split(',').map(key => key.trim()).filter(Boolean);
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  fuel: { Бензин: 'Бензинов', Дизел: 'Дизелов', Хибрид: 'Хибриден', 'Газ (LPG)': 'Газ' },
  condition: { Използван: 'Употребяван' },
  euro_standard: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`Euro ${n}`, `Евро ${n}`])),
  month: Object.fromEntries(['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'].map(v => [v, v.toLocaleLowerCase('bg')])),
  vat_included: { Да: 'Цената е с включено ДДС', Не: 'Цената е без ДДС', 'Цената е с включено ДДС': 'Цената е с включено ДДС', 'Цената е без ДДС': 'Цената е без ДДС', 'Частна продажба./Освободена от ДДС продажба': 'Частна продажба./Освободена от ДДС продажба' },
};

// f11 is Mobile.bg's «Категория» on the publish form and it is the body style,
// not the ad section. The order matters: «minivan» must be tested before «van»,
// because the shorter word is a substring of the longer one. The wording on the
// right is what the live form offered.
const BODY_TYPE_ALIASES: Array<[RegExp, string]> = [
  [/minivan|multi.?purpose|mpv/i, 'Миниван'],
  [/pick.?up|truck|пикап/i, 'Пикап'],
  [/suv|crossover|sport.?utility|джип|джипове/i, 'Джип'],
  [/convertible|cabrio|кабрио/i, 'Кабрио'],
  [/hatch|хечбек|хеч/i, 'Хечбек'],
  [/coupe|coupé|купе/i, 'Купе'],
  [/wagon|estate|station|комби/i, 'Комби'],
  [/sedan|saloon|седан/i, 'Седан'],
  [/van|ван/i, 'Ван'],
];

// Returns Mobile.bg's own wording for a body style, or '' when the source did
// not supply one. Empty is deliberate: the field is left to the broker rather
// than guessed, because a wrong f11 quietly reshapes the listing.
function resolveBodyType(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (BODY_TYPE_ALIASES.some(([, label]) => label.toLocaleLowerCase('bg') === raw.toLocaleLowerCase('bg'))) return raw;
  const match = BODY_TYPE_ALIASES.find(([pattern]) => pattern.test(raw));
  return match ? match[1] : '';
}
const EXTRA_ALIASES: Record<string, string> = {
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

// Mobile.bg sits behind Cloudflare, which answers an automated request with a
// 403 challenge page: "Just a moment...". That page has no form controls, so
// every field is reported missing and the run looks like a form-mapping bug
// while the real cause is the challenge.
//
// Three things are needed for a browser session to pass automated checks:
//   * a real Chrome channel rather than bundled Chromium, because the bundled
//     build carries an automation fingerprint that the challenge rejects;
//   * the usual automation switches disabled, so navigator.webdriver is false;
//   * the persistent profile in MOBILE_BG_USER_DATA_DIR, whose clearance cookie
//     outlives a single run once one challenge has been solved.
const CONTEXT_OPTIONS = {
  headless: process.env.MOBILE_BG_HEADLESS === 'true',
  channel: process.env.MOBILE_BG_BROWSER_CHANNEL || 'chrome',
  locale: 'bg-BG',
  timezoneId: 'Europe/Sofia',
  userAgent: process.env.MOBILE_BG_USER_AGENT
    || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check', '--no-first-run'],
  ignoreDefaultArgs: ['--enable-automation'],
} as const;

// Markers of a Cloudflare interstitial rather than the listing form. Kept
// together so the check is a single place to update.
const CHALLENGE_MARKERS = ['just a moment', 'cf-challenge', 'cf_chl_', 'checking your browser', 'attention required'];
const CHALLENGE_MIN_BYTES = 20000;

async function isChallengePage(page: Page) {
  const html = await page.content().catch(() => '');
  if (!html) return true;
  // A real form carries many controls; the challenge is a small interstitial.
  if (html.length < CHALLENGE_MIN_BYTES) return true;
  const lower = html.toLowerCase();
  if (CHALLENGE_MARKERS.some(marker => lower.includes(marker))) return true;
  // The listing form always exposes the make field. Use it as the litmus test
  // so a page that merely changed its markup is not misread as a challenge.
  return await page.locator('[name="f5"], input[name="f1"]').count() === 0;
}

// Reads the page HTML and answers a challenge if one is present.
async function waitForForm(page: Page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!await isChallengePage(page)) return true;
    await page.waitForTimeout(1000);
  }
  return !await isChallengePage(page);
}

async function loginIfNeeded(page: Page) {
  // "No password box" only means logged in when the form is actually there.
  // On a challenge page there is no password box either, which is why a blocked
  // run used to report already_logged_in while nothing was filled.
  if (await isChallengePage(page)) return 'challenge';
  if (await page.locator('input[type="password"]').count() === 0) return 'already_logged_in';
  const username = process.env.MOBILE_BG_USERNAME;
  const password = process.env.MOBILE_BG_PASSWORD;
  if (!username || !password) return 'credentials_missing';
  const userField = page.locator(process.env.MOBILE_BG_LOGIN_USERNAME_SELECTOR || 'input[name="username"], input[name="email"], input[type="email"], input[type="text"]').first();
  const passField = page.locator(process.env.MOBILE_BG_LOGIN_PASSWORD_SELECTOR || 'input[type="password"]').first();
  const submit = page.locator(process.env.MOBILE_BG_LOGIN_SUBMIT_SELECTOR || 'button[type="submit"], input[type="submit"]').first();
  if (!await userField.count() || !await passField.count() || !await submit.count()) return 'form_not_recognized';
  await userField.fill(username);
  await passField.fill(password);
  await submit.click();
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  return await page.locator('input[type="password"]').count() === 0 ? 'logged_in' : 'login_failed';
}

async function clickVisibleButton(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const buttons = page.locator(selector);
    const count = await buttons.count();
    for (let index = count - 1; index >= 0; index -= 1) {
      const button = buttons.nth(index);
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await button.click();
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await page.waitForTimeout(800);
        return true;
      }
    }
  }
  return false;
}

async function advanceFromDataStage(page: Page) {
  const beforeUrl = page.url();
  const selectors = [
    'a:has-text("Продължи")',
    'button:has-text("Продължи")',
    'input[type="submit"][value="Продължи"]',
    'input[type="button"][value="Продължи"]',
  ];
  const clicked = await clickVisibleButton(page, selectors);
  if (!clicked) return { advanced: false, beforeUrl, afterUrl: page.url(), reason: 'Не е намерен точният бутон „Продължи“.' };
  const afterUrl = page.url();
  const imageInputs = await page.locator('input[type="file"]').count();
  const stageChanged = afterUrl !== beforeUrl || imageInputs > 0;
  return {
    advanced: stageChanged,
    beforeUrl,
    afterUrl,
    image_inputs: imageInputs,
    reason: stageChanged ? undefined : 'Mobile.bg не показа втория етап със снимките.',
  };
}

async function submitAndVerifyOnMobileBg(page: Page) {
  const beforeUrl = page.url();
  const selectors = [
    'a#pubButton',
    'a:has-text("Публикувай")',
    'button:has-text("Публикувай")',
    'input[type="submit"][value="Публикувай"]',
    'input[type="button"][value="Публикувай"]',
  ];
  const clicked = await clickVisibleButton(page, selectors);
  if (!clicked) return { submitted: false, verified: false, beforeUrl, afterUrl: page.url(), reason: 'Не е намерен точният финален бутон „Публикувай“.' };
  await page.waitForTimeout(1500);
  const afterUrl = page.url();
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const confirmation = /обявата.{0,80}(публикувана|активна|създадена)|успешно.{0,80}(публику|обяв)|публикуването.{0,80}(успешно|завърши)/i.test(bodyText);
  const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => (anchor as HTMLAnchorElement).href).filter(Boolean));
  const listingUrl = links.find(link => /mobile\.bg/i.test(link) && /(act=4|adv=|obiava)/i.test(link)) || (/(act=4|adv=|obiava)/i.test(afterUrl) ? afterUrl : null);
  const verified = Boolean(listingUrl || confirmation);
  return {
    submitted: true,
    verified,
    beforeUrl,
    afterUrl,
    listing_url: listingUrl,
    confirmation_text_found: confirmation,
    confirmation_excerpt: confirmation ? bodyText.slice(0, 500) : null,
    reason: verified ? undefined : 'Кликът е изпълнен, но Mobile.bg не потвърди създадена обява и не върна URL/ID.',
  };
}

async function uploadSelectedImages(page: Page, images: DraftImage[]) {
  const eligible = images.filter(image => image.is_selected).sort((a, b) => a.display_order - b.display_order);
  const selected = eligible.slice(0, MOBILE_BG_MAX_PHOTOS);
  if (selected.length === 0) return { uploaded: 0, skipped: ['Няма избрани снимки.'] };
  const workDir = join(tmpdir(), 'aicc-mobile-bg-images');
  await mkdir(workDir, { recursive: true });
  const files: string[] = [];
  const skipped: string[] = eligible.length > MOBILE_BG_MAX_PHOTOS
    ? [`Mobile.bg приема до ${MOBILE_BG_MAX_PHOTOS} снимки; пропуснати ${eligible.length - MOBILE_BG_MAX_PHOTOS} от ${eligible.length} избрани.`]
    : [];
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const image = selected[index];
      const localFile = image.local_path && image.local_path.startsWith('/') ? image.local_path : null;
      const filePath = localFile || join(workDir, `image-${index + 1}.jpg`);
      if (!localFile) {
        if (!image.source_url) { skipped.push(`Снимка #${index + 1}: липсва URL.`); continue; }
        const response = await fetch(image.source_url);
        if (!response.ok) { skipped.push(`Снимка #${index + 1}: HTTP ${response.status}.`); continue; }
        await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      }
      files.push(filePath);
    }
    const inputs = page.locator('input[type="file"]');
    if (await inputs.count() === 0) return { uploaded: 0, skipped: [...skipped, 'Mobile.bg не показа поле за снимки.'] };
    if (files.length === 0) return { uploaded: 0, skipped };
    await inputs.first().setInputFiles(files);
    await page.waitForFunction((expected) => {
      const items = document.querySelectorAll('#container > li.hasPhoto');
      const processing = document.querySelectorAll('#container > li.hasPhoto .processing');
      return items.length === expected && processing.length === 0;
    }, files.length, { timeout: 30000 }).catch(() => undefined);
    const photoCount = await page.locator('#container > li.hasPhoto').count();
    const processingCount = await page.locator('#container > li.hasPhoto .processing').count();
    if (photoCount !== files.length || processingCount !== 0) return { uploaded: photoCount, skipped: [...skipped, 'Mobile.bg не потвърди всички снимки.'] };
    return { uploaded: photoCount, skipped };
  } finally {
    for (const file of files) if (file.startsWith(workDir)) await rm(file, { force: true }).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalizeOptionText(value: string) {
  return value.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').toLocaleLowerCase('bg');
}

async function selectText(page: Page, selector: string, wanted: string) {
  const select = page.locator(selector).first();
  const normalized = normalizeOptionText(wanted);
  const option = (await select.locator('option').allTextContents()).find(v => normalizeOptionText(v) === normalized);
  if (!option) return false;
  await select.selectOption({ label: option });
  return true;
}

// "Заглавие" belongs to the description part of the form and its control name is
// not among the known f-fields, so it is located by its visible label rather than
// by guessing a name. MOBILE_BG_TITLE_SELECTOR pins it if the label changes.
async function findTitleControl(page: Page) {
  const override = process.env.MOBILE_BG_TITLE_SELECTOR;
  if (override) {
    const pinned = page.locator(override).first();
    if (await pinned.count()) return pinned;
  }
  const candidates = page.locator('label, td, th');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const node = candidates.nth(i);
    const text = (await node.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().toLocaleLowerCase('bg');
    if (text !== 'заглавие') continue;
    const forId = await node.getAttribute('for');
    if (forId) {
      const linked = page.locator(`#${forId}`).first();
      if (await linked.count()) return linked;
    }
    const inside = node.locator('input[type="text"], input:not([type]), textarea').first();
    if (await inside.count()) return inside;
    const sibling = node.locator('xpath=following::input[1] | following::textarea[1]').first();
    if (await sibling.count()) return sibling;
  }
  return null;
}

// Option lists in Mobile.bg arrive after the field they depend on is chosen:
// the model list follows the make, and the area/country lists follow the body
// and the location. A fixed sleep lost that race and every dependent select was
// reported as "no matching option", leaving the form half-empty while the run
// looked successful. Wait for the list to actually fill instead.
async function waitForOptions(page: Page, selector: string, minimum = 2, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator(`${selector} option`).count().catch(() => 0);
    if (count >= minimum) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function populateStepOne(page: Page, fields: DraftField[], extras: DraftExtra[]) {
  const values = new Map(fields.map(field => [field.field_key, String(field.value || '').trim()]));
  const filled: string[] = [];
  const skipped: Array<{ key: string; value: string; reason: string }> = [];
  for (const [key, selector] of Object.entries(FIELD_SELECTORS)) {
    let value = values.get(key) || '';
    // The origin arrives joined ("Извън страната → Канада"); f18 takes the area
    // and f19 the country, so each is resolved separately. The country is
    // derived here, before the emptiness check, because the draft has no
    // country field of its own to carry it.
    if (key === 'location') {
      value = LOCATION_ALIASES[value] || value;
    } else if (key === 'body_type') {
      // f11 is the body style, not the ad section: «category» is the fixed
      // value «Автомобили и джипове» and would never match an option here.
      const raw = ['body_type', 'body', 'bodyType', 'body_style']
        .map(candidate => values.get(candidate) || '')
        .find(candidate => candidate) || '';
      value = resolveBodyType(raw);
    } else if (key === 'country') {
      const joined = values.get('location') || '';
      const match = COUNTRY_CANDIDATES.find(([, names]) => names.some(name => joined.includes(name)));
      value = match ? match[0] : '';
    }
    if (!value) {
      // A required field that the draft simply does not have is recorded here
      // rather than skipped: otherwise a missing f11 left the form with no body
      // style and the run still reported success. «country» is excluded because
      // it is derived from the origin and is legitimately empty for a listing
      // that does not come from an import source.
      if (STRICT_FIELDS.includes(key) && key !== 'country') skipped.push({ key, value: '', reason: 'Няма стойност в черновата.' });
      continue;
    }
    value = VALUE_ALIASES[key]?.[value] || value;
    const control = page.locator(selector).first();
    if (!await control.count()) { skipped.push({ key, value, reason: 'Полето липсва в Mobile.bg.' }); continue; }
    const tag = await control.evaluate(element => element.tagName);
    if (tag === 'SELECT') {
      // The list may still be loading, so give it the chance to arrive first.
      if (!await waitForOptions(page, selector)) {
        skipped.push({ key, value, reason: 'Списъкът с опции не се зареди навреме.' });
        continue;
      }
      if (!await selectText(page, selector, value)) { skipped.push({ key, value, reason: 'Няма съвпадаща опция.' }); continue; }
    } else if (!await control.fill(value).then(() => true).catch(() => false)) {
      skipped.push({ key, value, reason: 'Стойността не беше приета.' }); continue;
    }
    filled.push(key);
    // Choosing any of these reloads a list further down the form: «Марка»
    // reloads «Модел», and «Категория» (f11) and «Област» both reload «Държава».
    if (key === 'make' || key === 'body_type' || key === 'location' || key === 'country') await page.waitForTimeout(500);
  }
  const derived = [
    values.get('drivetrain') === '4x4' ? '4x4' : '',
    values.get('doors') === '2/3' ? '2(3) Врати' : values.get('doors') === '4/5' ? '4(5) Врати' : '',
    values.get('seats') === '7' ? '7 места' : '', values.get('leasing') === 'Да' ? 'Лизинг' : '',
    values.get('barter') === 'Да' ? 'Бартер' : '',
  ].filter(Boolean);
  const wantedExtras = new Set([...extras.filter(e => e.selected).map(e => EXTRA_ALIASES[e.mobile_bg_label] || e.mobile_bg_label), ...derived]);
  for (const label of wantedExtras) {
    const candidates = page.locator('label'); let matched = false;
    for (let i = 0; i < await candidates.count(); i += 1) {
      const node = candidates.nth(i); const text = (await node.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().toLocaleLowerCase('bg');
      if (text !== label.trim().toLocaleLowerCase('bg')) continue;
      const input = node.locator('input[type="checkbox"]').first();
      if (await input.count()) { await input.check(); matched = true; break; }
      const forId = await node.getAttribute('for');
      if (forId) { const linked = page.locator(`#${forId}`).first(); if (await linked.count()) { await linked.check(); matched = true; break; } }
    }
    if (matched) filled.push(`extra:${label}`); else skipped.push({ key: `extra:${label}`, value: label, reason: 'Няма точно съвпадение по видим label.' });
  }
  const description = values.get('final_description') || values.get('description') || '';
  if (description) {
    const textarea = page.locator('textarea[name="f21"]').first();
    if (await textarea.count()) { await textarea.fill(description); filled.push('final_description'); }
    else skipped.push({ key: 'final_description', value: description, reason: 'Полето за описание липсва.' });
  }
  // The ad title is required by Mobile.bg, so a missing control is reported
  // instead of silently dropped: that is what makes the draft look complete
  // while the published ad has no title.
  const title = values.get('title') || '';
  if (title) {
    const titleControl = await findTitleControl(page);
    if (titleControl) { await titleControl.fill(title); filled.push('title'); }
    else skipped.push({ key: 'title', value: title, reason: 'Полето „Заглавие“ не беше намерено във формата.' });
  }
  // A run that quietly drops a required field produces a half-empty listing that
  // still reports success. Stop instead, and name the fields that did not land.
  const missingRequired = skipped
    .map(entry => entry.key.replace(/^extra:/, ''))
    .filter(key => STRICT_FIELDS.includes(key));
  if (missingRequired.length > 0) {
    const detail = skipped.filter(entry => STRICT_FIELDS.includes(entry.key.replace(/^extra:/, '')))
      .map(entry => `${entry.key}=${entry.value} (${entry.reason})`).join('; ');
    return { filled, skipped, blockedBy: missingRequired, blockReason: `Задължителни полета не влязоха в Mobile.bg: ${detail}` };
  }
  return { filled, skipped };
}

// The form filling is exercised against a stub of the Mobile.bg form, because
// its behaviour — option lists arriving after the field they depend on, and the
// origin split across two controls — is what broke publishing.
export { populateStepOne as populateStepOneForTest };

// A published listing is only useful if the broker can get back to it later, so
// the URL and the Mobile.bg ad id are written onto the draft itself. The draft
// row feeds the "Публикувани обяви" section; the publish job result alone was
// not enough because nothing surfaced it in the UI.
async function recordPublishedListing(draftId: string, details: Record<string, unknown>) {
  const url = typeof details.listing_url === 'string' ? details.listing_url : null;
  const idFromUrl = url ? url.match(/[?&](?:adv|id)=(\d+)/i)?.[1] : null;
  const adId = typeof details.listing_id === 'string' ? details.listing_id : idFromUrl;
  await db.from('mobile_bg_drafts').update({
    mobile_bg_url: url,
    mobile_bg_listing_id: adId || null,
    last_checked_at: url ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', draftId);
  const fieldRows = [
    url ? { draft_id: draftId, field_key: 'mobile_bg_url', mobile_bg_label: 'Mobile.bg URL', our_db_key: 'mobile_bg_url', value: url, field_type: 'text', source: 'mobile_bg', updated_at: new Date().toISOString() } : null,
    adId ? { draft_id: draftId, field_key: 'mobile_bg_id', mobile_bg_label: 'Mobile.bg ID на обявата', our_db_key: 'mobile_bg_id', value: adId, field_type: 'text', source: 'mobile_bg', updated_at: new Date().toISOString() } : null,
  ].filter(Boolean) as Array<Record<string, unknown>>;
  if (fieldRows.length) await db.from('mobile_bg_draft_fields').upsert(fieldRows, { onConflict: 'draft_id,field_key' });
}

// The broker watches the run from inside the site, so the worker publishes its
// current step and a small JPEG of the page into the job's existing result
// column. Nothing new is stored: the result column is already readable by the
// signed-in broker, so no public bucket, extra port or schema change is needed.
// The frame is a data URL and is deliberately best-effort — a failed capture
// must never abort publishing.
type LiveState = { stage: string; frame: string | null; frame_at: string };

// The worker owns the job for the whole run, so the live state is kept in
// memory and written as a whole instead of re-reading the row on every tick.
let liveState: LiveState | null = null;
// Extra run detail that belongs with the live state, such as which fields the
// worker managed to write. Kept apart from liveState because the frame refresh
// replaces that object on every tick.
let liveDetails: Record<string, unknown> = {};

// Live writes are serialised and switched off before the final result is
// stored. Otherwise a heartbeat already in flight could read the row before
// finish() writes it and save a frame-only result afterwards, wiping the run
// outcome. The flag is re-checked after the read for the same reason.
let liveEnabled = true;
let liveWriteChain: Promise<void> = Promise.resolve();

function writeLive(jobId: string) {
  liveWriteChain = liveWriteChain.then(async () => {
    if (!liveEnabled || !liveState) return;
    const { data } = await db.from('mobile_bg_publish_jobs').select('result').eq('id', jobId).maybeSingle();
    if (!liveEnabled) return;
    const existing = (data?.result || {}) as Record<string, unknown>;
    await db.from('mobile_bg_publish_jobs')
      .update({ result: { ...existing, ...liveDetails, live: liveState }, updated_at: new Date().toISOString() })
      .eq('id', jobId);
  });
  return liveWriteChain;
}

async function captureFrame(page: Page): Promise<string | null> {
  try {
    const buffer = await page.screenshot({ type: 'jpeg', quality: 50 });
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function noteStage(job: PublishJob, page: Page, stage: string) {
  liveState = { stage, frame: await captureFrame(page), frame_at: new Date().toISOString() };
  await writeLive(job.id);
}

// Refreshes only the picture on the timer. Rewriting the stage here would erase
// the message the main flow just set with a meaningless "still working".
async function refreshFrame(job: PublishJob, page: Page) {
  if (!liveState) return;
  liveState = { ...liveState, frame: await captureFrame(page), frame_at: new Date().toISOString() };
  await writeLive(job.id);
}

function stageLabel(status: string) {
  if (status === 'COMPLETED') return 'Mobile.bg потвърди публикуването.';
  if (status === 'PREVIEW_READY') return 'Стъпка 1 е попълнена.';
  if (status === 'NEEDS_LOGIN') return 'Нужен е вход в Mobile.bg.';
  if (status === 'NEEDS_CONFIGURATION') return 'Публикуването спря и чака корекция.';
  return 'Публикуването не завърши.';
}

async function finish(job: PublishJob, status: string, details: Record<string, unknown>, error?: string) {
  // The final result keeps the live stage so the screen can show how the run
  // ended, including the last frame the broker was watching.
  const live = liveState || { stage: stageLabel(status), frame: null, frame_at: new Date().toISOString() };
  // Stop the heartbeat first and let any write already in flight land, so the
  // outcome below is the last thing stored on the row.
  liveEnabled = false;
  await liveWriteChain.catch(() => undefined);
  liveState = null;
  await db.from('mobile_bg_publish_jobs').update({
    status,
    result: { ...liveDetails, ...details, live: { ...live, stage: error || live.stage } },
    last_error: error || null,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  liveDetails = {};
  const draftStatus = status === 'COMPLETED' ? 'PUBLISHED' : status === 'PREVIEW_READY' ? 'APPROVED' : status === 'NEEDS_LOGIN' ? 'PUBLISH_LOGIN_REQUIRED' : 'ERROR';
  await db.from('mobile_bg_drafts').update({ status: draftStatus, publish_error: error || null, published_at: status === 'COMPLETED' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', job.draft_id);
  if (status === 'COMPLETED') await recordPublishedListing(job.draft_id, details);
  await db.from('mobile_bg_draft_action_log').insert({ draft_id: job.draft_id, action: `MOBILE_PUBLISH_${status}`, actor: workerName, details });
}

// A real Chrome passes automated checks that bundled Chromium fails, but the
// server may not have it installed. Fall back to Chromium rather than failing
// the whole run, and let the challenge check report the truth afterwards.
async function launchBrowser() {
  try {
    return await chromium.launchPersistentContext(profileDir, CONTEXT_OPTIONS);
  } catch (cause) {
    console.warn(`Неуспешно стартиране с канал „${CONTEXT_OPTIONS.channel}“, връщам се към вградения Chromium: ${cause instanceof Error ? cause.message : cause}`);
    const { channel, ...fallback } = CONTEXT_OPTIONS;
    void channel;
    return await chromium.launchPersistentContext(profileDir, fallback);
  }
}

async function run() {
  const { data: candidate, error: findError } = await db
    .from('mobile_bg_publish_jobs')
    .select('id,draft_id,mode')
    .eq('status', 'QUEUED')
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (!candidate) return console.log('Няма чакаща заявка за публикуване.');

  const { data: claimed, error: claimError } = await db
    .from('mobile_bg_publish_jobs')
    .update({
      status: 'RUNNING',
      claimed_by: workerName,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id)
    .eq('status', 'QUEUED')
    .select('id,draft_id,mode')
    .maybeSingle();
  if (claimError) throw claimError;
  const job = (claimed || null) as PublishJob | null;
  if (!job) return console.log('Заявката вече се обработва от друг worker.');
  const [fieldResult, extraResult, imageResult] = await Promise.all([
    db.from('mobile_bg_draft_fields').select('field_key,value').eq('draft_id', job.draft_id),
    db.from('mobile_bg_draft_extras').select('mobile_bg_label,selected').eq('draft_id', job.draft_id).eq('selected', true),
    db.from('mobile_bg_draft_images').select('source_url,local_path,is_selected,is_main,display_order').eq('draft_id', job.draft_id).eq('is_selected', true).order('display_order', { ascending: true }),
  ]);
  if (fieldResult.error) return await finish(job, 'FAILED', {}, `Грешка при четене на полетата: ${fieldResult.error.message}`);
  if (extraResult.error) return await finish(job, 'FAILED', {}, `Грешка при четене на екстрите: ${extraResult.error.message}`);
  if (imageResult.error) return await finish(job, 'FAILED', {}, `Грешка при четене на снимките: ${imageResult.error.message}. Провери достъпа SELECT до mobile_bg_draft_images.`);
  const context = await launchBrowser();
  // A slow page must not look like a dead run, so the screen is refreshed on a
  // timer while the worker waits. The captures are best-effort and unref'd so a
  // hanging screenshot can never keep the process alive.
  let heartbeat: NodeJS.Timeout | null = null;
  try {
    const page = context.pages()[0] || await context.newPage();
    await noteStage(job, page, 'Отварям формата за нова обява в Mobile.bg.');
    await page.goto(newListingUrl, { waitUntil: 'domcontentloaded' });
    heartbeat = setInterval(() => { void refreshFrame(job, page); }, 3000);
    heartbeat.unref?.();
    // The challenge is answered by the page itself once the browser looks real,
    // so give it time and then report honestly if it never cleared. Without this
    // the run blamed the form mapping for what was really a 403.
    await noteStage(job, page, 'Изчаквам формата на Mobile.bg да се зареди.');
    if (!await waitForForm(page)) {
      return await finish(job, 'NEEDS_CONFIGURATION', {
        url: page.url(),
        login_state: 'challenge',
        blocked_by: 'cloudflare',
      }, 'Cloudflare не пусна работника до формата (страница „Just a moment…“). Нужен е браузър без автоматизационен отпечатък или еднократно решаване на проверката.');
    }
    const loginState = await loginIfNeeded(page);
    if (loginState === 'challenge') {
      return await finish(job, 'NEEDS_CONFIGURATION', { url: page.url(), login_state: 'challenge', blocked_by: 'cloudflare' }, 'Cloudflare не пусна работника до формата (страница „Just a moment…“).');
    }
    if (loginState === 'credentials_missing') return await finish(job, 'NEEDS_LOGIN', { url: page.url() }, 'Нужен е еднократен защитен вход в Mobile.bg на сървъра.');
    if (loginState === 'form_not_recognized' || loginState === 'login_failed') return await finish(job, 'NEEDS_LOGIN', { url: page.url(), reason: loginState }, 'Mobile.bg не прие автоматичния вход.');
    await noteStage(job, page, 'Влизането е успешно. Попълвам полетата.');
    const result = await populateStepOne(page, fieldResult.data || [], extraResult.data || []);
    await noteStage(job, page, `Полетата са попълнени. Пропуснати: ${result.skipped.length}.`);
    if (result.blockedBy?.length) {
      return await finish(job, 'NEEDS_CONFIGURATION', { ...result, url: page.url(), login_state: loginState }, result.blockReason || 'Задължителни полета не влязоха в Mobile.bg.');
    }
    // The per-field outcome is published while the run continues, so the screen
    // can show which values landed and which were left out before the end.
    liveDetails = { filled: result.filled, skipped: result.skipped };
    await writeLive(job.id);
    const dataStage = await advanceFromDataStage(page);
    if (!dataStage.advanced) return await finish(job, 'NEEDS_CONFIGURATION', { ...result, data_stage: dataStage, url: page.url(), login_state: loginState }, dataStage.reason || 'Неуспешно преминаване към етапа със снимки.');
    await noteStage(job, page, 'Преминах към стъпката със снимките.');
    const imageUpload = await uploadSelectedImages(page, (imageResult.data || []) as DraftImage[]);
    if (imageUpload.uploaded === 0) return await finish(job, 'NEEDS_CONFIGURATION', { ...result, data_stage: dataStage, image_upload: imageUpload, url: page.url(), login_state: loginState }, 'Няма качени избрани снимки. Избери поне една снимка за обявата.');
    await noteStage(job, page, `Качени са ${imageUpload.uploaded} снимки.`);
    const screenshotPath = `/tmp/mobile-bg-${job.id}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (job.mode === 'LIVE') {
      await noteStage(job, page, 'Натискам реалния бутон „Публикувай“.');
      const submission = await submitAndVerifyOnMobileBg(page);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      if (!submission.submitted || !submission.verified) {
        return await finish(job, 'NEEDS_CONFIGURATION', { ...result, data_stage: dataStage, ...submission, image_upload: imageUpload, url: page.url(), login_state: loginState, screenshot_path: screenshotPath }, submission.reason || 'Mobile.bg не потвърди публикацията.');
      }
      return await finish(job, 'COMPLETED', { ...result, data_stage: dataStage, ...submission, image_upload: imageUpload, url: page.url(), login_state: loginState, screenshot_path: screenshotPath, message: 'Mobile.bg потвърди създадена обява.' });
    }
    await finish(job, 'PREVIEW_READY', { ...result, url: page.url(), login_state: loginState, screenshot_path: screenshotPath, message: 'Стъпка 1 е попълнена без изпращане към Mobile.bg.' });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Непозната грешка.';
    await finish(job, 'FAILED', { message }, message);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    // Clears a job that never reached finish(): an exception thrown before any
    // noteStage leaves no state, and a completed run has already reset it.
    liveEnabled = false;
    await liveWriteChain.catch(() => undefined);
    liveState = null;
    liveDetails = {};
    await context.close();
  }
}

// Only run when started as the entry point. Importing this module must not
// start claiming jobs from the queue as a side effect.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
