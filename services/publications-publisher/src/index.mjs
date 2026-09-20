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
import { preflight, isDuplicate } from './preflight.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// The browser gate must be runnable before the database is configured: it is the
// step that decides whether the form is reachable at all, and needing Supabase
// first would mean configuring a database to answer a question about a browser.
// The worker and the CLI still write every result when the credentials are there.
const db = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;
const WORKER = process.env.PUBLICATIONS_WORKER_NAME || `publications-${process.pid}`;

// The report requires progress after every significant step, and the
// specification makes the event log append-only. A log write must never be the
// reason a publish run fails, so a missing table is tolerated here.
async function log(jobId, step, message, level = 'info') {
  console.log(`[${level}] ${step || '-'} ${message}`);
  if (!db) return;
  await db.from('publication_logs').insert({ job_id: jobId, level, step, message }).then(() => undefined, () => undefined);
  await db.from('publication_events').insert({ job_id: jobId, state: step || 'step', worker: WORKER, message }).then(() => undefined, () => undefined);
}

async function finish(job, status, details, error) {
  if (!db) return;
  await db.from('publication_jobs').update({
    status,
    last_error: error || null,
    public_url: details.listing_url || null,
    mobilebg_url: details.listing_url || null,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(details.payload ? { payload: details.payload } : {}),
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
    // The worker does not sign in — the profile carries the session. A password
    // box means a person must establish it, so that is reported and not guessed.
    const login = await ensureLoggedIn(session);
    await log(null, 'browser_test', `Вход: ${login.state}`, login.state === 'session_required' ? 'error' : 'info');
    if (login.reason) await log(null, 'browser_test', login.reason, 'error');
    const form = await inspectForm(session);
    // A signed-out profile is not a block and must not be reported as one. Every
    // publish run opens with ensureLoggedIn's question, and the gate asks the
    // same question, so the two agree on what a signed-out page looks like.
    const verdict = login.state === 'session_required' || login.state === 'signed_in_without_form'
      ? 'session_required'
      : form.verdict;
    const reason = verdict === 'session_required'
      ? 'Публикуването изисква влязла сесия, а профилът е излязъл. Това не е блокада и не е проблем с полетата.'
      : form.reason;
    await log(null, 'browser_test', `Присъда: ${verdict}. ${reason}`, verdict === 'SUCCESS' ? 'info' : 'error');
    return {
      ...form, verdict, reason,
      login_state: login.state, login_reason: login.reason || null,
      live_url: session.liveUrl || null, browser_id: session.browserId || null,
    };
  } finally {
    await session.close();
  }
}

function draftValue(fields, ...keys) {
  for (const key of keys) {
    const value = fields.get(key);
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}
function draftNumber(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}
function draftFuel(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('дизел') || text.includes('diesel')) return 'diesel';
  if (text.includes('хибрид') || text.includes('hybrid')) return 'hybrid';
  if (text.includes('електр') || text.includes('electric')) return 'electric';
  if (text.includes('бенз') || text.includes('gas') || text.includes('petrol')) return 'petrol';
  return '';
}
function draftTransmission(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('полу') || text.includes('semi')) return 'semi-automatic';
  if (text.includes('автомат') || text.includes('automatic')) return 'automatic';
  if (text.includes('ръчна') || text.includes('manual')) return 'manual';
  return '';
}
function draftColor(value) {
  const text = String(value || '').toLowerCase();
  const found = [['сив','grey'],['gray','grey'],['черен','black'],['black','black'],['бял','white'],['white','white'],['среб','silver'],['silver','silver'],['син','blue'],['blue','blue'],['червен','red'],['red','red'],['кафяв','brown'],['brown','brown'],['зелен','green'],['green','green'],['беж','beige'],['beige','beige'],['оранж','orange'],['orange','orange'],['злат','gold'],['gold','gold']].find((pair) => text.includes(pair[0]));
  return found ? found[1] : '';
}
function draftBody(value) {
  const text = String(value || '').toLowerCase();
  const found = [['джип','large_suv'],['suv','large_suv'],['седан','sedan'],['sedan','sedan'],['комби','wagon'],['wagon','wagon'],['хечбек','hatchback'],['hatch','hatchback'],['купе','coupe'],['coupe','coupe'],['кабрио','convertible'],['convertible','convertible'],['пикап','pickup'],['pickup','pickup'],['ван','van'],['minivan','van']].find((pair) => text.includes(pair[0]));
  return found ? found[1] : '';
}

