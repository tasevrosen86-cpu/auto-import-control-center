// Read-only report of the isolated Publications tables.
//
// Answers one question: why did `drain` process nothing. The worker can be
// perfectly logged in and still print `{"processed":0}`, because that result only
// means no job was claimed. The break is then somewhere earlier — no draft, a
// draft that never reached READY, missing fields, no selected images — and each
// of those is a different fix. This prints them all, in order, so the step that
// is actually empty is visible instead of guessed.
//
// Reads only. No insert, no update, no publish, no browser. It prints counts and
// statuses, never a secret and never the service key.
//
// Run on the VPS: node src/queue-report.mjs

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) {
  console.error('Липсва SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const line = (label, value) => console.log(`  ${String(label).padEnd(34)} ${value}`);
const stamp = (value) => (value ? String(value).slice(0, 19).replace('T', ' ') : '—');

const { data: jobs, error: jobsError } = await db
  .from('publication_publish_jobs')
  .select('id,draft_id,status,error_message,public_url,requested_at,finished_at')
  .order('requested_at', { ascending: false })
  .limit(10);
if (jobsError) console.log(`  publication_publish_jobs: ГРЕШКА ${jobsError.message}`);
if (jobsError?.message?.includes('does not exist')) {
  console.log('  Миграцията за publication_* не е приложена — затова опашката не може да върне ред.');
}

const { data: drafts, error: draftsError } = await db
  .from('publication_drafts')
  .select('id,title,source_url,source_type,status,extraction_status,extraction_error,price_eur,created_at')
  .order('created_at', { ascending: false })
  .limit(10);
if (draftsError) console.log(`  publication_drafts: ГРЕШКА ${draftsError.message}`);

console.log('═══ ЗАДАЧИ ЗА ПУБЛИКУВАНЕ ═══');
if (!jobs?.length) console.log('  (няма нито една задача за публикуване)');
for (const job of jobs || []) {
  line('job', job.id.slice(0, 8));
  line('  чернова', job.draft_id.slice(0, 8));
  line('  състояние', job.status);
  line('  поискана', stamp(job.requested_at));
  if (job.error_message) line('  грешка', job.error_message.slice(0, 160));
  if (job.public_url) line('  публичен адрес', job.public_url);
}

console.log('\n═══ ЧЕРНОВИ ═══');
if (!drafts?.length) console.log('  (няма нито една чернова)');
for (const draft of drafts || []) {
  const [{ count: fieldCount }, { count: imageCount }, { count: selectedImages }, { count: extras }] = await Promise.all([
    db.from('publication_draft_fields').select('*', { count: 'exact', head: true }).eq('draft_id', draft.id),
    db.from('publication_draft_images').select('*', { count: 'exact', head: true }).eq('draft_id', draft.id),
    db.from('publication_draft_images').select('*', { count: 'exact', head: true }).eq('draft_id', draft.id).eq('is_selected', true),
    db.from('publication_draft_extras').select('*', { count: 'exact', head: true }).eq('draft_id', draft.id).eq('selected', true),
  ]);
  const { data: fieldRows } = await db.from('publication_draft_fields').select('field_key,value').eq('draft_id', draft.id);
  const present = new Set((fieldRows || []).filter((row) => String(row.value || '').trim()).map((row) => row.field_key));
  const required = ['make', 'model', 'year', 'mileage', 'fuel', 'gearbox', 'color'];
  const missing = required.filter((name) => !present.has(name));

  line('draft', `${draft.id.slice(0, 8)} · ${draft.title || draft.source_url || '(без заглавие)'}`.slice(0, 70));
  line('  състояние', `${draft.status} · извличане ${draft.extraction_status}${draft.extraction_error ? ` (${String(draft.extraction_error).slice(0, 80)})` : ''}`);
  line('  EUR цена', draft.price_eur ?? '—');
  line('  полета/избрани снимки/екстри', `${fieldCount ?? 0} / ${selectedImages ?? 0} (всички ${imageCount ?? 0}) / ${extras ?? 0}`);
  line('  създадена', stamp(draft.created_at));
  // These three gates are exactly what `processJob` and the queue function check
  // before a job can exist, so naming the first failing one is the whole point.
  if (draft.status !== 'READY') line('  → пречка', 'черновата не е READY (нужна е EUR цена през „Подготви чернова“)');
  else if (missing.length) line('  → пречка', `липсват полета: ${missing.join(', ')}`);
  else if (!selectedImages) line('  → пречка', 'няма избрана снимка');
  else line('  → пречка', 'няма — може да се постави задача за публикуване');
}

const { data: sources, error: sourcesError } = await db
  .from('publication_source_jobs')
  .select('id,draft_id,source_url,status,error_message,created_at')
  .order('created_at', { ascending: false })
  .limit(8);
console.log('\n═══ ИЗВЛИЧАНЕ ОТ URL ═══');
if (sourcesError) console.log(`  publication_source_jobs: ГРЕШКА ${sourcesError.message}`);
else if (!sources?.length) console.log('  (няма нито едно извличане — URL импортерът не е пускан)');
for (const source of sources || []) {
  line('източник', `${String(source.source_url || '').slice(0, 60)}`);
  line('  състояние', `${source.status} · чернова ${String(source.draft_id || '—').slice(0, 8)}${source.error_message ? ` · ${String(source.error_message).slice(0, 100)}` : ''}`);
}

// The gate that most often explains "nothing happened": real publishing is off,
// or on for a different draft than the one queued.
console.log('\n═══ ПРЕВКЛЮЧВАТЕЛ ЗА РЕАЛНО ПУБЛИКУВАНЕ ═══');
line('PUBLICATIONS_REAL_PUBLISH_ENABLED', process.env.PUBLICATIONS_REAL_PUBLISH_ENABLED || '(не е зададен)');
line('PUBLICATIONS_REAL_PUBLISH_DRAFT_ID', process.env.PUBLICATIONS_REAL_PUBLISH_DRAFT_ID || '(не е зададен)');
line('PUBLICATIONS_BROWSER_MODE', process.env.PUBLICATIONS_BROWSER_MODE || '(не е зададен)');
