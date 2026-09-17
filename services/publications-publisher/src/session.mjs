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
import { createBrowser, stopBrowser, browserUseApiConfigured } from './browser_use.mjs';

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
  if (browserUseApiConfigured()) return { transport: 'browser-use-remote' };
  if (gatewayConfigured()) return { transport: 'browser-use-gateway', gateway: GATEWAY_URL };
  return {
    transport: 'local',
    reason: 'Липсва BROWSER_USE_API_KEY, а V4_GATEWAY_URL / V4_RUN_ID / V4_RUN_TOKEN също не са налични.',
  };
}

// Downloads the photos to this machine, which only helps the transports whose
// browser runs locally: the remote browser cannot read our filesystem.
async function downloadImages(urls) {
  const dir = await mkdtemp(join(tmpdir(), 'publication-images-'));
  const paths = [];
  for (let i = 0; i < urls.length; i += 1) {
    const response = await fetch(urls[i]);
    if (!response.ok) continue;
    const path = join(dir, `${String(i + 1).padStart(2, '0')}.jpg`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    paths.push(path);
  }
  return paths;
}

export async function remoteSession() {
  if (!browserUseApiConfigured()) throw new Error('Липсва BROWSER_USE_API_KEY в средата на сървъра.');
  const { chromium } = await import('playwright');
  const created = await createBrowser();
  const connection = await chromium.connectOverCDP(created.cdpUrl);
  const context = connection.contexts()[0] || await connection.newContext();
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  return {
    transport: 'browser-use-remote',
    browserId: created.id,
    liveUrl: created.liveUrl,
    page,
    send: (method, params) => cdp.send(method, params),
    async stageImages(urls) { return downloadImages(urls); },
    async close() {
      await connection.close().catch(() => undefined);
      // Leaving the remote browser running would keep billing and hold the live
      // view open, so it is stopped explicitly.
      await stopBrowser(created.id).catch(() => undefined);
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
    // The proven script shipped photos this way, because the browser runs
    // elsewhere and cannot see our filesystem.
    async stageImages(urls) {
      const paths = [];
      for (let start = 0; start < urls.length; start += 10) {
        const form = new FormData();
        for (let i = start; i < Math.min(start + 10, urls.length); i += 1) {
          const response = await fetch(urls[i]);
          if (!response.ok) continue;
          const bytes = await response.arrayBuffer();
          form.append('files', new File([bytes], `${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
        }
        if (!form.has('files')) continue;
        const response = await fetch(gatewayUrl(UPLOAD_PATH), {
          method: 'POST', headers: { authorization: `Bearer ${RUN_TOKEN}` }, body: form,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Качването през шлюза отказа: ${JSON.stringify(data).slice(0, 300)}`);
        paths.push(...(data.staged || []).map((file) => file.browser?.path).filter(Boolean));
      }
      return paths;
    },
    async close() {},
  };
}

export async function localSession() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: process.env.PUBLICATIONS_HEADLESS !== 'false' });
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  return {
    transport: 'local',
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