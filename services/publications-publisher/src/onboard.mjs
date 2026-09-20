// One-time onboarding: open the Mobile.bg profile so a person can sign in.
//
// Section 3 of the specification: a separate Browser Use profile is held for
// Mobile.bg publishing, the person takes control of the live browser once and
// signs in, and the profile is reused from then on. No password is stored and
// the worker never logs in.
//
// The profile was proven to carry cookies between browsers, so a sign-in done
// here survives into later publish runs.
//
// Usage: node src/onboard.mjs
// Open the printed live-view URL, sign in to Mobile.bg, and leave this running.
// It checks every few seconds and stops the browser itself once the form loads.

import { chromium } from 'playwright';
import { createBrowser, stopBrowser, resolveProfile, profileName } from './browser_use.mjs';
import { FORM_URL, ensureLoggedIn } from './form.mjs';

const profileId = await resolveProfile();
console.log(`Профил: «${profileName()}» (${profileId})`);

const created = await createBrowser();
console.log(`Браузър: ${created.id}`);
console.log('');
console.log('===================================================================');
console.log('  Отвори този адрес, за да управляваш браузъра:');
console.log(`  ${created.liveUrl}`);
console.log('===================================================================');
console.log('');
console.log('Влез в Mobile.bg в този браузър. Този процес проверява на всеки');
console.log('5 секунди и ще спре браузъра сам, щом формата за публикуване се');
console.log('появи — тоест щом входът проработи. Не го затваряй.');
console.log('');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let connection;
let signedIn = false;
try {
  connection = await chromium.connectOverCDP(created.cdpUrl);
  const context = connection.contexts()[0] || await context.newContext();
  const page = context.pages()[0] || await context.newPage();
  await page.goto(FORM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);

  // Poll rather than wait for a keypress: the operator signs in through the
  // live view, which is a different client, so this process cannot be told when
  // it happens — it has to observe it.
  const deadline = Date.now() + 8 * 60 * 1000;
  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    const login = await ensureLoggedIn({ page });
    if (login.state === 'already_logged_in') {
      signedIn = true;
      console.log(`\nВходът е приет (проверка ${attempt}). Профилът е готов.`);
      break;
    }
    if (attempt === 1 || attempt % 6 === 0) {
      console.log(`  чакам вход… (проверка ${attempt}, състояние: ${login.state})`);
    }
    // Reload occasionally so a half-finished sign-in is not cached in place.
    if (attempt % 12 === 0) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await sleep(5000);
  }
  if (!signedIn) console.log('\nВремето изтече без влязла сесия. Нищо не е запазено като влязло.');
} finally {
  await connection?.close().catch(() => undefined);
  // The profile is written when the session ends, so the browser is stopped
  // cleanly rather than left running and billing.
  const stopped = await stopBrowser(created.id);
  console.log(`Браузърът е спрян: ${stopped}.${signedIn ? ' Профилът е запазен.' : ''}`);
}

process.exit(signedIn ? 0 : 1);