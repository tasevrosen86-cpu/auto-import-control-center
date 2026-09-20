// A more careful version of the profile persistence probe.
//
// The first attempt wrote a cookie and stopped the browser immediately. If a
// profile is flushed when a session ends rather than when a cookie is written,
// that test could report "no persistence" for a profile that works. This one
// gives the session time to settle before stopping, and waits between the two
// browsers, so a negative result means the profile really does not carry state.

import { chromium } from 'playwright';
import { createBrowser, stopBrowser, resolveProfile, profileName } from '../src/browser_use.mjs';

const COOKIE = 'aicc_persist_probe';
const MARKER = `mark-${Date.now()}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openAndRun(fn) {
  const created = await createBrowser();
  console.log(`   браузър ${created.id.slice(0, 8)}`);
  let connection;
  try {
    connection = await chromium.connectOverCDP(created.cdpUrl);
    const context = connection.contexts()[0] || await connection.newContext();
    const page = context.pages()[0] || await context.newPage();
    return await fn(page);
  } finally {
    await connection?.close().catch(() => undefined);
    // Let the session settle before it is stopped, in case the profile is
    // written on session end rather than on every cookie write.
    await sleep(5000);
    const stopped = await stopBrowser(created.id);
    console.log(`   спрян: ${stopped}`);
    await sleep(5000);
  }
}

const profileId = await resolveProfile();
console.log(`профил «${profileName()}» → ${profileId}\n`);

console.log('1. записвам бисквитка и чакам сесията да се успокои…');
await openAndRun(async (page) => {
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  await sleep(3000);
  await page.evaluate(([name, value]) => {
    document.cookie = `${name}=${value}; path=/; max-age=604800; SameSite=Lax`;
  }, [COOKIE, MARKER]);
  const set = await page.evaluate((name) => document.cookie.includes(name), COOKIE);
  console.log(`   записана: ${set} (${MARKER})`);
  await sleep(5000);
});

console.log('\n2. нов браузър на същия профил…');
const found = await openAndRun(async (page) => {
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  await sleep(3000);
  return page.evaluate((name) => {
    const entry = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return entry ? entry.split('=')[1] : null;
  }, COOKIE);
});

console.log('\n================ РЕЗУЛТАТ ================');
console.log(found === MARKER
  ? '  Профилът ЗАПАЗВА бисквитките между браузърите.'
  : `  Бисквитката не оживя (намерено: ${found ?? 'нищо'}).`);
console.log('==========================================');