// Removes the server-side files that belong to a deleted «Обяви» draft.
//
// Why this is a separate worker: the pictures the API publisher converts are
// written into the public web root on this machine (see `pictures.ts`), and the
// browser the admin uses cannot reach that disk. `purge_mobile_bg_draft` only
// queues the work; this is what actually does it.
//
// It is deliberately its own service with its own queue. The API publisher is
// left completely alone: this worker never reads or writes
// `mobile_bg_publish_jobs`, never claims a job, and never opens the network.
// A failure here therefore cannot stop publishing.

import { createClient } from '@supabase/supabase-js';
import { cleanDraftFiles } from './cleanup.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const workerName = process.env.WORKER_NAME || `aicc-mobile-bg-cleanup-${process.pid}`;
// A run is short — a directory removal and a few stat calls — so a job still
// RUNNING after this long means the process died mid-run. Without a reclaim such
// a row would sit in RUNNING forever and its files would never be removed.
const staleAfterMs = Number(process.env.CLEANUP_STALE_AFTER_MS || 15 * 60 * 1000);

// The same root the API publisher writes into. Only the upload subdirectory is
// ever touched, so a bug in this worker cannot reach the deployed site.
const picturesRoot = process.env.MOBILE_BG_API_PICTURE_ROOT || '/var/www/html';
// Screenshots the browser publisher leaves behind, keyed by job id.
const screenshotDir = process.env.MOBILE_BG_SCREENSHOT_DIR || '/tmp';

type PurgeJob = {
  id: string;
  draft_id: string;
  attempt_count: number;
  snapshot: { photo_prefix?: string; job_ids?: string[] } | null;
};

async function main(): Promise<void> {
  if (!supabaseUrl || !supabaseKey) {
    console.error('Липсва SUPABASE_URL или ключ.');
    process.exitCode = 1;
    return;
  }

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // Reclaim work left RUNNING by a process that died. Removal is idempotent, so
  // re-running a half-finished cleanup is safe; leaving it stuck is not.
  const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
  const { error: reclaimError } = await db
    .from('mobile_bg_purge_jobs')
    .update({ status: 'QUEUED', claimed_by: null, updated_at: new Date().toISOString() })
    .eq('status', 'RUNNING')
    .lt('started_at', staleBefore);
  if (reclaimError) throw reclaimError;

  // Two steps, the same shape the API publisher uses: pick the oldest queued row,
  // then claim it by id and status. A second worker that loses the race claims
  // nothing, so one directory is never cleaned twice.
  const { data: candidate, error: findError } = await db
    .from('mobile_bg_purge_jobs')
    .select('id,draft_id,attempt_count,snapshot')
    .eq('status', 'QUEUED')
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (!candidate) {
    console.log('Няма чакащо почистване на файлове.');
    return;
  }

  const { data: claimed, error: claimError } = await db
    .from('mobile_bg_purge_jobs')
    .update({
      status: 'RUNNING',
      claimed_by: workerName,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id)
    .eq('status', 'QUEUED')
    .select('id,draft_id,attempt_count,snapshot')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    console.log('Почистването вече се изпълнява от друг worker.');
    return;
  }

  const job = claimed as PurgeJob;
  const result = await cleanDraftFiles({
    draftId: job.draft_id,
    picturesRoot,
    screenshotDir,
    jobIds: job.snapshot?.job_ids || [],
  });

  await db.from('mobile_bg_purge_jobs').update({
    status: result.failed ? 'FAILED' : 'COMPLETED',
    error_message: result.error_message,
    note: result.notes.join(' '),
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    attempt_count: (job.attempt_count || 0) + 1,
    snapshot: {
      ...(job.snapshot || {}),
      pictures_removed: result.pictures_removed,
      picture_bytes: result.picture_bytes,
      screenshots_removed: result.screenshots_removed,
    },
  }).eq('id', job.id);

  console.log(result.failed
    ? `Почистването на чернова ${job.draft_id} се провали: ${result.error_message}`
    : `Почистването на чернова ${job.draft_id} приключи. ${result.notes.join(' ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
