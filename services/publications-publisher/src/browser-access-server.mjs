// Private local bridge for the visible Browser Use Cloud browser.
// Nginx exposes it only after the signed Admin ticket is validated upstream.
// It never returns the Browser Use API key, CDP URL or profile data.

import http from 'node:http';
import { chromium } from 'playwright';
import { createBrowser, stopBrowser } from './browser_use.mjs';

const host = '127.0.0.1';
const port = Number(process.env.PUBLICATIONS_BROWSER_ACCESS_PORT || 6081);
const entryUrl = process.env.PUBLICATIONS_BROWSER_ENTRY_URL
  || 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';
const lifetimeMs = Math.max(5, Number(process.env.PUBLICATIONS_BROWSER_LIVE_MINUTES || 30)) * 60_000;
let active = null;

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function stopActive() {
  if (!active) return;
  const current = active;
  active = null;
  clearTimeout(current.timer);
  await stopBrowser(current.id).catch(() => undefined);
}
async function loggedIn(page) {
  return page.evaluate(() => Boolean(document.forms.namedItem('pub')?.elements.namedItem('f5'))).catch(() => false);
}
async function signInOnce(page) {
  const username = String(process.env.PUBLICATIONS_MOBILE_BG_USERNAME || '').trim();
  const password = String(process.env.PUBLICATIONS_MOBILE_BG_PASSWORD || '');
  if (!username || !password) return 'credentials_not_configured';
  if (await loggedIn(page)) return 'already_logged_in';

  // The signed-out Mobile.bg shell embeds navigation in frames. Search every
  // frame rather than assuming the login link sits in the top document.
  let loginFrame = null;
  for (const frame of page.frames()) {
    const link = frame.locator('a').filter({ hasText: /Вход/i }).first();
    const button = frame.locator('button').filter({ hasText: /Вход/i }).first();
    if (await link.count()) {
      await link.click();
      loginFrame = frame;
      break;
    }
    if (await button.count()) {
      await button.click();
      loginFrame = frame;
      break;
    }
  }
  if (loginFrame) await page.waitForTimeout(1500);

  let formFrame = null;
  let passwordInput = null;
  for (const frame of page.frames()) {
    const candidate = frame.locator('input[type="password"]:visible').first();
    if (await candidate.count()) {
      formFrame = frame;
      passwordInput = candidate;
      break;
    }
  }
  if (!formFrame || !passwordInput) return 'login_form_not_found';

  const inputs = formFrame.locator('input:visible');
  const count = await inputs.count();
  let userIndex = -1;
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const name = [await input.getAttribute('name'), await input.getAttribute('id'), await input.getAttribute('type')]
      .filter(Boolean).join(' ').toLowerCase();
    if (/user|email|mail|login|nick/.test(name) && !/password/.test(name)) { userIndex = index; break; }
  }
  if (userIndex < 0) {
    for (let index = 0; index < count; index += 1) {
      const type = (await inputs.nth(index).getAttribute('type') || 'text').toLowerCase();
      if (type === 'text' || type === 'email') { userIndex = index; break; }
    }
  }
  if (userIndex < 0) return 'username_field_not_found';

  await inputs.nth(userIndex).fill(username);
  await passwordInput.fill(password);
  await passwordInput.press('Enter');
  await page.waitForTimeout(2500);
  await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1500);
  return (await loggedIn(page)) ? 'logged_in' : 'login_not_confirmed';
}
async function openLiveBrowser() {
  await stopActive();
  const created = await createBrowser();
  if (!created.liveUrl) {
    await stopBrowser(created.id).catch(() => undefined);
    throw new Error('Browser Use не върна адрес за видимия браузър.');
  }
  let login = 'not_attempted';
  try {
    const browser = await chromium.connectOverCDP(created.cdpUrl);
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    login = await signInOnce(page);
    await browser.close();
  } catch (error) {
    await stopBrowser(created.id).catch(() => undefined);
    throw error;
  }
  const timer = setTimeout(() => void stopActive(), lifetimeMs);
  active = { id: created.id, timer };
  return { liveUrl: created.liveUrl, login };
}

const server = http.createServer(async (request, response) => {
  const path = request.url?.split('?')[0];
  if (request.method !== 'POST') {
    json(response, 404, { error: 'Not found' });
    return;
  }
  if (path === '/close') {
    await stopActive();
    json(response, 200, { closed: true });
    return;
  }
  if (path !== '/open') {
    json(response, 404, { error: 'Not found' });
    return;
  }
  try {
    const opened = await openLiveBrowser();
    json(response, 200, { live_url: opened.liveUrl, login: opened.login, expires_in_seconds: Math.floor(lifetimeMs / 1000) });
  } catch (error) {
    console.error('Browser Use manual access failed:', error instanceof Error ? error.message : error);
    json(response, 502, { error: 'Неуспешно отваряне на Browser Use браузъра. Проверете Browser Use профила и наличния баланс.' });
  }
});
server.listen(port, host, () => console.log(`Browser Use manual access bridge listening on ${host}:${port}`));
const shutdown = async () => { server.close(); await stopActive(); };
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
