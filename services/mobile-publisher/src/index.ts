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

    // Selectors and the final submit button are deliberately not guessed.
    // During the one-time login/form test we store the verified selectors in a
    // site-specific adapter.  Until then this job produces a safe preview.
    const loginVisible = await page.locator('input[type="password"]').count() > 0;
    if (loginVisible) {
      await finish(job, 'NEEDS_LOGIN', { url: page.url(), reason: 'Mobile.bg login is required in this profile.' }, 'Влез еднократно в Mobile.bg през профила на бота.');
      return;
    }

    await page.screenshot({ path: `/tmp/mobile-bg-${job.id}.png`, fullPage: true });
    await finish(job, 'NEEDS_CONFIGURATION', {
      url: page.url(), mode: job.mode,
      message: 'Login session is present. A real form test is needed once to save verified Mobile.bg field selectors before live publishing is enabled.',
    }, 'Не са записани проверени селектори за реалната форма на Mobile.bg.');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Непозната грешка.';
    await finish(job, 'FAILED', { message }, message);
  } finally {
    await context.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
