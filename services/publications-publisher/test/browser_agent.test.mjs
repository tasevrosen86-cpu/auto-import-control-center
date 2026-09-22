// Exercises the Browser Use agent module against a real HTTP server.
//
// There is no mock of the module under test: a Node HTTP server stands in for
// api.browser-use.com and answers the three calls the agent makes. What this
// proves is the shape we depend on — that a run is created with the task and
// the profile, that a rejected task never reaches the network at all, that a
// run stops being polled once it is terminal, and that the API key travels only
// in the outgoing request header and never appears in what we return.
//
// Run: node test/browser_agent.test.mjs

import { createServer } from 'node:http';

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

// Records every request the module makes, so the test can assert on what was
// actually sent rather than on what the module says it sent.
const seen = [];

function stubApi() {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      const reply = (status, payload) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (request.url === '/api/v4/runs' && request.method === 'POST') {
        if (body?.task === 'Дай грешка') {
          return reply(402, { detail: 'Insufficient credits' });
        }
        return reply(200, {
          id: 'run-1', status: 'queued', sessionId: 'sess-1', workspaceId: 'ws-1',
          model: 'bu-mini', eventsUrl: '/api/v4/runs/run-1/events',
        });
      }
      if (request.url === '/api/v4/runs/run-1' && request.method === 'GET') {
        // The second read is terminal: the module must stop asking after this.
        const reads = seen.filter((item) => item.url === '/api/v4/runs/run-1').length;
        return reads === 1
          ? reply(200, { id: 'run-1', status: 'running', result: null, error: null, sessionId: 'sess-1' })
          : reply(200, { id: 'run-1', status: 'completed', result: 'Готово: 12 полета.', error: null, sessionId: 'sess-1', totalCostUsd: '0.03' });
      }
      if (request.url === '/api/v4/sessions/sess-1/queue' && request.method === 'POST') {
        // Measured shape: the reply names the run the message creates. It can be
        // null while the run is still being set up, so the module must fall back
        // to the session — this stub returns the id directly.
        return reply(200, { id: 7, sessionId: 'sess-1', runId: 'run-2', mode: 'queue', status: 'pending', text: body?.text ?? '' });
      }
      if (request.url === '/api/v4/sessions/sess-1' && request.method === 'GET') {
        const asked = seen.filter((item) => item.url === '/api/v4/sessions/sess-1').length;
        // The first read still points at the old run; the second is the new one.
        return asked === 1
          ? reply(200, { sessionId: 'sess-1', latestRunId: 'run-1', status: 'completed' })
          : reply(200, { sessionId: 'sess-1', latestRunId: 'run-2', status: 'running' });
      }
      if (request.url === '/api/v4/sessions/sess-empty' && request.method === 'GET') {
        // A session that never moves on: the follow-up must not be mistaken for
        // a new run, and the caller must be told it did not start.
        return reply(200, { sessionId: 'sess-empty', latestRunId: 'run-1', status: 'completed' });
      }
      return reply(404, { detail: 'Can\'t find ' + request.url });
    });
  });
  return server;
}

const key = 'bu_test_key_do_not_leak_123';
const server = stubApi();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// Set before import: the module reads these at call time, but the base has to
// point at the stub rather than the real service.
process.env.BROWSER_USE_API_BASE = base;
process.env.BROWSER_USE_API_KEY = key;

const agent = await import('../src/browser_agent.mjs');

console.log('\n═══ конфигурация ═══');
check('agentConfigured чете ключа от средата', agent.agentConfigured() === true);
check('MAX_TASK_CHARS е 4000', agent.MAX_TASK_CHARS === 4000);

console.log('\n═══ валидация на задачата (без мрежа) ═══');
const before = seen.length;
check('празна задача се отхвърля', agent.taskProblem('') !== null);
check('задача от само интервали се отхвърля', agent.taskProblem(agent.cleanTask('   \n  ')) !== null);
check('задача над 4000 знака се отхвърля', agent.taskProblem('x'.repeat(4001)) !== null);
check('задача от 4000 знака минава', agent.taskProblem('x'.repeat(4000)) === null);
check('control символи се махат', agent.cleanTask('a\u0000b\tc') === 'ab\tc'.replace('\u0000',''));
check('нищо не е изпратено към мрежата при валидация', seen.length === before, `заявки: ${seen.length - before}`);

console.log('\n═══ създаване на run ═══');
const run = await agent.startRun('Провери черновата');
const create = seen.find((item) => item.url === '/api/v4/runs' && item.method === 'POST');
check('run има id', run.runId === 'run-1');
check('run има session id', run.sessionId === 'sess-1');
check('статусът е queued', run.status === 'queued');
check('задачата е изпратена непроменена', create?.body?.task === 'Провери черновата');
check('ключът е в header, не в тялото', create?.headers['x-browser-use-api-key'] === key);
check('ключът НЕ е в тялото на заявката', !JSON.stringify(create?.body || {}).includes(key));

