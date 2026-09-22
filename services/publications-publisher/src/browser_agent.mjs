// Browser Use AI Agent — the run API, not the browser infrastructure.
//
// `browser_use.mjs` creates a bare Chromium that our own step logic drives.
// This module is the other half of the same service: it hands a task to the
// agent and reads back its result. Both use the same key, and neither ever
// returns that key to a caller.
//
// The key is read from the server environment only. It is never accepted from a
// request, never echoed in an error and never written to a response body. The
// only addresses that leave this module are the run id and the session id,
// which are handles rather than credentials.

// The profile is resolved by the same code the visible browser uses, so the
// agent and the manual login can never disagree about which profile holds the
// Mobile.bg session. `browser_use.mjs` does not import this module, so there is
// no cycle.
import { resolveProfile } from './browser_use.mjs';

const API_BASE = process.env.BROWSER_USE_API_BASE || 'https://api.browser-use.com';
const RUNS_PATH = process.env.BROWSER_USE_RUNS_PATH || '/api/v4/runs';
const SESSIONS_PATH = process.env.BROWSER_USE_SESSIONS_PATH || '/api/v4/sessions';

// The guide's own limit. A task longer than this is a mistake, not a payload.
export const MAX_TASK_CHARS = 4000;

// Terminal states. A run that is done is never polled again, and the caller is
// told which of the three it was so a timeout is never mistaken for a failure.
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function agentConfigured() {
  return Boolean(process.env.BROWSER_USE_API_KEY);
}

function key() {
  const value = process.env.BROWSER_USE_API_KEY;
  if (!value) throw new Error('Липсва BROWSER_USE_API_KEY в средата на сървъра.');
  return value;
}

function headers(json = false) {
  return json
    ? { 'X-Browser-Use-API-Key': key(), 'Content-Type': 'application/json' }
    : { 'X-Browser-Use-API-Key': key() };
}

