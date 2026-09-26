// The «Обяви» publishing worker that talks to the official Mobile.bg import API
// instead of driving a browser.
//
// It is a separate process from `services/mobile-publisher` on purpose: that one
// is the Browser Use path and is left untouched. The two share one queue table
// and are kept apart by the `transport` column — this worker only ever claims
// OFFICIAL_API jobs, the browser worker only BROWSER_ON_DEMAND ones. Without
// that split they would pick up each other's work.
//
// The order of a run is the order the API imposes:
//
//   1. login                     – the token is short-lived, so it is taken here
//   2. catfields                 – what this category declares it accepts
//   3. advertpub                 – the listing itself
//   4. advertpicts               – pictures, which need the listing's id
//   5. advertload                – read the listing back to prove it exists
//   6. logout                    – drop the token
//
// Step 4 is the one that can leave the system half-done: the listing exists and
// may already be paid for, but its pictures failed. The listing id is therefore
// written to the job before the pictures are attempted. A retry corrects that
// same listing instead of creating a second one, and the id the pictures are
// given is always the one `advertpub` returned in the current run — never a
// stored one, because a stored id that Mobile.bg no longer recognises is what
// produced `Wrong ida`.

import { createClient } from '@supabase/supabase-js';
import { MobileBgApiClient, MobileBgApiError, trimTrace, type TraceEntry } from './client.js';
import { resolvePictureListingId } from './publish-id.js';
import { preparePictures, verifyPubliclyReadable, pictureUrl, pictsValue, type SourceImage } from './pictures.js';
import { checkReadiness, summarizeReadiness } from './readiness.js';
import { EXTRI_SEPARATOR } from './mapping.js';
import { intersectWithCatfields, readCatfields } from './mapping.js';

type Job = {
  id: string;
  draft_id: string;
  mode: 'PREVIEW' | 'LIVE';
  listing_id: string | null;
  api_trace: TraceEntry[];
  attempt_count: number;
};

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const db = createClient(supabaseUrl, supabaseKey!, { auth: { persistSession: false } });

const workerName = process.env.WORKER_NAME || `mobile-bg-api-publisher-${process.pid}`;
const transport = 'OFFICIAL_API';

// Where the pictures are written and under which URL they can be fetched. The
// API downloads them from the host registered against the Mobile.bg account, so
// this base URL must be exactly that host.
const publicRoot = process.env.MOBILE_BG_API_PICTURE_ROOT || '/var/www/html';
const pictureBaseUrl = (process.env.MOBILE_BG_API_PICTURE_BASE_URL || 'https://autoimportcontrolcenter.biz').replace(/\/+$/, '');
const picturePrefix = process.env.MOBILE_BG_API_PICTURE_PREFIX || '';

// The documented token lifetime is three minutes. A token is re-issued once it
// is older than this, leaving a margin for the call that follows it, because the
// only thing worse than a refusal is a listing published on an expired token.
const TOKEN_REFRESH_AFTER_MS = 90_000;

// The published listing's URL, for the draft record. The API returns an id but
// no canonical link, so the link is built from the documented listing URL shape.
function listingUrl(ida: string): string {
  return `https://www.mobile.bg/pcgi/mobile.cgi?act=4&adv=${ida}`;
}

async function finish(
  job: Job,
  status: string,
  outcome: Record<string, unknown>,
  error?: string,
  trace: TraceEntry[] = [],
): Promise<void> {
  await db.from('mobile_bg_publish_jobs').update({
    status,
    claimed_by: workerName,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error: error ?? null,
    result: outcome,
    api_trace: trimTrace(trace),
  }).eq('id', job.id);
  await db.from('mobile_bg_draft_action_log').insert({
    draft_id: job.draft_id,
    action: status === 'COMPLETED' ? 'MOBILE_API_PUBLISH_COMPLETED' : `MOBILE_API_PUBLISH_${status}`,
    actor: 'API',
    details: { transport, status, error: error ?? null, steps: trace.length },
  }).then(() => undefined, () => undefined);
}

