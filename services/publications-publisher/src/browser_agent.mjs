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
// attached when one is configured, so a task that needs the signed-in Mobile.bg
// session works the same way the manual browser does.
export async function startRun(task, options = {}) {
  const body = { task };
  if (options.model) body.model = options.model;

  const settings = {};
  const profile = options.profileId || process.env.BROWSER_PROFILE_ID;
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
export async function queueMessage(sessionId, text, options = {}) {
  const response = await fetch(`${API_BASE}${SESSIONS_PATH}/${encodeURIComponent(sessionId)}/queue`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ text, ...(options.interrupt ? { interrupt: true } : {}) }),
  });
  const data = await readJson(response);
  if (!response.ok) throw serviceError(response, data, 'добавянето на съобщение');
  return data;
}
