// Exercises the bridge's agent routes over real HTTP, against a real stub API.
//
// The bridge is started as a child process exactly as the systemd unit starts
// it, then spoken to with fetch. There are no mocks: the stub stands in for
// Browser Use and the bridge is the code under test. What this pins down is the
// HTTP contract the site depends on — 400 without a run for a bad task, 503
// without a key, a run id on success, and no key anywhere in a response body.
//
// Run: node test/browser_agent_http.test.mjs

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

const seen = [];
const key = 'bu_bridge_test_key_abcdef';

const api = createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ url: request.url, body, headers: request.headers });
    const reply = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (request.url === '/api/v4/runs' && request.method === 'POST') {
      return reply(200, { id: 'run-http-1', status: 'queued', sessionId: 'sess-http-1', eventsUrl: '/e' });
    }
    if (request.url === '/api/v4/runs/run-http-1') {
      return reply(200, { id: 'run-http-1', status: 'completed', result: 'HTTP резултат', error: null, sessionId: 'sess-http-1' });
    }
    if (request.url === '/api/v4/runs/run-http-2') {
      return reply(200, { id: 'run-http-2', status: 'completed', result: 'Отговор от продължението', error: null, sessionId: 'sess-http-1' });
    }
    if (request.url === '/api/v4/sessions/sess-http-1/queue') {
      return reply(200, { id: 11, sessionId: 'sess-http-1', runId: 'run-http-2', mode: 'queue', status: 'pending' });
    }
    if (request.url === '/api/v4/sessions/sess-http-1') {
      return reply(200, { sessionId: 'sess-http-1', latestRunId: 'run-http-2', status: 'running' });
    }
    if (request.url === '/api/v4/sessions/sess-stuck/queue') {
      return reply(200, { id: 12, sessionId: 'sess-stuck', runId: null, mode: 'queue', status: 'pending' });
    }
    if (request.url === '/api/v4/sessions/sess-stuck') {
      // Never moves on: the bridge must report started:false, not hand back the
      // old run id, which would make the site display the old answer.
      return reply(200, { sessionId: 'sess-stuck', latestRunId: 'run-http-1', status: 'completed' });
    }
    return reply(404, { detail: 'no route ' + request.url });
  });
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const apiPort = api.address().port;

// A free port for the bridge, so a running service on 6081 is never disturbed.
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const bridgePort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));

const env = {
  ...process.env,
  BROWSER_USE_API_BASE: `http://127.0.0.1:${apiPort}`,
  BROWSER_USE_API_KEY: key,
  PUBLICATIONS_BROWSER_ACCESS_PORT: String(bridgePort),
};
const child = spawn(process.execPath, [join(here, '../src/browser-access-server.mjs')], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childLog = '';
child.stdout.on('data', (chunk) => { childLog += chunk; });
child.stderr.on('data', (chunk) => { childLog += chunk; });

const base = `http://127.0.0.1:${bridgePort}`;
async function ready() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await fetch(`${base}/nope`, { method: 'POST' }); return true; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  return false;
}
async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* raw kept below */ }
  return { status: response.status, payload, text };
}

if (!await ready()) {
  console.log('Мостът не стартира. Изход на процеса:\n' + childLog);
  child.kill();
  api.close();
  process.exit(1);
}

console.log('\n═══ лошa задача: 400, без run ═══');
const before = seen.length;
const empty = await post('/agent', { task: '' });
check('празна задача дава 400', empty.status === 400, `получено ${empty.status}`);
check('има съобщение за грешка', Boolean(empty.payload?.error));
check('нищо не е стигнало до Browser Use', seen.length === before, `заявки: ${seen.length - before}`);

const tooLong = await post('/agent', { task: 'x'.repeat(4001) });
check('твърде дълга задача дава 400', tooLong.status === 400);
check('дългата задача също не стига до мрежата', seen.length === before);

