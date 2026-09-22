// Reads the Browser Use profiles and reports which one holds the Mobile.bg
// session.
//
// Read-only by default: it creates nothing, changes nothing and prints no secret
// — only profile names, ids and the domains whose cookies are stored.
//
// `--verify` goes one step further and answers the question that actually
// matters: is the session still *usable*. Cookie metadata cannot answer it,
// because Mobile.bg expires sessions and an expired cookie still lists its
// domain. So it opens a browser attached to the profile, loads the publish page
// and looks for the publication form in the DOM. That opens a real browser, so
// it is opt-in; without the flag nothing is opened.
//
// Run: node src/profile-check.mjs [--verify]

import { profileName, profileId, browserUseApiConfigured, resolveProfile } from './browser_use.mjs';

const API_BASE = process.env.BROWSER_USE_API_BASE || 'https://api.browser-use.com';
const PROFILES_PATH = process.env.BROWSER_USE_PROFILES_PATH || '/api/v4/profiles';

if (!browserUseApiConfigured()) {
  console.error('Липсва BROWSER_USE_API_KEY.');
  process.exit(2);
}

const key = process.env.BROWSER_USE_API_KEY;
const response = await fetch(`${API_BASE}${PROFILES_PATH}`, { headers: { 'X-Browser-Use-API-Key': key } });
const text = await response.text();
let data = {};
try { data = JSON.parse(text); } catch { /* reported below */ }

if (!response.ok) {
  console.error(`Списъкът с профили се провали: HTTP ${response.status} ${text.slice(0, 300)}`);
  process.exit(1);
}

// The list is paged: `{ items, totalItems, ... }`. An older shape was a bare
// array, so both are accepted.
const items = Array.isArray(data) ? data : (data.items || data.profiles || []);

console.log('═══ BROWSER USE ПРОФИЛИ ═══');
console.log(`Общо: ${items.length}${data.totalItems != null ? ` (totalItems: ${data.totalItems})` : ''}`);
console.log('');

const wanted = profileName();
const configured = profileId();
console.log(`Търсен профил по име: ${wanted}`);
console.log(`BROWSER_PROFILE_ID от средата: ${configured || '(празно — агентът не подава профил)'}`);
console.log('');

const MOBILE = /mobile\.bg/i;
for (const profile of items) {
  const domains = Array.isArray(profile.cookieDomains) ? profile.cookieDomains : [];
  const hasMobile = domains.some((d) => MOBILE.test(String(d)));
  console.log(`• ${profile.name}`);
  console.log(`    id:            ${profile.id}`);
  console.log(`    cookie домейни: ${domains.length ? domains.join(', ') : '(няма)'}`);
  console.log(`    mobile.bg:      ${hasMobile ? 'ДА' : 'не'}`);
  console.log(`    последно ползван: ${profile.lastUsedAt || '(никога)'}`);
  if (profile.name === wanted) console.log('    ← това е профилът, който търсим');
  console.log('');
}

const match = items.find((p) => p.name === wanted);
console.log('═══ ПРИСЪДА ═══');
console.log(`профил "${wanted}" съществува: ${match ? 'ДА' : 'НЕ — при първи вход ще бъде създаден'}`);
if (match) {
  const domains = Array.isArray(match.cookieDomains) ? match.cookieDomains : [];
  console.log(`в него има mobile.bg бисквитка: ${domains.some((d) => MOBILE.test(String(d))) ? 'ДА' : 'НЕ — трябва един вход през сайта'}`);
}
console.log(`агентът ще подаде профил: ДА (по име)${configured ? ` (по id ${configured})` : ''}`);

// The cookie check above cannot tell a live session from an expired one. Only
// the page can, so `--verify` loads it.
if (process.argv.includes('--verify')) {
  console.log('\n═══ ПРОВЕРКА НА ЖИВО: отваря се браузър върху профила ═══');
  const { createBrowser, stopBrowser } = await import('./browser_use.mjs');
  const { chromium } = await import('playwright');
  const entryUrl = process.env.PUBLICATIONS_BROWSER_ENTRY_URL
    || 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';

  const id = await resolveProfile();
  console.log(`  профил: ${id}`);
  const created = await createBrowser();
  console.log(`  браузър: ${created.id}`);
  let verdict = 'unknown';
  let failure = null;
  try {
    const browser = await chromium.connectOverCDP(created.cdpUrl);
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // The publication form is `<form name="pub">` with field `f5`. That is the
    // same test the bridge uses, so this matches what a real run sees.
    const form = await page.evaluate(() => Boolean(document.forms.namedItem('pub')?.elements.namedItem('f5')));
    const password = await page.locator('input[type="password"]:visible').count();
    verdict = form ? 'logged_in' : password > 0 ? 'signed_out' : 'unknown_page';
    console.log(`  форма за публикуване: ${form ? 'ДА' : 'не'}`);
    console.log(`  поле за парола: ${password}`);
    console.log(`  адрес след зареждане: ${page.url()}`);
    await browser.close();
  } catch (error) {
    // A failed check is not a logged-out session and must not be reported as
    // one. "Could not verify" is its own answer, so a browser that will not
    // start never gets mistaken for an expired login.
    failure = error instanceof Error ? error.message : String(error);
    console.log(`  проверката не завърши: ${failure}`);
  } finally {
    await stopBrowser(created.id).catch(() => undefined);
  }
  console.log('\n═══ ЖИВА ПРИСЪДА ═══');
  if (verdict === 'logged_in') {
    console.log('сесията е използваема: ДА');
  } else if (verdict === 'signed_out') {
    console.log('сесията е използваема: НЕ — влез през «Влез в Mobile.bg»');
    process.exitCode = 1;
  } else {
    console.log(`сесията е използваема: НЕЯСНО — проверката не можа да реши${failure ? ` (${failure})` : ''}`);
    process.exitCode = 1;
  }
}
