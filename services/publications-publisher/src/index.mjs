// Worker and CLI for the Publications section.
//
// It only ever touches publication_* tables. The mobile_bg_* tables and the old
// «Обяви» publisher are deliberately out of reach here, so the two flows cannot
// interfere and the old one stays usable as a fallback.
//
// Credentials come from the server environment only. The anon key is fine for
// the publication_* tables because they are granted and policied for it; a
// service role key is not required.

import { createClient } from '@supabase/supabase-js';
import { openSession, describeTransport } from './session.mjs';
import { inspectForm, publishOne, openForm, ensureLoggedIn } from './form.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Липсват SUPABASE_URL и SUPABASE_ANON_KEY (или SUPABASE_SERVICE_ROLE_KEY).');

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const WORKER = process.env.PUBLICATIONS_WORKER_NAME || `publications-${process.pid}`;

async function log(jobId, step, message, level = 'info') {
  console.log(`[${level}] ${step || '-'} ${message}`);
  await db.from('publication_logs').insert({ job_id: jobId, level, step, message }).then(() => undefined, () => undefined);
}

async function finish(job, status, details, error) {
  await db.from('publication_jobs').update({
    status,
    last_error: error || null,
    public_url: details.listing_url || null,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  await db.from('publication_results').insert({
    job_id: job.id,
    state: details.state || status.toLowerCase(),
    listing_url: details.listing_url || null,
    filled: details.filled || [],
    skipped: details.skipped || [],
    photo_check: details.public_photo_check || null,
    message: error || details.message || null,
  });
}

// Step one of the user's plan: prove what the browser really loads before any
// publisher logic is trusted. The remote Browser Use browser is what is being
// tested, so its live view URL is reported for watching the session.
export async function browserTest() {
  const session = await openSession();
  try {
    await log(null, 'browser_test', `Транспорт: ${JSON.stringify(describeTransport())}`);
    if (session.liveUrl) await log(null, 'browser_test', `Наблюдение на сесията: ${session.liveUrl}`);
    await openForm(session);
    // Sign in first: the publisher URL serves the public page to a signed-out
    // browser, so the form only appears after this.
    const login = await ensureLoggedIn(session);
    await log(null, 'browser_test', `Вход: ${login.state}`, login.state === 'login_failed' || login.state === 'form_not_recognized' ? 'error' : 'info');
    await openForm(session);
    const form = await inspectForm(session);
    await log(null, 'browser_test', `Присъда: ${form.verdict}. ${form.reason}`, form.verdict === 'SUCCESS' ? 'info' : 'error');
    return { ...form, login_state: login.state, live_url: session.liveUrl || null, browser_id: session.browserId || null };
  } finally {
    await session.close();
  }
}

async function prepare(job) {
  const session = await openSession();
  try {
    await log(job.id, 'prepare', 'Отварям формата, за да видя дали е достъпен.');
    await openForm(session);
    const form = await inspectForm(session);
    await log(job.id, 'prepare', `Форма: ${JSON.stringify(form)}`, form.form_found ? 'info' : 'error');
    if (!form.form_found) {
      await finish(job, 'BLOCKED', { state: 'blocked', message: form.body_text },
        `Формата на Mobile.bg не се зареди (${form.control_count} полета). Страницата върна: ${form.body_text || 'нищо'}`);
      return;
    }
    await finish(job, 'COMPLETED', { state: 'prepared', message: 'Формата е достъпна и полетата са налични.' });
  } finally {
    await session.close();
  }
}

async function publish(job) {
  const payload = job.payload || {};
  const session = await openSession();
  try {
    await log(job.id, 'publish', `Публикувам ${payload.make || ''} ${payload.model || ''} (${payload.year || ''}).`);
    const result = await publishOne(session, {
      ...payload,
      stageImages: () => session.stageImages(payload.source_images || []),
    });
    const status = result.state === 'published' ? 'COMPLETED' : result.state === 'published_no_photos' ? 'COMPLETED' : 'FAILED';
    await finish(job, status, result, result.state === 'failed' ? result.message : (result.state === 'published_no_photos' ? 'Обявата излезе, но проверката не намери снимките.' : null));
    await log(job.id, 'publish', `Резултат: ${result.state}.`, status === 'COMPLETED' ? 'info' : 'error');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Непозната грешка.';
    await finish(job, 'FAILED', { state: 'failed' }, message);
    await log(job.id, 'publish', message, 'error');
  } finally {
    await session.close();
  }
}

// A job is only taken from QUEUED, and a failure never puts it back, so a run
// that hits a challenge cannot turn into a retry loop against Mobile.bg.
export async function drain() {
  const { data: claimed, error } = await db.rpc('claim_publication_job', { worker_name: WORKER });
  if (error) throw error;
  const job = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!job) return { processed: 0 };
  if (job.action === 'browser_test') return { processed: 1, result: await browserTest() };
  if (job.action === 'prepare') { await prepare(job); return { processed: 1 }; }
  await publish(job);
  return { processed: 1 };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const command = process.argv[2] || 'drain';
  const run = command === 'browser-test' ? browserTest() : drain();
  run.then((result) => {
    if (command === 'browser-test') {
      console.log('\n================ ПРИСЪДА ================');
      console.log(`  ${result.verdict}`);
      if (result.login_state) console.log(`  Вход: ${result.login_state}`);
      // The live view is the point of the remote browser: it can be watched by
      // a person while the session runs.
      if (result.live_url) console.log(`  Наблюдение на сесията: ${result.live_url}`);
      if (result.browser_id) console.log(`  Браузър: ${result.browser_id}`);
      console.log(`  Форма: ${result.form_found ? 'да' : 'не'} (${result.control_count} полета${result.has_make ? ', марката е налична' : ''})`);
      console.log(`  Адрес: ${result.url}`);
      console.log(`  ${result.reason}`);
      console.log(`  Транспорт: ${JSON.stringify(describeTransport())}`);
      console.log('=========================================');
      process.exit(result.verdict === 'SUCCESS' ? 0 : 1);
    }
    console.log(JSON.stringify(result));
  }).catch((error) => { console.error(error.message || error); process.exit(1); });
}