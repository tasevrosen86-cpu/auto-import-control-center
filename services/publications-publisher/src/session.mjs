// Three transports, one session interface: { send(method, params) }.
//
//   * `remoteSession`  — the Browser Use infrastructure API. A real remote
//     Chromium with stealth handling is created over HTTP and we attach to it
//     with chromium.connectOverCDP(cdpUrl). Nothing is launched on this machine.
//     This is the transport to use for Mobile.bg.
//   * `gatewaySession` — the older Browser Use gateway, driven over HTTP with
//     V4_GATEWAY_URL / V4_RUN_ID / V4_RUN_TOKEN. Kept working, not preferred.
//   * `localSession`   — a Playwright browser launched here. Measured to be
//     blocked by Cloudflare, so it exists only to exercise the step logic.
//
// Every credential is read from the server environment. Nothing here is ever
// bundled into the frontend, and a key is never logged or returned.

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowser, stopBrowser, browserUseApiConfigured, profileName } from './browser_use.mjs';

const GATEWAY_URL = process.env.V4_GATEWAY_URL || process.env.BROWSER_GATEWAY_URL;
const RUN_ID = process.env.V4_RUN_ID || process.env.BROWSER_RUN_ID;
const RUN_TOKEN = process.env.V4_RUN_TOKEN || process.env.BROWSER_RUN_TOKEN;
// The gateway call shapes are not published, so they are configuration rather
// than assumptions baked into the code.
const CDP_PATH = process.env.BROWSER_CDP_PATH || '/api/v4/internal/runs/{run_id}/browser/cdp';
const UPLOAD_PATH = process.env.BROWSER_UPLOAD_PATH || '/api/v4/internal/runs/{run_id}/browser/upload';

export function gatewayConfigured() {
  return Boolean(GATEWAY_URL && RUN_ID && RUN_TOKEN);
}

function gatewayUrl(path) {
  return `${GATEWAY_URL.replace(/\/$/, '')}${path.replace('{run_id}', encodeURIComponent(RUN_ID))}`;
}

export function describeTransport() {
  if (browserUseApiConfigured()) return { transport: 'browser-use-remote', profile: profileName() };
  if (gatewayConfigured()) return { transport: 'browser-use-gateway', gateway: GATEWAY_URL };
  return {
    transport: 'local',
    reason: 'Липсва BROWSER_USE_API_KEY, а V4_GATEWAY_URL / V4_RUN_ID / V4_RUN_TOKEN също не са налични.',
  };
}

// Downloads the source photos to this machine and returns local paths. Both the
// local and the remote transport end up handing files to a file input, so the
// difference is only where the file has to travel to.
//
// The report records the source images as AutoTrader URLs that are fetched and
// turned into JPEG files; sending the source URL straight to Mobile.bg is
// explicitly forbidden, and a 404 skips that one image rather than the run.
async function downloadImages(urls, limit = 17) {
  const dir = await mkdtemp(join(tmpdir(), 'publication-images-'));
  const paths = [];
  const skipped = [];
  for (let i = 0; i < Math.min(urls.length, limit); i += 1) {
    const response = await fetch(urls[i]);
    if (!response.ok) {
      // The report distinguishes these two: a 404 drops that one photo, any
      // other status stops the run so a broken source is not published.
      if (response.status === 404) { skipped.push({ index: i, status: 404, url: urls[i] }); continue; }
      throw new Error(`image_http_${response.status}`);
    }
    const path = join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    paths.push(path);
  }
  if (skipped.length) console.log(`[info] пропуснати снимки: ${JSON.stringify(skipped)}`);
  return paths;
}

export async function remoteSession() {
  if (!browserUseApiConfigured()) throw new Error('Липсва BROWSER_USE_API_KEY в средата на сървъра.');
  const { chromium } = await import('playwright');
  const created = await createBrowser();
  let connection;
  try {
    connection = await chromium.connectOverCDP(created.cdpUrl);
  } catch (error) {
    // A browser we cannot attach to is a browser we must not leave running: it
    // would keep billing and hold the live view open.
    await stopBrowser(created.id).catch(() => undefined);
    throw error;
  }
  const context = connection.contexts()[0] || await connection.newContext();
  const page = context.pages()[0] || await context.newPage();
  // One CDP session, created once: the report warns that stale node and object
  // handles must not be reused, but that is about handles within a session, not
  // about opening a fresh session per call.
  let cdpPromise = null;
  const cdp = () => (cdpPromise ||= context.newCDPSession(page));
  return {
    transport: 'browser-use-remote',
    browserId: created.id,
    liveUrl: created.liveUrl,
    page,
    send: async (method, params) => (await cdp()).send(method, params),
    async stageImages(urls) { return downloadImages(urls); },
    async close() {
      await connection.close().catch(() => undefined);
      // The report keeps the profile for reuse by default; a throwaway browser
      // is stopped so it does not bill or hold the live view open.
      if (process.env.BROWSER_USE_KEEP_BROWSER !== 'true') {
        await stopBrowser(created.id).catch(() => undefined);
      }
    },
  };
}

export async function gatewaySession() {
  if (!gatewayConfigured()) throw new Error('Browser Use шлюзът не е конфигуриран (V4_GATEWAY_URL, V4_RUN_ID, V4_RUN_TOKEN).');
  return {
    transport: 'browser-use-gateway',
    async send(method, params) {
      const response = await fetch(gatewayUrl(CDP_PATH), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${RUN_TOKEN}` },
        body: JSON.stringify({ method, params }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Шлюзът отказа ${method}: ${JSON.stringify(data).slice(0, 300)}`);
      return data.result ?? data;
    },
    async stageImages(urls) { return downloadImages(urls); },
    async close() {},
  };
}

export async function localSession() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: process.env.PUBLICATIONS_HEADLESS !== 'false' });
  const page = await browser.newPage();
  const context = page.context();
  const cdp = await context.newCDPSession(page);
  return {
    transport: 'local',
    page,
    send: (method, params) => cdp.send(method, params),
    async stageImages(urls) { return downloadImages(urls); },
    async close() { await browser.close(); },
  };
}

// The remote browser is preferred; the local one is a last resort that is known
// not to reach Mobile.bg.
export async function openSession() {
  if (browserUseApiConfigured()) return remoteSession();
  if (gatewayConfigured()) return gatewaySession();
  return localSession();
}

export { downloadImages };