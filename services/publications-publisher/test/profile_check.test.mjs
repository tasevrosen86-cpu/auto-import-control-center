// Runs `profile-check.mjs --verify` against a stub Browser Use API.
//
// The point is the verdict logic, not the network. Three outcomes have to be
// told apart: the publish form is there (logged in), a password field is there
// (signed out), and neither is there (an unknown page, which must NOT be
// reported as either). Reporting an unknown page as "logged in" would send
// someone hunting for a bug in the mapping when the real problem is the session.
//
// The stub cannot serve a real Mobile.bg page, so the entry URL is pointed at a
// local page that contains a form named `pub` with field `f5` — the same test
// the bridge uses — and the signed-out case serves a password input instead.
//
// Run: node test/profile_check.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'src', 'profile-check.mjs');

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok   ${label}`); } else { failed += 1; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}
const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

// Stands in for Mobile.bg. `mode` decides whether the publish form, a password
// field, or neither is served.
let pageMode = 'form';
const pageServer = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (pageMode === 'form') {
    response.end('<html><body><form name="pub"><input name="f5" value=""></form></body></html>');
  } else if (pageMode === 'password') {
    response.end('<html><body><form><input type="password" name="p"></form></body></html>');
  } else {
    response.end('<html><body><h1>Достъпът е ограничен</h1></body></html>');
  }
});
await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
const pagePort = pageServer.address().port;

// Stands in for Browser Use. It answers the profile list and hands back a CDP
// address. Playwright is asked for a real CDP endpoint it cannot have, so the
// script's connect step fails fast — but the profile and verdict paths are still
// exercised, which is what the test is about.
const api = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (request.url === '/api/v4/profiles') {
    return json(response, 200, { items: [{ id: 'profile-stub', name: 'mobilebg-publisher', cookieDomains: ['mobile.bg'] }], totalItems: 1 });
  }
  if (request.url === '/api/v4/browsers' && request.method === 'POST') {
    return json(response, 200, { id: 'browser-stub', cdpUrl: 'ws://127.0.0.1:1/devtools', liveUrl: 'http://x' });
  }
  if (request.url?.startsWith('/api/v4/browsers/')) {
    return json(response, 200, { id: 'browser-stub', status: 'stopped' });
  }
  return json(response, 404, { detail: 'no route ' + request.url });
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const apiPort = api.address().port;

async function run(args) {
  const child = spawn(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      BROWSER_USE_API_KEY: 'test-key-not-real',
      BROWSER_USE_API_BASE: `http://127.0.0.1:${apiPort}`,
      PUBLICATIONS_BROWSER_ENTRY_URL: `http://127.0.0.1:${pagePort}/`,
    },
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { out, code };
}

console.log('═══ read-only режим: нищо не се отваря ═══');
const plain = await run([]);
check('read-only завършва с 0', plain.code === 0, `код ${plain.code}\n${plain.out}`);
check('намира профила по име', plain.out.includes('профил "mobilebg-publisher" съществува: ДА'));
check('отчита mobile.bg бисквитка', plain.out.includes('mobile.bg бисквитка: ДА'));
check('казва, че агентът ще подаде профил', plain.out.includes('агентът ще подаде профил: ДА'));
check('НЕ отваря браузър', !plain.out.includes('ПРОВЕРКА НА ЖИВО'), '');

console.log('\n═══ --verify: живият вариант стига до проверката ═══');
const verify = await run(['--verify']);
check('verify стига до живата проверка', verify.out.includes('ПРОВЕРКА НА ЖИВО'));
check('verify подава профила', verify.out.includes('профил: profile-stub'));
check('verify създава браузър', verify.out.includes('браузър: browser-stub'));
// Playwright cannot reach ws://127.0.0.1:1, so this reports a failure rather
// than a false "logged in". That is the behaviour under test.
check('необвързва се към сляпа проверка при грешка', !verify.out.includes('сесията е използваема: ДА'));

console.log('\n═══ непозната страница не се брои за вход ═══');
pageMode = 'none';
const unknown = await run(['--verify']);
check('непозната страница не дава ДА', unknown.out.includes('сесията е използваема: НЕЯСНО'),
  unknown.out.split('\n').filter((l) => l.includes('сесията е използваема')).join(' | '));
check('изходният код е неуспех', unknown.code !== 0, `код ${unknown.code}`);
check('казва, че не е могла да реши', unknown.out.includes('НЕЯСНО'), '');

console.log('\n═══ липсващ профил се създава, вместо да спре run-а ═══');
// The first version threw "Няма да бъде създаден автоматично", so a fresh
// account could not run a task at all — there was no way to create the profile
// the sign-in was meant to fill. This server has an empty list and answers the
// create call.
const emptyApi = http.createServer(async (request, response) => {
  for await (const _ of request) { /* drain */ }
  if (request.url === '/api/v4/profiles' && request.method === 'GET') {
    return json(response, 200, { items: [], totalItems: 0 });
  }
  if (request.url === '/api/v4/profiles' && request.method === 'POST') {
    return json(response, 200, { id: 'profile-created', name: 'mobilebg-publisher' });
  }
  return json(response, 404, { detail: 'no route ' + request.url });
});
await new Promise((resolve) => emptyApi.listen(0, '127.0.0.1', resolve));
const emptyPort = emptyApi.address().port;

// Runs the module directly: the profile is resolved inside the service, not
// inside the check script, so this is where the create path can be observed.
const created = await new Promise((resolve) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { resolveProfile } from '${path.join(here, '..', 'src', 'browser_use.mjs')}';
    process.stdout.write(await resolveProfile());
  `], {
    env: {

      ...process.env,
      BROWSER_USE_API_KEY: 'test-key-not-real',
      BROWSER_USE_API_BASE: `http://127.0.0.1:${emptyPort}`,
      BROWSER_USE_PROFILE: 'mobilebg-publisher',
      BROWSER_PROFILE_ID: '',
    },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  child.on('close', (code) => resolve({ out, err, code }));
});
check('профилът се създава при първи run', created.out.trim() === 'profile-created',
  `код ${created.code}, изход ${JSON.stringify(created.out.trim())}, грешка ${created.err.trim().slice(0, 200)}`);

emptyApi.close();
pageServer.close();
api.close();
console.log(`\n${failed === 0 ? 'ВСИЧКИ МИНАХА' : 'ИМА ПРОВАЛИ'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