// The whole run for one job. Throwing is avoided: every failure path is a
// deliberate status, because a crash would leave the job RUNNING and the broker
// staring at a stuck button.
async function runJob(job: Job): Promise<void> {
  const client = new MobileBgApiClient();
  const trace: TraceEntry[] = [];
  const notes: string[] = [];
  let loggedInAt = 0;

  const persist = async (status: string, extra: Record<string, unknown> = {}): Promise<void> => {
    trace.push(...client.trace.splice(0, client.trace.length));
    await db.from('mobile_bg_publish_jobs').update({
      status,
      updated_at: new Date().toISOString(),
      api_trace: trimTrace(trace),
      result: { transport, notes, ...extra },
    }).eq('id', job.id);
  };

  // Every terminal write goes through here so the notes always travel with the
  // outcome. A failure is exactly when the notes matter most — the warnings from
  // the pre-flight check and the reason a fallback was taken are what explain
  // it — and without this each early return had to remember to include them.
  const finishJob = async (
    status: string,
    outcome: Record<string, unknown>,
    error?: string,
  ): Promise<void> => finish(job, status, { notes, ...outcome }, error, trace);

  try {
    const [fieldResult, extraResult, imageResult, draftResult] = await Promise.all([
      db.from('mobile_bg_draft_fields').select('field_key,value').eq('draft_id', job.draft_id),
      db.from('mobile_bg_draft_extras').select('mobile_bg_label,selected').eq('draft_id', job.draft_id).eq('selected', true),
      db.from('mobile_bg_draft_images').select('source_url,local_path,is_selected,is_main,display_order').eq('draft_id', job.draft_id).order('display_order', { ascending: true }),
      // Existence only. The row is not read anywhere below, so nothing but `id`
      // is asked for: a column that the draft table does not have used to make
      // this the only query in the batch that failed, and the failure surfaced as
      // "не е намерена" rather than as the schema error it was.
      db.from('mobile_bg_drafts').select('id').eq('id', job.draft_id).maybeSingle(),
    ]);
    if (fieldResult.error) return await finishJob('FAILED', {}, `Грешка при четене на полетата: ${fieldResult.error.message}`);
    if (extraResult.error) return await finishJob('FAILED', {}, `Грешка при четене на екстрите: ${extraResult.error.message}`);
    if (imageResult.error) return await finishJob('FAILED', {}, `Грешка при четене на снимките: ${imageResult.error.message}`);
    // Checked before the existence answer, so a refused read is never reported as
    // a missing draft. That misdiagnosis cost three failed runs on a draft that
    // existed the whole time.
    if (draftResult.error) return await finishJob('FAILED', {}, `Грешка при четене на черновата: ${draftResult.error.message}`);
    if (!draftResult.data) return await finishJob('FAILED', {}, 'Черновата не е намерена.');

    const fields = (fieldResult.data || []) as Array<{ field_key: string; value: string | null }>;
    const extras = (extraResult.data || []) as Array<{ mobile_bg_label: string; selected: boolean }>;
    const images = (imageResult.data || []) as SourceImage[];
    const category = fields.find(row => row.field_key === 'category')?.value || null;
    const body = fields.find(row => row.field_key === 'body')?.value || null;

    // --- Pre-flight -------------------------------------------------------
    // Everything that can be checked without the network is checked first, so a
    // draft that cannot work is reported in full instead of failing halfway
    // through a paid publish.
    const readiness = checkReadiness({
      fields, extras, images, category, body,
      hasCredentials: client.hasCredentials(),
      existingListingId: job.listing_id,
      pictureBaseUrl,
    });
    notes.push(summarizeReadiness(readiness));
    for (const issue of readiness.issues) {
      notes.push(`${issue.severity === 'blocker' ? '✖' : '⚠'} ${issue.message}`);
    }
    if (!readiness.ready) {
      await persist('NEEDS_PUBLISHING', { readiness: readiness.issues, pictures_only: false });
      return await finishJob('NEEDS_PUBLISHING', {
        readiness: readiness.issues, stage: 'READINESS',
        message: 'Черновата не е готова за API-то. Данните не са изпращани.',
      }, readiness.issues.filter(i => i.severity === 'blocker').map(i => i.message).join(' '));
    }

    // --- Pictures, downloaded before the login ---------------------------
    // Downloading seventeen photos and converting them is the slowest part of a
    // run and needs no credential, so it happens while no token is ticking. The
    // paths it returns are then sent inside the token's three-minute window.
    const prepared = await preparePictures(images, {
      draftId: job.draft_id,
      publicRoot,
      publicPrefix: picturePrefix,
      keepExisting: Boolean(job.listing_id),
    });
    for (const skip of prepared.skipped) notes.push(`⚠ ${skip.reason}`);

    // --- Login ------------------------------------------------------------
    const login = await client.login();
    loggedInAt = Date.now();
    trace.push(...client.trace.splice(0, client.trace.length));
    if (!login.ok) {
      await persist('NEEDS_LOGIN', { readiness: readiness.issues });
      return await finishJob('NEEDS_LOGIN', {
        readiness: readiness.issues, stage: 'LOGIN',
        message: 'Входът в Mobile.bg през API-то се провали.',
      }, login.error || 'Входът се провали.');
    }
    notes.push('Входът е успешен; token е генериран.');

    // Re-issues the token when the current one is close to expiring. Without
    // this a slow publish followed by seventeen picture paths would be refused
    // on an expired token, which looks like a Mobile.bg rejection but is really
    // our own clock running out.
    const ensureFreshToken = async (): Promise<boolean> => {
      const age = Date.now() - loggedInAt;
      if (age < TOKEN_REFRESH_AFTER_MS) return true;
      notes.push(`Token-ът е на ${Math.round(age / 1000)} секунди; подновявам го преди следващата стъпка.`);
      const again = await client.login();
      loggedInAt = Date.now();
      trace.push(...client.trace.splice(0, client.trace.length));
      if (!again.ok) {
        notes.push(`⚠ Подновяването на token-а се провали: ${again.error}`);
        return false;
      }
      return true;
    };

    try {
      // --- Fields ---------------------------------------------------------
      const catfieldsResult = await client.catfields(Number(readiness.payload.params.topmenu || 1));
      trace.push(...client.trace.splice(0, client.trace.length));
      // A failed catfields read is not fatal: the payload is then sent
      // unfiltered, which is exactly what a first run needs to discover the
      // real schema. The failure is kept in the trace and in the notes.
      const catfields = catfieldsResult.ok ? readCatfields(catfieldsResult.payload) : { names: new Set<string>(), understood: false };
      if (!catfieldsResult.ok) {
        notes.push('⚠ Списъкът с полета не бе прочетен; изпращам всички параметри, за да видим точния отговор на Mobile.bg.');
      }
      const { sent, dropped } = intersectWithCatfields(readiness.payload.params, catfields);
      if (dropped.length > 0) {
        notes.push(`Пропуснати параметри, непознати за категорията: ${dropped.map(item => item.api_key).join(', ')}.`);
      }
      notes.push(`Изпращам ${Object.keys(sent).length} параметъра към категория ${sent.topmenu}.`);

      // --- Publish the listing --------------------------------------------
      // The id the pictures are attached to is decided here and nowhere else:
      // from the `advertpub` answer of this run, or from a stored id that
      // Mobile.bg has just confirmed still exists.
      const resolved = await resolvePictureListingId(client, { storedId: job.listing_id, fields: sent });
      trace.push(...client.trace.splice(0, client.trace.length));
      for (const note of resolved.notes) notes.push(note);
      if (!resolved.ida) {
        const stop = resolved.stop!;
        if (stop.clear_stored_id) {
          await db.from('mobile_bg_publish_jobs').update({ listing_id: null, updated_at: new Date().toISOString() }).eq('id', job.id);
        }
        await persist(stop.status, { readiness: readiness.issues, listing_id: stop.listing_id, sent_params: Object.keys(sent) });
        return await finishJob(stop.status, {
          stage: stop.stage, readiness: readiness.issues, listing_id: stop.listing_id,
          sent_params: Object.keys(sent), trace_steps: trace.length,
          message: stop.message,
        }, stop.error);
      }
      const ida = resolved.ida;
      if (!job.listing_id) {
        // Persisted before the pictures are attempted: this is what makes a
        // failed picture step retryable without republishing the listing.
        await db.from('mobile_bg_publish_jobs').update({ listing_id: ida, updated_at: new Date().toISOString() }).eq('id', job.id);
      }

      // --- Pictures --------------------------------------------------------
      // Re-issue the token if the publish took long enough to put it near its
      // three-minute limit, so the picture call is not refused on an expired
      // token after a listing was already created.
      await ensureFreshToken();

      let uploaded = 0;
      const pictureResults: Array<Record<string, unknown>> = [];
      if (prepared.pictures.length === 0) {
        notes.push('⚠ Няма подготвени снимки за изпращане.');
      } else {
        // Each file is checked to be publicly readable before its path is sent.
        // Mobile.bg fetching a 404 is reported as a picture error with no cause;
        // checking here keeps the cause in our hands.
        for (const picture of prepared.pictures) {
          const reachable = await verifyPubliclyReadable(pictureBaseUrl, picture);
          if (!reachable.ok) {
            notes.push(`✖ ${reachable.error}`);
            pictureResults.push({ path: picture.path, ok: false, reason: reachable.error });
          }
        }
        const sendable = prepared.pictures.filter(picture => !pictureResults.some(row => row.path === picture.path));
        if (sendable.length === 0) {
          await persist('NEEDS_PUBLISHING', { listing_id: ida, pictures: pictureResults });
          return await finishJob('NEEDS_PUBLISHING', {
            stage: 'PICTURES', listing_id: ida, listing_url: listingUrl(ida),
            pictures: pictureResults, message: 'Обявата е публикувана, но снимките не са достъпни от нашия домейн.',
          }, 'Нито една снимка не е публично достъпна под нашия домейн.');
        }

        // One call adds all of them: the API takes up to 17 names separated by
        // `~`, and splitting them into 17 calls would multiply the failure
        // surface for no benefit. TEMPORARY EXPERIMENT: each entry is host plus
        // path, with no scheme, to see whether Mobile.bg accepts a domain-qualified
        // value at all.
        const upload = await client.advertPicts(ida, 'add', { picts: sendable.map(picture => pictsValue(pictureBaseUrl, picture)).join('~') });
        trace.push(...client.trace.splice(0, client.trace.length));
        if (upload.ok) {
          uploaded = sendable.length;
          for (const picture of sendable) pictureResults.push({ path: picture.path, url: pictureUrl(pictureBaseUrl, picture), ok: true, bytes: picture.bytes });
          notes.push(`Изпратени ${uploaded} снимки с единa заявка.`);
        } else {
          // Adding all at once is atomic on Mobile.bg's side, so a rejection
          // sends nothing. Falling back to one call per picture turns that into
          // "the good ones landed", which a broker can act on.
          notes.push('⚠ Груповата заявка за снимки бе отказана; опитвам снимка по снимка.');
          for (const picture of sendable) {
            // Seventeen sequential calls can outlast the token, so it is
            // re-issued as the loop runs rather than only once before it.
            await ensureFreshToken();
            const one = await client.advertPicts(ida, 'add', { picts: pictsValue(pictureBaseUrl, picture) });
            trace.push(...client.trace.splice(0, client.trace.length));
            pictureResults.push({ path: picture.path, url: pictureUrl(pictureBaseUrl, picture), ok: one.ok, reason: one.ok ? null : one.error });
            if (one.ok) uploaded += 1;
          }
          notes.push(`Приети ${uploaded} от ${sendable.length} снимки.`);
        }
      }

      // Broken pictures do not invalidate the listing, but they must be visible:
      // the draft is left retryable so the pictures alone can be sent again.
      if (uploaded === 0 && prepared.pictures.length > 0) {
        await persist('NEEDS_PUBLISHING', { listing_id: ida, pictures: pictureResults });
        return await finishJob('NEEDS_PUBLISHING', {
          stage: 'PICTURES', listing_id: ida, listing_url: listingUrl(ida),
          pictures: pictureResults, message: 'Обявата е публикувана, но нито една снимка не бе приета.',
        }, 'Обявата е публикувана без снимки. Опитай отново снимките.');
      }

      // --- Verify ----------------------------------------------------------
      // `advertpub` answering "success" only means the request was accepted.
      // Reading the listing back is the only way to state that it exists.
      await ensureFreshToken();
      const verify = await client.advertLoad(ida);
      trace.push(...client.trace.splice(0, client.trace.length));
      const verified = verify.ok;
      if (!verified) {
        notes.push(`⚠ Обявата не можа да се прочете обратно: ${verify.error}`);
      }

      const outcome = {
        transport,
        stage: 'DONE',
        listing_id: ida,
        listing_url: listingUrl(ida),
        uploaded_pictures: uploaded,
        prepared_pictures: prepared.pictures.length,
        pictures: pictureResults,
        sent_params: Object.keys(sent),
        dropped_params: dropped.map(item => item.api_key),
        verified,
        readiness: readiness.issues,
        notes,
      };

      await db.from('mobile_bg_drafts').update({
        status: 'PUBLISHED',
        mobile_bg_url: listingUrl(ida),
        mobile_bg_listing_id: String(ida),
        publish_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', job.draft_id);

      await persist('COMPLETED', outcome);
      return await finishJob('COMPLETED', outcome);
    } finally {
      await client.logout();
      trace.push(...client.trace.splice(0, client.trace.length));
    }
  } catch (cause) {
    const message = cause instanceof MobileBgApiError
      ? `${cause.message} (стъпка ${cause.step}${cause.httpStatus ? `, HTTP ${cause.httpStatus}` : ''})`
      : cause instanceof Error ? cause.message : 'Непозната грешка.';
    await finishJob('FAILED', { stage: 'UNEXPECTED' }, message);
  }
}

async function run(): Promise<void> {
  // Claiming is scoped to this worker's transport. The browser worker scans the
  // same table by status alone, so a job must never be visible to both.
  const { data: candidate, error: findError } = await db
    .from('mobile_bg_publish_jobs')
    .select('id,draft_id,mode,listing_id,api_trace,attempt_count')
    .eq('transport', transport)
    .eq('status', 'QUEUED')
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (!candidate) return console.log('Няма чакаща API заявка за публикуване.');

  const { data: claimed, error: claimError } = await db
    .from('mobile_bg_publish_jobs')
    .update({
      status: 'RUNNING',
      claimed_by: workerName,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attempt_count: (candidate.attempt_count || 0) + 1,
    })
    .eq('id', candidate.id)
    .eq('status', 'QUEUED')
    .select('id,draft_id,mode,listing_id,api_trace,attempt_count')
    .maybeSingle();
  if (claimError) throw claimError;
  const job = (claimed || null) as Job | null;
  if (!job) return console.log('Заявката вече се обработва от друг worker.');

  console.log(`Стартирам ${workerName} за чернова ${job.draft_id} (транспорт ${transport}, опит ${job.attempt_count}).`);
  console.log(`Разделител за екстри: "${EXTRI_SEPARATOR}"`);
  await runJob(job);
}

// Reclaims jobs whose worker died mid-run, the same way the browser worker does.
// Restricted to this transport so it can never resurrect a browser job.
async function reclaimStale(): Promise<void> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await db.from('mobile_bg_publish_jobs')
    .update({
      status: 'QUEUED',
      claimed_by: null,
      last_error: 'Предишният опит прекъсна, задачата е върната в опашката.',
      updated_at: new Date().toISOString(),
    })
    .eq('transport', transport)
    .eq('status', 'RUNNING')
    .lt('started_at', cutoff);
}

reclaimStale()
  .catch(error => console.error('Почистването не успя:', error))
  .then(() => run())
  .catch(error => { console.error(error); process.exitCode = 1; });
