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
async function openLiveBrowser() {
  await stopActive();
  const created = await createBrowser();
  if (!created.liveUrl) {
    await stopBrowser(created.id).catch(() => undefined);
    throw new Error('Browser Use не върна адрес за видимия браузър.');
  }
  try {
    const browser = await chromium.connectOverCDP(created.cdpUrl);
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await browser.close();
  } catch (error) {
    await stopBrowser(created.id).catch(() => undefined);
    throw error;
  }
  const timer = setTimeout(() => void stopActive(), lifetimeMs);
  active = { id: created.id, timer };
  return created.liveUrl;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url?.split('?')[0] !== '/open') {
    json(response, 404, { error: 'Not found' });
    return;
  }
  try {
    const liveUrl = await openLiveBrowser();
    json(response, 200, { live_url: liveUrl, expires_in_seconds: Math.floor(lifetimeMs / 1000) });
  } catch (error) {
    console.error('Browser Use manual access failed:', error instanceof Error ? error.message : error);
    json(response, 502, { error: 'Неуспешно отваряне на Browser Use браузъра. Проверете Browser Use профила и наличния баланс.' });
  }
});
server.listen(port, host, () => console.log(`Browser Use manual access bridge listening on ${host}:${port}`));
const shutdown = async () => { server.close(); await stopActive(); };
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
