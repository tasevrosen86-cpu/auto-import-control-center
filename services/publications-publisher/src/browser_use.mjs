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
const PROFILES_PATH = process.env.BROWSER_USE_PROFILES_PATH || '/api/v4/profiles';

export function browserUseApiConfigured() {
  return Boolean(process.env.BROWSER_USE_API_KEY);
}

// The profile the Mobile.bg session lives in. This is a *name*; the API wants a
// profile id, so `resolveProfile` looks the name up and creates the profile if
// it does not exist yet.
export function profileName() {
  return process.env.BROWSER_USE_PROFILE || 'mobilebg-publisher';
}

export function profileId() {
  return String(process.env.BROWSER_PROFILE_ID || '').trim();
}

function headers(key, json = false) {
  return json
    ? { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' }
    : { 'X-Browser-Use-API-Key': key };
}

// Finds the profile by name, creating it on first use.
//
// Two things were measured against the live service and against its OpenAPI
// document: the browser create call takes `profileId` and not a profile name —
// sending a name is silently ignored, which is why a browser created with
// `profile: "mobilebg-publisher"` came back signed out. And profiles are managed
// through /profiles, not through the browser call.
//
// `BROWSER_PROFILE_ID` wins when it is set, but it is optional on purpose: an
// unset id must not mean "no profile", because a run without a profile starts
// signed out and every task then fails on a page that has no form. When the id
// is absent the profile is found by name, and created if this is the first run.
// The caller then signs in once through the visible browser, and that login is
// what every later run loads.
export async function resolveProfile() {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error('Липсва BROWSER_USE_API_KEY в средата на сървъра.');
  const configuredId = profileId();
  if (configuredId) return configuredId;
  const name = profileName();

  const list = await fetch(`${API_BASE}${PROFILES_PATH}`, { headers: headers(key) });
  const listText = await list.text();
  if (!list.ok) {
    throw new Error(`Browser Use отказа списъка с профили: HTTP ${list.status} ${listText.slice(0, 200)}`);
  }
  let data = {};
  try { data = JSON.parse(listText); } catch { /* the shape is checked below */ }
  const items = Array.isArray(data) ? data : (data.items || data.profiles || []);
  const existing = items.find((profile) => profile?.name === name);
  if (existing?.id) return existing.id;

  const created = await fetch(`${API_BASE}${PROFILES_PATH}`, {
    method: 'POST',
    headers: headers(key, true),
    body: JSON.stringify({ name }),
  });
  const createdText = await created.text();
  let createdData = {};
  try { createdData = JSON.parse(createdText); } catch { /* read by name below */ }
  if (!created.ok) {
    throw new Error(`Browser Use отказа създаването на профил "${name}": HTTP ${created.status} ${createdText.slice(0, 200)}`);
  }
  const id = createdData?.id || createdData?.data?.id;
  if (!id) throw new Error(`Профилът "${name}" беше създаден, но отговорът не съдържа id.`);
  return id;
}

// Reports which profile holds the saved Mobile.bg session, and whether that
// session is actually there. This is what tells an operator whether the site
// needs one more manual login; it reads nothing else and prints no secret.
export async function profileSummary() {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error('Липсва BROWSER_USE_API_KEY в средата на сървъра.');
  const list = await fetch(`${API_BASE}${PROFILES_PATH}`, { headers: headers(key) });
  const text = await list.text();
  if (!list.ok) throw new Error(`Browser Use отказа списъка с профили: HTTP ${list.status} ${text.slice(0, 200)}`);
  let data = {};
  try { data = JSON.parse(text); } catch { /* read tolerantly below */ }
  const items = Array.isArray(data) ? data : (data.items || data.profiles || []);
  const name = profileName();
  const profile = items.find((item) => item?.name === name) || null;
  const domains = Array.isArray(profile?.cookieDomains) ? profile.cookieDomains : [];
  return {
    name,
    id: profile?.id || null,
    exists: Boolean(profile),
    mobileSession: domains.some((domain) => /mobile\.bg/i.test(String(domain))),
    cookieDomains: domains,
    lastUsedAt: profile?.lastUsedAt || null,
  };
}

// The response shape is confirmed against the live service: a flat object with
// `id`, `cdpUrl` and `liveUrl`, and a `status` that reads `active` or `stopped`.
// The tolerant reader is kept because the fields are still read by name rather
// than by position, so a wrapper object would also be understood.
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

  // The saved Mobile.bg session lives in the profile, so the browser is attached
  // to it. Without this the browser starts signed out and the publish page has
  // no form at all.
  const body = { profileId: await resolveProfile() };
  if (process.env.BROWSER_USE_PROXY_COUNTRY) body.proxyCountryCode = process.env.BROWSER_USE_PROXY_COUNTRY;

  const response = await fetch(`${API_BASE}${CREATE_PATH}`, {
    method: 'POST',
    headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  // Verified against the live service: DELETE answers 405 and POST /stop answers
  // 404; the working call is PATCH with {"action":"stop"}, which replies 200 and
  // reports status "stopped". Getting this wrong leaves a browser billing.
  const response = await fetch(`${API_BASE}${CREATE_PATH}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stop' }),
  });
  return response.ok;
}