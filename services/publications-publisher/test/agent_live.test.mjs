// Runs the live probe end to end against a stub API.
//
// `agent-live.mjs` is the one script that talks to the real service, and it was
// the only part of this work with no test — which is how a missing import
// reached a paid live run. This closes that gap: the probe is spawned as its own
// process with the API pointed at a local stub, so every line of it runs, its
// exit code is real, and a runtime error fails here instead of on the wire.
//
// The stub is deliberately slow on the follow-up run. The probe refuses a
// follow-up that returns in under a second, because an instant answer is the
// stale-read symptom, so a stub that answered instantly would be testing the
// wrong thing.
//
// Run: node test/agent_live.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probe = path.join(here, '..', 'src', 'agent-live.mjs');

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok   ${label}`); } else { failed += 1; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const api = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;

  if (request.url === '/api/v4/profiles') {
    // Every run resolves the Mobile.bg profile first, so the probe cannot start
    // without this route answering.
    return json(response, 200, { items: [{ id: 'profile-stub', name: 'mobilebg-publisher' }], totalItems: 1 });
  }
  if (request.url === '/api/v4/runs' && request.method === 'POST') {
    return json(response, 200, { id: 'run-1', status: 'queued', sessionId: 'sess-1' });
  }
  if (request.url === '/api/v4/runs/run-1') {
    return json(response, 200, { id: 'run-1', status: 'completed', result: 'Example Domain', error: null, sessionId: 'sess-1' });
  }
  if (request.url === '/api/v4/runs/run-2') {
    // Real work takes time; the probe fails an instant follow-up on purpose.
    await sleep(1200);
    return json(response, 200, { id: 'run-2', status: 'completed', result: 'Example Domain', error: null, sessionId: 'sess-1' });
  }
  if (request.url === '/api/v4/sessions/sess-1/queue') {
    // The run id is null while the run is being set up. This is the shape that
    // forces the probe down its session-reading path, which is the path that had
    // the missing import.
    return json(response, 200, { id: 5, sessionId: 'sess-1', runId: null, mode: 'queue', status: 'pending' });
  }
  if (request.url === '/api/v4/sessions/sess-1') {
    return json(response, 200, { sessionId: 'sess-1', latestRunId: 'run-2', status: 'running' });
  }
  return json(response, 404, { detail: 'no route ' + request.url });
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const port = api.address().port;

console.log('═══ probe-ът се изпълнява цялостно срещу stub ═══');

const child = spawn(process.execPath, [probe], {
  env: {
    ...process.env,
    BROWSER_USE_API_KEY: 'test-key-not-real',
    BROWSER_USE_API_BASE: `http://127.0.0.1:${port}`,
    AGENT_LIVE_TIMEOUT_MS: '20000',
  },
});
let out = '';
child.stdout.on('data', (chunk) => { out += chunk; });
child.stderr.on('data', (chunk) => { out += chunk; });
const code = await new Promise((resolve) => child.on('close', resolve));
api.close();

check('probe-ът завършва с код 0', code === 0, `код: ${code}\n${out}`);
check('няма ReferenceError', !out.includes('ReferenceError'), out.split('\n').find((l) => l.includes('ReferenceError')) || '');
check('първата задача дава резултат', out.includes('Example Domain'));
check('използван е пътят през сесията', out.includes('run от отговора: (не е върнат'), '');
check('намира се нов run', out.includes('нов run: run-2'));
check('продължението създава нов run', out.includes('продължението създаде нов run: true'));
check('новото четене не е моментално', out.includes('новото четене не е моментално: true'));
check('агентът помни контекста', out.includes('агентът помни контекста: да'));
check('присъдата е успех', out.includes('ВРЪЗКАТА РАБОТИ'));

console.log('\n═══ без ключ probe-ът отказва с 2 ═══');
const noKey = spawn(process.execPath, [probe], { env: { ...process.env, BROWSER_USE_API_KEY: '', BROWSER_USE_API_BASE: `http://127.0.0.1:${port}` } });
let noKeyOut = '';
noKey.stdout.on('data', (c) => { noKeyOut += c; });
noKey.stderr.on('data', (c) => { noKeyOut += c; });
const noKeyCode = await new Promise((resolve) => noKey.on('close', resolve));
check('без ключ изходният код е 2', noKeyCode === 2, `код: ${noKeyCode}`);
check('без ключ няма мрежова заявка', noKeyOut.includes('Липсва BROWSER_USE_API_KEY'), noKeyOut.trim().slice(0, 120));

console.log(`\n${failed === 0 ? 'ВСИЧКИ МИНАХА' : 'ИМА ПРОВАЛИ'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
