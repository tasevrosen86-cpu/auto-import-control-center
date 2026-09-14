import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';

type PublishJob = { id: string; draft_id: string; mode: 'PREVIEW' | 'LIVE' };
type DraftField = { field_key: string; value: string | null };
type DraftExtra = { mobile_bg_label: string; selected: boolean };

for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MOBILE_BG_USER_DATA_DIR']) {
  if (!process.env[name]) throw new Error(`Липсва ${name}.`);
}
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const workerName = process.env.WORKER_NAME || `mobile-publisher-${process.pid}`;
const profileDir = process.env.MOBILE_BG_USER_DATA_DIR!;
const newListingUrl = process.env.MOBILE_BG_NEW_LISTING_URL || 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';

const FIELD_SELECTORS: Record<string, string> = {
  make: '[name="f5"]', model: '[name="f6"]', modification: '[name="f7"]', fuel: '[name="f8"]',
  condition: '[name="f25"]', power: '[name="f9"]', euro_standard: '[name="f29"]', gearbox: '[name="f10"]',
  displacement: '[name="f30"]', price: '[name="f12"]', vat_included: '[name="f31"]',
  currency: '[name="f13"]', mileage: '[name="f16"]', month: '[name="f14"]', year: '[name="f15"]',
  color: '[name="f17"]', location: '[name="f18"]', vin: '[name="f32"]',
};
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  fuel: { Бензин: 'Бензинов', Дизел: 'Дизелов', Хибрид: 'Хибриден', 'Газ (LPG)': 'Газ' },
  condition: { Използван: 'Употребяван' },
  euro_standard: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`Euro ${n}`, `Евро ${n}`])),
  month: Object.fromEntries(['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'].map(v => [v, v.toLocaleLowerCase('bg')])),
  vat_included: { Да: 'Цената е с включено ДДС', Не: 'Цената е без ДДС' },
};
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

async function loginIfNeeded(page: Page) {
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

async function selectText(page: Page, selector: string, wanted: string) {
  const select = page.locator(selector).first();
  const normalized = wanted.trim().toLocaleLowerCase('bg');
  const option = (await select.locator('option').allTextContents()).find(v => v.trim().toLocaleLowerCase('bg') === normalized);
  if (!option) return false;
  await select.selectOption({ label: option });
  return true;
}

async function populateStepOne(page: Page, fields: DraftField[], extras: DraftExtra[]) {
  const values = new Map(fields.map(field => [field.field_key, String(field.value || '').trim()]));
  const filled: string[] = [];
  const skipped: Array<{ key: string; value: string; reason: string }> = [];
  for (const [key, selector] of Object.entries(FIELD_SELECTORS)) {
    let value = values.get(key) || '';
    if (!value) continue;
    value = VALUE_ALIASES[key]?.[value] || value;
    const control = page.locator(selector).first();
    if (!await control.count()) { skipped.push({ key, value, reason: 'Полето липсва в Mobile.bg.' }); continue; }
    const tag = await control.evaluate(element => element.tagName);
    const ok = tag === 'SELECT' ? await selectText(page, selector, value) : await control.fill(value).then(() => true);
    if (!ok) { skipped.push({ key, value, reason: 'Няма съвпадаща опция.' }); continue; }
    filled.push(key);
    if (key === 'make' || key === 'location') await page.waitForTimeout(500);
  }
  const derived = [
    values.get('drivetrain') === '4x4' ? '4x4' : '',
    values.get('doors') === '2/3' ? '2(3) Врати' : values.get('doors') === '4/5' ? '4(5) Врати' : '',
    values.get('seats') === '7' ? '7 места' : '', values.get('leasing') === 'Да' ? 'Лизинг' : '',
    values.get('barter') === 'Да' ? 'Бартер' : '',
  ].filter(Boolean);
  const wantedExtras = new Set([...extras.filter(e => e.selected).map(e => EXTRA_ALIASES[e.mobile_bg_label] || e.mobile_bg_label), ...derived]);
  for (const label of wantedExtras) {
    const checkbox = page.locator(`xpath=//input[@type="checkbox" and @value=${JSON.stringify(label)}]`).first();
    if (await checkbox.count()) { await checkbox.check(); filled.push(`extra:${label}`); }
    else skipped.push({ key: `extra:${label}`, value: label, reason: 'Няма точно съвпадение.' });
  }
  const description = values.get('final_description') || values.get('description') || '';
  if (description) {
    const textarea = page.locator('textarea').first();
    if (await textarea.count()) { await textarea.fill(description); filled.push('final_description'); }
    else skipped.push({ key: 'final_description', value: description, reason: 'Полето за описание липсва.' });
  }
  return { filled, skipped };
}

async function finish(job: PublishJob, status: string, details: Record<string, unknown>, error?: string) {
  await db.from('mobile_bg_publish_jobs').update({ status, result: details, last_error: error || null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id);
  const draftStatus = status === 'COMPLETED' ? 'PUBLISHED' : status === 'PREVIEW_READY' ? 'APPROVED' : status === 'NEEDS_LOGIN' ? 'PUBLISH_LOGIN_REQUIRED' : 'ERROR';
  await db.from('mobile_bg_drafts').update({ status: draftStatus, publish_error: error || null, published_at: status === 'COMPLETED' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', job.draft_id);
  await db.from('mobile_bg_draft_action_log').insert({ draft_id: job.draft_id, action: `MOBILE_PUBLISH_${status}`, actor: workerName, details });
}

async function run() {
  const { data, error } = await db.rpc('claim_mobile_bg_publish_job', { worker_name: workerName });
  if (error) throw error;
  const job = (data?.[0] || null) as PublishJob | null;
  if (!job) return console.log('Няма чакаща заявка за публикуване.');
  const [fieldResult, extraResult] = await Promise.all([
    db.from('mobile_bg_draft_fields').select('field_key,value').eq('draft_id', job.draft_id),
    db.from('mobile_bg_draft_extras').select('mobile_bg_label,selected').eq('draft_id', job.draft_id).eq('selected', true),
  ]);
  if (fieldResult.error) throw fieldResult.error;
  if (extraResult.error) throw extraResult.error;
  const context = await chromium.launchPersistentContext(profileDir, { headless: process.env.MOBILE_BG_HEADLESS === 'true' });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(newListingUrl, { waitUntil: 'domcontentloaded' });
    const loginState = await loginIfNeeded(page);
    if (loginState === 'credentials_missing') return await finish(job, 'NEEDS_LOGIN', { url: page.url() }, 'Нужен е еднократен защитен вход в Mobile.bg на сървъра.');
    if (loginState === 'form_not_recognized' || loginState === 'login_failed') return await finish(job, 'NEEDS_LOGIN', { url: page.url(), reason: loginState }, 'Mobile.bg не прие автоматичния вход.');
    const result = await populateStepOne(page, fieldResult.data || [], extraResult.data || []);
    const screenshotPath = `/tmp/mobile-bg-${job.id}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (job.mode === 'LIVE') return await finish(job, 'NEEDS_CONFIGURATION', { ...result, url: page.url() }, 'Публикуването на живо е блокирано, докато стъпки 2 и 3 не бъдат проверени с тестова обява.');
    await finish(job, 'PREVIEW_READY', { ...result, url: page.url(), login_state: loginState, screenshot_path: screenshotPath, message: 'Стъпка 1 е попълнена без изпращане към Mobile.bg.' });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Непозната грешка.';
    await finish(job, 'FAILED', { message }, message);
  } finally { await context.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