// A caller-supplied message must never be able to steer the key, leak it, or
// grow without bound. Trimming and a hard cap are the whole defence; the task
// itself is still treated as untrusted text by the agent.
export function cleanTask(raw) {
  return String(raw ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

export function taskProblem(task) {
  if (!task) return 'Въведете задача за агента.';
  if (task.length > MAX_TASK_CHARS) return `Задачата е твърде дълга (${task.length} знака, максимум ${MAX_TASK_CHARS}).`;
  return null;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Browser Use answers 402 when the account is out of credit. That is not a
// wrong key and not a block, and the three look identical from a distance, so
// the distinction is carried into the message.
function serviceError(response, body, action) {
  const hint = response.status === 402
    ? ' Акаунтът в Browser Use е без достатъчен баланс — заредете кредит.'
    : response.status === 401
      ? ' Ключът е невалиден или отменен.'
      : response.status === 429
        ? ' Достигнат е лимитът за паралелни задачи. Опитайте по-късно.'
        : '';
  const detail = typeof body?.detail === 'string'
    ? body.detail
    : typeof body?.error === 'string'
      ? body.error
      : (body?.raw || '').slice(0, 200);
  return new Error(`Browser Use отказа ${action}: HTTP ${response.status}${detail ? ' — ' + detail : ''}.${hint}`);
}

// Starts a run and returns immediately with its handles. The browser profile is
// attached so a task that needs the signed-in Mobile.bg session works the same
// way the visible browser does.
//
// The profile is resolved even when `BROWSER_PROFILE_ID` is unset. Leaving it
// out used to be the bug: the agent then ran in a fresh browser with no cookies,
// landed on Mobile.bg signed out, and could not find the publish form. The
// session lives in the profile, so the profile is not optional — it is what
// makes a run useful at all.
export async function startRun(task, options = {}) {
  const body = { task };
  if (options.model) body.model = options.model;

  const settings = {};
  let profile = options.profileId || process.env.BROWSER_PROFILE_ID;
  if (!profile && options.useProfile !== false) {
    // Resolved lazily so a caller that genuinely wants a clean browser can say
    // so, and so an ordinary run never depends on the id being configured.
    profile = await resolveProfile();
  }
  if (profile) settings.profileId = profile;
  if (process.env.BROWSER_USE_PROXY_COUNTRY) settings.proxyCountryCode = process.env.BROWSER_USE_PROXY_COUNTRY;
  if (Object.keys(settings).length) body.browserSettings = settings;

  if (options.maxCostUsd) body.maxCostUsd = options.maxCostUsd;

  const response = await fetch(`${API_BASE}${RUNS_PATH}`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw serviceError(response, data, 'създаването на задача');
  if (!data.id) throw new Error('Browser Use не върна идентификатор на задачата.');

  return {
    runId: data.id,
    sessionId: data.sessionId || null,
    status: data.status || 'queued',
    eventsUrl: data.eventsUrl || null,
  };
}

// Reads one run. `result` and `error` are only meaningful once the status is
// terminal, which is why they are nulled out before that rather than shown as
// stale text.
export async function runStatus(runId) {
  const response = await fetch(`${API_BASE}${RUNS_PATH}/${encodeURIComponent(runId)}`, {
    headers: headers(),
  });
  const data = await readJson(response);
  if (!response.ok) throw serviceError(response, data, 'четенето на задачата');

  const status = data.status || 'unknown';
  const terminal = TERMINAL.has(status);
  return {
    runId: data.id || runId,
    sessionId: data.sessionId || null,
    status,
    terminal,
    result: terminal ? (data.result ?? null) : null,
    error: terminal ? (data.error ?? null) : null,
    cost: data.totalCostUsd ?? null,
  };
}

// Continues the conversation in the same session. Browser Use calls this the
// session queue; the run id is not enough, the session id is what carries the
// context forward.
//
// The reply carries the `runId` the message created — measured against the live
// service: `QueuedMessage` has `runId`, `mode` and a `status` that walks
// pending → dispatching → consumed. That id is the only correct thing to poll
// afterwards. Polling the previous run id returns the *previous* run's result
// instantly, which looks like a successful follow-up and is not one.
export async function queueMessage(sessionId, text, options = {}) {
  const response = await fetch(`${API_BASE}${SESSIONS_PATH}/${encodeURIComponent(sessionId)}/queue`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ text, ...(options.interrupt ? { interrupt: true } : {}) }),
  });
  const data = await readJson(response);
  if (!response.ok) throw serviceError(response, data, 'добавянето на съобщение');
  return { messageId: data.id ?? null, runId: data.runId ?? null, status: data.status ?? null };
}

// Reads the session itself. `latestRunId` is the authoritative answer to "which
// run is the conversation on now", and it is also the cheap busy/idle poll the
// API documents for a conversation.
export async function sessionInfo(sessionId) {
  const response = await fetch(`${API_BASE}${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`, {
    headers: headers(),
  });
  const data = await readJson(response);
  if (!response.ok) throw serviceError(response, data, 'четенето на сесията');
  return {
    sessionId: data.sessionId || sessionId,
    latestRunId: data.latestRunId || null,
    status: data.status || 'unknown',
  };
}

// Waits for the follow-up to become its own run.
//
// `queueMessage` can accept a message before the new run exists, so the run id
// from the reply is sometimes null and sometimes still the old one. Reading the
// session until `latestRunId` differs from the run we came from is what makes
// the follow-up correct rather than merely plausible. A timeout is reported as
// "accepted but not started", not as a failure, because the message is not lost.
export async function waitForNewRun(sessionId, previousRunId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await sessionInfo(sessionId);
    if (last.latestRunId && last.latestRunId !== previousRunId) {
      return { ...last, started: true, seconds: Math.round((Date.now() - started) / 1000) };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    ...(last || { sessionId, latestRunId: null, status: 'unknown' }),
    started: false,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