const badJson = await fetch(`${base}/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
check('невалиден JSON не чупи сървъра', badJson.status === 502, `получено ${badJson.status}`);

console.log('\n═══ липсващ run_id ═══');
const noRun = await post('/agent/status', {});
check('липсващ run_id дава 400', noRun.status === 400);
check('липсващ session_id дава 400', (await post('/agent/message', { text: 'hi' })).status === 400);

console.log('\n═══ успешна задача ═══');
const created = await post('/agent', { task: 'Провери черновата' });
check('връща 200', created.status === 200, `получено ${created.status}`);
check('връща run_id', created.payload?.run_id === 'run-http-1');
check('връща session_id', created.payload?.session_id === 'sess-http-1');
check('run_id отговаря на този от API', seen.at(-1)?.url === '/api/v4/runs');
check('задачата е препратена', seen.at(-1)?.body?.task === 'Провери черновата');

console.log('\n═══ статус ═══');
const status = await post('/agent/status', { run_id: 'run-http-1' });
check('статусът се връща', status.status === 200);
check('резултатът се вижда', status.payload?.result === 'HTTP резултат');
check('статусът е терминален', status.payload?.terminal === true);

console.log('\n═══ продължаване: връща НОВИЯ run ═══');
const message = await post('/agent/message', { session_id: 'sess-http-1', run_id: 'run-http-1', text: 'Продължи' });
check('съобщението се приема', message.status === 200 && message.payload?.queued === true);
check('отива в правилната сесия', seen.at(-1)?.url === '/api/v4/sessions/sess-http-1/queue');
// The site polled run-http-1 before. If the bridge handed that id back, the very
// next poll would return the old result and the site would show it as the answer.
check('връща се новият run, не старият', message.payload?.run_id === 'run-http-2', `получено: ${message.payload?.run_id}`);
check('отчетено е като стартирало', message.payload?.started === true);
check('връща се id на съобщението', message.payload?.message_id === 11);

const followStatus = await post('/agent/status', { run_id: message.payload.run_id });
check('новият run се чете с новия резултат', followStatus.payload?.result === 'Отговор от продължението', JSON.stringify(followStatus.payload?.result));

console.log('\n═══ продължение, което не стартира ═══');
const stuck = await post('/agent/message', { session_id: 'sess-stuck', run_id: 'run-http-1', text: 'Продължи' });
check('съобщението е прието', stuck.status === 200);
check('НЕ се връща старият run', stuck.payload?.run_id !== 'run-http-1', `получено: ${stuck.payload?.run_id}`);
check('отчетено е като нестартирало', stuck.payload?.started === false);

console.log('\n═══ статус само по session_id ═══');
const bySession = await post('/agent/status', { session_id: 'sess-http-1' });
check('статусът може да се пита по сесия', bySession.status === 200 && bySession.payload?.runId === 'run-http-2', JSON.stringify(bySession.payload));

console.log('\n═══ неизвестен път ═══');
const unknown = await post('/секрет', {});
check('непознат път дава 404', unknown.status === 404);

console.log('\n═══ ключът не изтича ═══');
const bodies = [empty.text, tooLong.text, created.text, status.text, message.text, unknown.text, childLog].join(' ');
check('ключът не се появява в нито един отговор', !bodies.includes(key));
check('cdp адрес не се появява', !/cdp/i.test(bodies));
check('ключът е стигнал до API само в header', seen.every((item) => item.headers['x-browser-use-api-key'] === key));
check('ключът не е в тяло на заявка към API', !seen.some((item) => JSON.stringify(item.body || {}).includes(key)));

console.log('\n═══ без ключ: 503, а не crash ═══');
child.kill();
await new Promise((resolve) => child.once('exit', resolve));

const noKeyChild = spawn(process.execPath, [join(here, '../src/browser-access-server.mjs')], {
  env: { ...env, BROWSER_USE_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let noKeyLog = '';
noKeyChild.stdout.on('data', (chunk) => { noKeyLog += chunk; });
noKeyChild.stderr.on('data', (chunk) => { noKeyLog += chunk; });
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { await fetch(`${base}/nope`, { method: 'POST' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
const noKey = await post('/agent', { task: 'Задача без ключ' });
check('без ключ се връща 503', noKey.status === 503, `получено ${noKey.status}`);
check('съобщението споменава липсващия ключ', /BROWSER_USE_API_KEY/.test(noKey.payload?.error || ''));
noKeyChild.kill();
await new Promise((resolve) => noKeyChild.once('exit', resolve));

api.close();
console.log(`\n${failed === 0 ? 'ВСИЧКИ МИНАХА' : 'ИМА ПРОВАЛИ'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
