import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

type PublishJob = {
  id: string;
  draft_id: string;
  mode: 'PREVIEW' | 'LIVE';
};

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MOBILE_BG_USER_DATA_DIR'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Липсва ${name}.`);
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const workerName = process.env.WORKER_NAME || `mobile-publisher-${process.pid}`;
const profileDir = process.env.MOBILE_BG_USER_DATA_DIR!;
const newListingUrl = process.env.MOBILE_BG_NEW_LISTING_URL || 'https://www.mobile.bg/obiavi/dobavi';
const loginUser = process.env.MOBILE_BG_USERNAME;
const loginPassword = process.env.MOBILE_BG_PASSWORD;

async function fillFirst(page: import('playwright').Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.count()) {
      await field.fill(value);
      return true;
    }
  }
  return false;
}

async function loginIfNeeded(page: import('playwright').Page): Promise<'already_logged_in' | 'logged_in' | 'credentials_missing' | 'form_not_recognized' | 'login_failed'> {
  const passwordField = page.locator('input[type="password"]').first();
  if (await passwordField.count() === 0) return 'already_logged_in';
  if (!loginUser || !loginPassword) return 'credentials_missing';

  const userSelector = process.env.MOBILE_BG_LOGIN_USERNAME_SELECTOR;
  const passwordSelector = process.env.MOBILE_BG_LOGIN_PASSWORD_SELECTOR || 'input[type="password"]';
  const submitSelector = process.env.MOBILE_BG_LOGIN_SUBMIT_SELECTOR || 'button[type="submit"], input[type="submit"]';
  const usernameFilled = await fillFirst(page,
    userSelector ? [userSelector] : ['input[name="username"]', 'input[name="email"]', 'input[type="email"]', 'input[type="text"]'],
    loginUser,
  );
  const passwordFilled = await fillFirst(page, [passwordSelector], loginPassword);
  if (!usernameFilled || !passwordFilled) return 'form_not_recognized';

  const submit = page.locator(submitSelector).first();
  if (await submit.count() === 0) return 'form_not_recognized';
  await submit.click();
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(800);
  return await page.locator('input[type="password"]').count() === 0 ? 'logged_in' : 'login_failed';
}

async function finish(job: PublishJob, status: string, details: Record<string, unknown>, error?: string) {
  await db.from('mobile_bg_publish_jobs').update({
    status, result: details, last_error: error || null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  await db.from('mobile_bg_drafts').update({
    status: status === 'COMPLETED' ? 'PUBLISHED' : status === 'NEEDS_LOGIN' ? 'PUBLISH_LOGIN_REQUIRED' : 'ERROR',
    publish_error: error || null,
    published_at: status === 'COMPLETED' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', job.draft_id);
  await db.from('mobile_bg_draft_action_log').insert({
    draft_id: job.draft_id, action: `MOBILE_PUBLISH_${status}`, actor: workerName, details,
  });
}

async function run() {
  const { data, error } = await db.rpc('claim_mobile_bg_publish_job', { worker_name: workerName });
  if (error) throw error;
  const job = (data?.[0] || null) as PublishJob | null;
  if (!job) return console.log('Няма чакаща заявка за публикуване.');

  // Persistent storage holds only Mobile.bg's login/session.  The process exits
  // after the single job; the browser is never kept open between requests.
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: process.env.MOBILE_BG_HEADLESS === 'true',
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(newListingUrl, { waitUntil: 'domcontentloaded' });

    const loginState = await loginIfNeeded(page);
    if (loginState === 'credentials_missing') {
      await finish(job, 'NEEDS_LOGIN', { url: page.url(), reason: 'Mobile.bg credentials are not configured as server secrets.' }, 'Липсват защитените MOBILE_BG_USERNAME и MOBILE_BG_PASSWORD на сървъра.');
      return;
    }
    if (loginState === 'form_not_recognized' || loginState === 'login_failed') {
      await finish(job, 'NEEDS_LOGIN', { url: page.url(), reason: loginState }, 'Mobile.bg login формата трябва да се свери веднъж и селекторите да се запишат в server secrets.');
      return;
    }

    await page.screenshot({ path: `/tmp/mobile-bg-${job.id}.png`, fullPage: true });
    await finish(job, 'NEEDS_CONFIGURATION', {
      url: page.url(), mode: job.mode, login_state: loginState,
      message: 'Mobile.bg session is ready. A real form test is needed once to save verified listing field selectors before live publishing is enabled.',
    }, 'Не са записани проверени селектори за реалната форма на Mobile.bg.');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Непозната грешка.';
    await finish(job, 'FAILED', { message }, message);
  } finally {
    await context.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
