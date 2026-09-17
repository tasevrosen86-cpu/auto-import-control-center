// Browser Use browser infrastructure — creates a real remote Chromium and hands
// back its CDP endpoint.
//
// This is the infrastructure API only. No Browser Use AI Agent is involved: we
// ask for a browser and then drive it ourselves with our own step logic.
//
// The API key is read from the server environment and is never returned to a
// caller, logged, or written anywhere. Callers get the browser id, the CDP URL
// and the live view URL, which are addresses rather than credentials.

const API_BASE = process.env.BROWSER_USE_API_BASE || 'https://api.browser-use.com';
const CREATE_PATH = process.env.BROWSER_USE_CREATE_PATH || '/api/v4/browsers';

export function browserUseApiConfigured() {
  return Boolean(process.env.BROWSER_USE_API_KEY);
}

// The response envelope is not pinned down in the interface we were given, so
// the fields are picked up from either a flat object or a nested one instead of
// assuming a single shape.
function pick(data, names) {
  for (const name of names) {
    if (data?.[name]) return data[name];
  }
  for (const wrapper of ['data', 'browser', 'result']) {
    if (data?.[wrapper]) {
      for (const name of names) {
        if (data[wrapper][name]) return data[wrapper][name];
      }
    }
  }
  return null;
}

export async function createBrowser() {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error('Липсва BROWSER_USE_API_KEY в средата на сървъра.');

  const response = await fetch(`${API_BASE}${CREATE_PATH}`, {
    method: 'POST',
    headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* keep the raw text for the error */ }
  if (!response.ok) {
    // Never echo the key or the request headers, only what the service said.
    // The status is spelled out because the three failures here need completely
    // different fixes, and they look alike from a distance.
    const hint = response.status === 402
      ? ' Акаунтът в Browser Use е без достатъчен баланс. Това не е блокировка и не е грешен ключ — зареди кредит.'
      : response.status === 401
        ? ' Ключът е невалиден или отменен.'
        : '';
    throw new Error(`Browser Use отказа създаването на браузър: HTTP ${response.status} ${text.slice(0, 300)}.${hint}`);
  }

  const id = pick(data, ['id', 'browserId', 'browser_id']);
  const cdpUrl = pick(data, ['cdpUrl', 'cdp_url', 'wsUrl', 'websocketUrl']);
  const liveUrl = pick(data, ['liveUrl', 'live_url']);
  if (!id || !cdpUrl) {
    throw new Error(`Отговорът не съдържа id и cdpUrl. Получени полета: ${Object.keys(data).join(', ') || '(няма)'}`);
  }
  return { id, cdpUrl, liveUrl };
}

export async function stopBrowser(id) {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key || !id) return false;
  const response = await fetch(`${API_BASE}${CREATE_PATH}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Browser-Use-API-Key': key },
  });
  return response.ok;
}