// Freeze the ready direct-URL draft into the publication job. The catalogue is
// intentionally not queried or required here.
async function materializeReadyDraft(job) {
  const draftId = String(job.payload?.draft_id || '');
  if (!draftId) throw new Error('Липсва готова чернова от директен линк.');

  const { data: draft, error: draftError } = await db.from('mobile_bg_drafts')
    .select('id,title,source_url,source_type,extraction_status,catalog_permanent_id')
    .eq('id', draftId).single();
  if (draftError || !draft) throw new Error('Черновата не е намерена.');
  if (draft.catalog_permanent_id) throw new Error('Това е каталожна чернова. Publisher-ът приема само директен URL import.');
  if (!draft.source_url || draft.extraction_status !== 'COMPLETED_NEEDS_REVIEW') {
    throw new Error('Черновата още не е готова за публикация.');
  }

  const [{ data: fieldRows, error: fieldError }, { data: imageRows, error: imageError }] = await Promise.all([
    db.from('mobile_bg_draft_fields').select('field_key,value').eq('draft_id', draftId),
    db.from('mobile_bg_draft_images').select('source_url,processing_status').eq('draft_id', draftId).eq('is_selected', true).order('display_order').limit(17),
  ]);
  if (fieldError || imageError) throw new Error('Не могат да се прочетат подготвените полета или снимки.');

  const fields = new Map((fieldRows || []).map((row) => [row.field_key, row.value]));
  const images = (imageRows || []).filter((image) => image.source_url && image.processing_status !== 'failed').map((image) => image.source_url);
  return {
    draft_id: draft.id,
    source: draft.source_type === 'autotrader_ca' ? 'autotrader.ca' : draft.source_type,
    source_url: draft.source_url,
    source_images: images,
    title: draftValue(fields, 'title') || draft.title || '',
    make: draftValue(fields, 'make'),
    model: draftValue(fields, 'model'),
    year: draftNumber(draftValue(fields, 'year')),
    mileage: draftNumber(draftValue(fields, 'mileage')),
    fuel: draftFuel(draftValue(fields, 'fuel')),
    transmission: draftTransmission(draftValue(fields, 'gearbox', 'transmission')),
    body: draftBody(draftValue(fields, 'body', 'body_type', 'category')),
    color: draftColor(draftValue(fields, 'color')),
    power: draftNumber(draftValue(fields, 'power')),
    description: draftValue(fields, 'final_description', 'description'),
    price_eur: Number(job.payload?.price_eur ?? draftValue(fields, 'price')),
    currency: 'EUR',
    month: 'Декември',
    country_label: 'Канада',
  };
}

async function readyPayload(job) {
  const payload = await materializeReadyDraft(job);
  const check = preflight(payload);
  if (!check.ok) {
    const message = check.failures.map((failure) => failure.message).join(' ');
    await log(job.id, 'blocked', message, 'error');
    await finish(job, 'BLOCKED', { state: check.failures[0].code, payload, message }, message);
    return null;
  }
  for (const note of check.notes) await log(job.id, 'preflight', note);
  const { data: existing } = await db.from('publication_jobs').select('payload,public_url,status').limit(200);
  if (isDuplicate(payload, existing || [])) {
    const message = 'За този директен линк вече има активна обява.';
    await finish(job, 'BLOCKED', { state: 'duplicate_skipped', payload, message }, message);
    return null;
  }
  return payload;
}

async function prepare(job) {
  const payload = await readyPayload(job);
  if (!payload) return;

  const session = await openSession();
  try {
    await log(job.id, 'prepare', 'Проверявам готовата чернова срещу Mobile.bg формата.');
    await openForm(session);
    const login = await ensureLoggedIn(session);
    const form = await inspectForm(session);
    if (login.state !== 'already_logged_in' || !form.form_found) {
      const message = 'BrowserUse профилът няма валидна Mobile.bg сесия или формата не се зареди.';
      await finish(job, 'BLOCKED', { state: 'session_required', payload, message }, message);
      return;
    }
    await finish(job, 'COMPLETED', { state: 'ready', payload, message: 'Черновата е готова за реално публикуване.' });
  } finally {
    await session.close();
  }
}

async function publish(job) {
  const payload = await readyPayload(job);
  if (!payload) return;

  const session = await openSession();
  try {
    await log(job.id, 'publish', 'Публикувам готовата чернова в Mobile.bg.');
    if (session.liveUrl) await log(job.id, 'publish', 'Наблюдение на сесията: ' + session.liveUrl);
    await openForm(session);
    const login = await ensureLoggedIn(session);
    if (login.state !== 'already_logged_in') {
      const message = 'Нужен е еднократен ръчен вход в Mobile.bg BrowserUse профила.';
      await finish(job, 'BLOCKED', { state: 'session_required', payload, message }, message);
      return;
    }
    const result = await publishOne(session, {
      ...payload,
      stageImages: (urls) => session.stageImages(urls || payload.source_images || []),
    });
    const completed = result.state === 'published' || result.state === 'published_no_photos';
    await finish(job, completed ? 'COMPLETED' : 'FAILED', { ...result, payload },
      result.state === 'failed' ? result.message : (result.state === 'published_no_photos' ? 'Обявата е намерена, но снимките не бяха потвърдени.' : null));
    await log(job.id, 'publish', 'Резултат: ' + result.state + '.', completed ? 'info' : 'error');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Непозната грешка.';
    await finish(job, 'FAILED', { state: 'failed' }, message);
    await log(job.id, 'failed', message, 'error');
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
      if (result.verdict === 'session_required') {
        console.log(`  ${result.login_reason || 'Профилът е излязъл от Mobile.bg.'}`);
        console.log('  Пусни: node src/onboard.mjs — влиза се веднъж, ръчно, през живия изглед.');
      }
      console.log('=========================================');
      process.exit(result.verdict === 'SUCCESS' ? 0 : 1);
    }
    console.log(JSON.stringify(result));
  }).catch((error) => { console.error(error.message || error); process.exit(1); });
}