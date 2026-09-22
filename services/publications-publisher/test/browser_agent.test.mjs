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
        return reply(200, { id: 'msg-1', status: 'pending' });
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
await agent.queueMessage('sess-1', 'Продължи');
const queue = seen.find((item) => item.url === '/api/v4/sessions/sess-1/queue');
check('съобщението отива в session queue', queue?.body?.text === 'Продължи');
check('interrupt не се праща по подразбиране', queue?.body?.interrupt === undefined);
await agent.queueMessage('sess-1', 'Спри', { interrupt: true });
const interrupt = seen.filter((item) => item.url === '/api/v4/sessions/sess-1/queue').at(-1);
check('interrupt се праща при поискване', interrupt?.body?.interrupt === true);

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