console.log('\n═══ профилът се подава, когато е зададен ═══');
process.env.BROWSER_PROFILE_ID = '11111111-2222-3333-4444-555555555555';
const withProfile = await agent.startRun('Втора задача');
const second = seen.filter((item) => item.url === '/api/v4/runs' && item.method === 'POST').at(-1);
check('profileId стига до browserSettings', second?.body?.browserSettings?.profileId === '11111111-2222-3333-4444-555555555555');
check('run без профил пак получава id', withProfile.runId === 'run-1');
delete process.env.BROWSER_PROFILE_ID;

console.log('\n═══ статус: текущ не е терминален ═══');
const first = await agent.runStatus('run-1');
check('running не е терминален', first.terminal === false);
check('резултат се скрива преди края', first.result === null, `получено: ${JSON.stringify(first.result)}`);
check('грешка се скрива преди края', first.error === null);

console.log('\n═══ статус: терминалният връща резултат и спира ═══');
const second2 = await agent.runStatus('run-1');
check('completed е терминален', second2.terminal === true);
check('резултатът се връща в края', second2.result === 'Готово: 12 полета.');
check('цената се връща', second2.cost === '0.03');
check('няма грешка', second2.error === null);
const readsAfterTerminal = seen.filter((item) => item.url === '/api/v4/runs/run-1').length;
check('нищо не се чете след терминален статус', readsAfterTerminal === 2, `прочитания: ${readsAfterTerminal}`);

console.log('\n═══ продължаване на разговора ═══');
const queued = await agent.queueMessage('sess-1', 'Продължи');
const queue = seen.find((item) => item.url === '/api/v4/sessions/sess-1/queue');
check('съобщението отива в session queue', queue?.body?.text === 'Продължи');
check('interrupt не се праща по подразбиране', queue?.body?.interrupt === undefined);
check('отговорът дава новия run', queued.runId === 'run-2', `получено: ${JSON.stringify(queued.runId)}`);
check('отговорът дава и id на съобщението', queued.messageId === 7);
await agent.queueMessage('sess-1', 'Спри', { interrupt: true });
const interrupt = seen.filter((item) => item.url === '/api/v4/sessions/sess-1/queue').at(-1);
check('interrupt се праща при поискване', interrupt?.body?.interrupt === true);

// The bug this section exists for: after a follow-up the *previous* run id is
// still terminal, so polling it returns the old result at once and looks like a
// working answer. The session is the only place that says which run is current.
console.log('\n═══ продължението е нов run, не стария ═══');
const info = await agent.sessionInfo('sess-1');
check('sessionInfo връща latestRunId', info.latestRunId === 'run-1' || info.latestRunId === 'run-2');
const newRun = await agent.waitForNewRun('sess-1', 'run-1', { timeoutMs: 8000, intervalMs: 200 });
check('намира се нов run, различен от стария', newRun.started === true && newRun.latestRunId === 'run-2', JSON.stringify(newRun));
check('старият run не се брои за нов', newRun.latestRunId !== 'run-1');

// A session that never moves on must be reported as "not started" rather than
// silently returning the old run, which is exactly the failure that shipped.
const stuck = await agent.waitForNewRun('sess-empty', 'run-1', { timeoutMs: 1500, intervalMs: 300 });
check('заседнала сесия се отчита като НЕ стартирала', stuck.started === false, JSON.stringify(stuck));
check('заседналата сесия сочи към стария run', stuck.latestRunId === 'run-1');

// Start from the old id and prove the two paths differ: the old read is
// terminal with the old text, the new read is the follow-up.
const oldRead = await agent.runStatus('run-1');
check('старият run е терминален (затова е подвеждащ)', oldRead.terminal === true);
check('новият run id не е старият', newRun.latestRunId !== 'run-1');

console.log('\n═══ грешките не изтичат ключа ═══');
let creditError = '';
try { await agent.startRun('Дай грешка'); } catch (error) { creditError = error.message; }
check('402 се разпознава като липса на баланс', /баланс/i.test(creditError), creditError.slice(0, 120));
check('съобщението за грешка не съдържа ключа', !creditError.includes(key));

let missingKey = '';
const savedKey = process.env.BROWSER_USE_API_KEY;
delete process.env.BROWSER_USE_API_KEY;
try { await agent.startRun('Без ключ'); } catch (error) { missingKey = error.message; }
process.env.BROWSER_USE_API_KEY = savedKey;
check('липсващ ключ дава ясна грешка', /BROWSER_USE_API_KEY/.test(missingKey));
check('грешката за ключ не съдържа стойността', !missingKey.includes(key));

console.log('\n═══ ключът не се появява в нито един отговор ═══');
const returnedValues = [run, first, second2, withProfile].map((value) => JSON.stringify(value)).join(' ');
check('върнатите данни не съдържат ключа', !returnedValues.includes(key));
check('върнатите данни не съдържат cdp адрес', !/cdp/i.test(returnedValues));

server.close();
console.log(`\n${failed === 0 ? 'ВСИЧКИ МИНАХА' : 'ИМА ПРОВАЛИ'}: ${passed} ok, ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
