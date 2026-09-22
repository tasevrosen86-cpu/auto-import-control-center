// A real conversation with the Browser Use agent, driven end to end.
//
// This is not a test with a stub. It calls the live API with the real key and
// proves the thing the panel depends on: that a task can be handed to the agent,
// polled to a terminal status, and followed up inside the same session without
// losing context. It is deliberately a two-step conversation, because a single
// task only proves the agent answers — it does not prove that memory works, and
// memory is the part a broker will lean on.
//
// Nothing is published, no draft is touched and no form is submitted. The task
// is scoped to a place the agent can read, so this run cannot change anything
// anywhere.
//
// The key is read from the environment and never printed, logged or attached to
// a result.
//
// Run: node src/agent-live.mjs

import { agentConfigured, startRun, runStatus, queueMessage, cleanTask, MAX_TASK_CHARS } from './browser_agent.mjs';

const POLL_MS = 3000;
// Generous, because a real browser run really does take minutes. The cap exists
// so a hung run fails the job instead of holding it open for ever.
const TIMEOUT_MS = Number(process.env.AGENT_LIVE_TIMEOUT_MS || 8 * 60_000);

function line(label, value) {
  console.log(`${label}: ${value}`);
}

async function waitForTerminal(runId) {
  const started = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - started < TIMEOUT_MS) {
    last = await runStatus(runId);
    polls += 1;
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  [${String(elapsed).padStart(3)}s] ${last.status}`);
    if (last.terminal) return { ...last, polls, seconds: elapsed };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  // A run that outlives the cap is reported as such rather than being called a
  // failure — the agent may still be working, and the two need different fixes.
  return { ...(last || {}), status: last?.status || 'unknown', terminal: false, timedOut: true, polls, seconds: Math.round((Date.now() - started) / 1000) };
}

if (!agentConfigured()) {
  console.error('Липсва BROWSER_USE_API_KEY. Този probe говори с реалния API и не може да работи без ключ.');
  process.exit(2);
}

console.log('═══ РЕАЛЕН РАЗГОВОР С BROWSER USE АГЕНТА ═══\n');

// A read-only target. The agent is asked to read and remember, not to write.
const firstTask = cleanTask(process.env.AGENT_LIVE_TASK
  || 'Отвори https://example.com и прочети заглавието на страницата. Отговори само с текста на заглавието, без нищо друго. Не попълвай формуляри и не въвеждай данни.');

line('Задача 1', firstTask.slice(0, 120) + (firstTask.length > 120 ? '…' : ''));
line('Лимит', `${MAX_TASK_CHARS} знака`);

console.log('\n─── Създаване на run ───');
const started = await startRun(firstTask);
line('run_id', started.runId);
line('session_id', started.sessionId || '(не е върнат)');
line('начален статус', started.status);
if (!started.sessionId) {
  console.error('\nБез session_id не може да се продължи разговорът. Спирам тук, защото второто съобщение щеше да отиде в нова сесия и нямаше да докаже нищо.');
  process.exit(1);
}

console.log('\n─── Изчакване ───');
const one = await waitForTerminal(started.runId);
line('краен статус', one.status);
line('терминален', String(one.terminal));
line('проверки', String(one.polls));
line('секунди', String(one.seconds));
line('цена USD', String(one.cost ?? '(не е върната)'));
if (one.timedOut) {
  console.error(`\nRun-ът не завърши в рамките на ${Math.round(TIMEOUT_MS / 1000)}s. Това не е провал на връзката — агентът още работи.`);
  process.exitCode = 1;
}
console.log('\n─── Резултат от задача 1 ───');
console.log(one.result ? one.result.trim() : `(няма текст; грешка: ${one.error || 'няма'})`);
if (one.error) console.error(`Грешка от агента: ${one.error}`);

// The second step is the whole point. It asks for something that only exists in
// the first step's context, so a correct answer proves the session was kept.
console.log('\n─── Задача 2: същата сесия, памет ───');
const followUp = 'Какво беше заглавието, което току-що прочете? Отговори само с него.';
await queueMessage(started.sessionId, followUp);
line('съобщение', followUp);
const two = await waitForTerminal(started.runId);
line('краен статус', two.status);
line('секунди', String(two.seconds));
console.log('\n─── Резултат от задача 2 ───');
console.log(two.result ? two.result.trim() : `(няма текст; грешка: ${two.error || 'няма'})`);

// The comparison is the verdict. The guide warns not to trust the agent's prose
// on its own, so the answer is checked against what step one actually returned.
const firstText = (one.result || '').trim().toLowerCase();
const secondText = (two.result || '').trim().toLowerCase();
const remembered = Boolean(firstText) && secondText.includes(firstText.replace(/[.!]$/, ''));

console.log('\n═══ ПРИСЪДА ═══');
line('run създаден', 'да');
line('стигна до терминален статус', String(one.terminal));
line('резултат върнат', String(Boolean(firstText)));
line('продължение в същата сесия', String(Boolean(two.result)));
line('агентът помни контекста', remembered ? 'да — отговорът съдържа заглавието от стъпка 1' : 'не — отговорът не повтаря стъпка 1');

if (!remembered && firstText && secondText) {
  console.log('\nСтъпка 1 върна: ' + one.result.trim());
  console.log('Стъпка 2 върна: ' + two.result.trim());
}

const ok = one.terminal && Boolean(one.result) && !one.timedOut;
console.log(`\n${ok ? 'ВРЪЗКАТА РАБОТИ' : 'ВРЪЗКАТА НЕ ЗАВЪРШИ ЧИСТО'} (цена: ${two.cost ?? one.cost ?? 'неизвестна'} USD)`);
process.exit(ok ? 0 : 1);
