import { createClient } from '@supabase/supabase-js';
import { chromium, type Page } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    'button:has-text("Публикувай")',
    'input[type="submit"][value="Публикувай"]',
    'input[type="button"][value="Публикувай"]',
  ];
  const clicked = await clickVisibleButton(page, selectors);
  if (!clicked) return { submitted: false, verified: false, beforeUrl, afterUrl: page.url(), reason: 'Не е намерен точният финален бутон „Публикувай“.' };
  await page.waitForTimeout(1500);
  const afterUrl = page.url();
  const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\\s+/g, ' ').trim();
  const confirmation = /обявата.{0,80}(публикувана|активна|създадена)|успешно.{0,80}(публику|обяв)|публикуването.{0,80}(успешно|завърши)/i.test(bodyText);
  const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => (anchor as HTMLAnchorElement).href).filter(Boolean));
  const listingUrl = links.find(link => /mobile\\.bg/i.test(link) && /(act=4|adv=|obiava)/i.test(link)) || (/(act=4|adv=|obiava)/i.test(afterUrl) ? afterUrl : null);
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
      worker_name: workerName,
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
  const context = await chromium.launchPersistentContext(profileDir, { headless: process.env.MOBILE_BG_HEADLESS === 'true' });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(newListingUrl, { waitUntil: 'domcontentloaded' });
    const loginState = await loginIfNeeded(page);
    if (loginState === 'credentials_missing') return await finish(job, 'NEEDS_LOGIN', { url: page.url() }, 'Нужен е еднократен защитен вход в Mobile.bg на сървъра.');
    if (loginState === 'form_not_recognized' || loginState === 'login_failed') return await finish(job, 'NEEDS_LOGIN', { url: page.url(), reason: loginState }, 'Mobile.bg не прие автоматичния вход.');
    const result = await populateStepOne(page, fieldResult.data || [], extraResult.data || []);
    const dataStage = await advanceFromDataStage(page);
    if (!dataStage.advanced) return await finish(job, 'NEEDS_CONFIGURATION', { ...result, data_stage: dataStage, url: page.url(), login_state: loginState }, dataStage.reason || 'Неуспешно преминаване към етапа със снимки.');
    const imageUpload = await uploadSelectedImages(page, (imageResult.data || []) as DraftImage[]);
    if (imageUpload.uploaded === 0) return await finish(job, 'NEEDS_CONFIGURATION', { ...result, data_stage: dataStage, image_upload: imageUpload, url: page.url(), login_state: loginState }, 'Няма качени избрани снимки. Избери поне една снимка за обявата.');
    const screenshotPath = `/tmp/mobile-bg-${job.id}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    if (job.mode === 'LIVE') {
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
  } finally { await context.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
