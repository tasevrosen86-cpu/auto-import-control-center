// Two transports, one session interface: { send(method, params) }.
//
//   * `gatewaySession` — the Browser Use gateway the proven script used, driven
//     over HTTP with V4_GATEWAY_URL / V4_RUN_ID / V4_RUN_TOKEN. Reuses an
//     already-running, already-authenticated browser, which is why it does not
//     meet the Cloudflare challenge.
//   * `localSession` — a Playwright browser we launch, wrapped so its CDP
//     session looks the same. Used to prove the form steps on demand.
//
// Every credential is read from the server environment. Nothing here is ever
// bundled into the frontend.

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATEWAY_URL = process.env.V4_GATEWAY_URL || process.env.BROWSER_GATEWAY_URL;
const RUN_ID = process.env.V4_RUN_ID || process.env.BROWSER_RUN_ID;
const RUN_TOKEN = process.env.V4_RUN_TOKEN || process.env.BROWSER_RUN_TOKEN;
// The gateway call shape is not published, so the path is configuration rather
// than an assumption. Point this at the CDP relay once it is known.
const CDP_PATH = process.env.BROWSER_CDP_PATH
  || '/api/v4/internal/runs/{run_id}/browser/cdp';
const UPLOAD_PATH = process.env.BROWSER_UPLOAD_PATH
  || '/api/v4/internal/runs/{run_id}/browser/upload';

export function browserUseConfigured() {
  return Boolean(GATEWAY_URL && RUN_ID && RUN_TOKEN);
}

function gatewayUrl(path) {
  return `${GATEWAY_URL.replace(/\/$/, '')}${path.replace('{run_id}', encodeURIComponent(RUN_ID))}`;
}

export function describeTransport() {
  if (!GATEWAY_URL || !RUN_ID || !RUN_TOKEN) {
    const missing = [
      ['V4_GATEWAY_URL', GATEWAY_URL], ['V4_RUN_ID', RUN_ID], ['V4_RUN_TOKEN', RUN_TOKEN],
    ].filter(([, value]) => !value).map(([name]) => name);
    return { transport: 'local', reason: `Липсват ${missing.join(', ')}.` };
  }
  return { transport: 'browser-use', gateway: GATEWAY_URL };
}

export async function gatewaySession() {
  if (!browserUseConfigured()) throw new Error('Browser Use шлюзът не е конфигуриран (V4_GATEWAY_URL, V4_RUN_ID, V4_RUN_TOKEN).');
  return {
    transport: 'browser-use',
    async send(method, params) {
      const response = await fetch(gatewayUrl(CDP_PATH), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${RUN_TOKEN}` },
        body: JSON.stringify({ method, params }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Шлюзът отказа ${method}: ${JSON.stringify(data).slice(0, 300)}`);
      // Accept either a bare result or a wrapped one, so a small contract
      // difference does not break the step logic.
      return data.result ?? data;
    },
    // The proven script shipped photos through the gateway, because the browser
    // runs elsewhere and cannot see our filesystem.
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

// Used to prove the form steps without the gateway. Playwright is imported
// lazily so the service still runs when only the gateway path is used.
export async function localSession() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: process.env.PUBLICATIONS_HEADLESS !== 'false' });
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  return {
    transport: 'local',
    send: (method, params) => cdp.send(method, params),
    // Photos are local files for us, so they are written to disk and handed to
    // the input directly.
    async stageImages(urls) {
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
    },
    async close() { await browser.close(); },
  };
}

export async function openSession() {
  return browserUseConfigured() ? gatewaySession() : localSession();
}