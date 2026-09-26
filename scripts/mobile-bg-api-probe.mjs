// Read-only probe of the official Mobile.bg import API.
//
// Why this exists: `advertpub` answers `{"status":"error","msg":"Wrong fields",
// "fields":[...]}` and names the offending parameters, but `catfields` returns
// only `fname`/`ftype`/`ftext` — never the accepted values. Those live behind
// `dictionary`. The publisher declares a `dictionary()` client method but never
// calls it, so no list value has ever been checked against Mobile.bg's own list.
//
// This script reads the schema and the dictionaries and compares them with the
// exact values our draft holds. It calls login -> catfields -> dictionary ->
// logout. `advertpub` and `advertpicts` are never called, so no listing is
// created, nothing is billed and no draft is touched.
//
// Run it where api.mobile.bg is reachable (the VPS): from CI the API answers a
// Cloudflare 403 before the request is ever seen.
//
//   node scripts/mobile-bg-api-probe.mjs /etc/aicc-mobile-bg-api.env
//
// The token, the username and the password are never printed.

import { readFileSync } from 'node:fs';

const envPath = process.argv[2] || '/etc/aicc-mobile-bg-api.env';

// systemd's EnvironmentFile is not shell-parsed, so it is read the same way
// here: raw KEY=VALUE with an optional `export` and optional surrounding quotes.
function readEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quoted = value.length > 1
      && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

const env = readEnvFile(envPath);
const base = (env.MOBILE_BG_API_BASE_URL || 'https://api.mobile.bg').replace(/\/+$/, '');
const username = env.MOBILE_BG_API_USERNAME || env.MOBILE_BG_USERNAME || '';
const password = env.MOBILE_BG_API_PASSWORD || env.MOBILE_BG_PASSWORD || '';

let token = '';

// Anything that could carry a credential is scrubbed before it is printed, in
// one place, so no call site can forget to do it.
function scrub(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return '';
  for (const secret of [token, username, password]) {
    if (secret && secret.length >= 4) text = text.split(secret).join('<скрито>');
  }
  return text;
}

async function call(method, path, options = {}) {
  const init = { method, signal: AbortSignal.timeout(30000) };
  if (options.form) {
    init.headers = { 'content-type': 'application/x-www-form-urlencoded' };
    init.body = new URLSearchParams(options.form).toString();
  }
  try {
    const response = await fetch(base + path, init);
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  } catch (cause) {
    return { status: null, body: { network_error: cause instanceof Error ? cause.message : String(cause) } };
  }
}

function heading(title) {
  console.log(`\n===== ${title} =====`);
}

function printRaw(result, limit = 1500) {
  console.log('HTTP', result.status);
  console.log(scrub(result.body).slice(0, limit));
}

// A dictionary answers `{ "<field>": [ { optval, opttext }, ... ] }`, where
// `optval` is what has to be sent and `opttext` is only the label shown on the
// site. The two are easy to confuse and the difference is the whole bug, so
// they are printed as a pair, and `optval` alone is what the comparison uses.
function describeDictionary(label, result) {
  heading(`DICTIONARY ${label}`);
  console.log('HTTP', result.status);
  const body = result.body;
  if (!body || typeof body !== 'object') { printRaw(result); return { values: [], labels: [] }; }

  const values = [];
  const labels = [];
  for (const [field, entries] of Object.entries(body)) {
    const list = Array.isArray(entries) ? entries : [entries];
    console.log(`  поле: ${field}  (записи: ${list.length})`);
    for (const entry of list) {
      if (entry && typeof entry === 'object') {
        const value = entry.optval ?? entry.value ?? entry.id ?? null;
        const text = entry.opttext ?? entry.ftext ?? entry.name ?? entry.label ?? '';
        console.log('    optval=' + String(value ?? '').padEnd(10) + 'opttext=' + String(text));
        if (value !== null && value !== undefined) values.push(String(value));
        if (text) labels.push(String(text));
      } else {
        console.log('    ' + String(entry));
        values.push(String(entry));
      }
    }
  }
  if (values.length === 0 && labels.length === 0) printRaw(result);
  return { values, labels };
}

// Reports whether our exact value is one the API itself accepts. The
// distinction that matters is `optval` versus `opttext`: `optval` is the value
// `advertpub` validates, while `opttext` is only the label rendered on the site.
// A value that matches an `opttext` but no `optval` is exactly the shape of a
// rejected field, so that case is called out separately rather than as a hit.
function compare(label, ours, options, labels) {
  console.log(`\n----- ${label} -----`);
  console.log('  наша стойност:', JSON.stringify(ours));
  const values = options || [];
  const texts = labels || [];
  if (values.length === 0 && texts.length === 0) { console.log('  речникът е празен или неразчетен'); return; }

  const lower = String(ours).toLowerCase();
  const valueHit = values.includes(ours);
  const valueCaseOnly = values.find(value => value.toLowerCase() === lower);
  const labelHit = texts.includes(ours);
  const labelCaseOnly = texts.find(text => text.toLowerCase() === lower);

  if (valueHit) console.log('  ✅ приема се: съвпада с optval');
  else if (valueCaseOnly) console.log('  ⚠ съвпада с optval само по регистър:', JSON.stringify(valueCaseOnly));
  else if (labelHit) console.log('  ❌ ОТХВЪРЛЯ СЕ: съвпада само с opttext (етикет), не с optval');
  else if (labelCaseOnly) console.log('  ❌ ОТХВЪРЛЯ СЕ: съвпада с opttext само по регистър:', JSON.stringify(labelCaseOnly));
  else console.log('  ❌ ОТХВЪРЛЯ СЕ: няма нито optval, нито opttext');

  if (!valueHit) {
    const pairs = values.map((value, index) => `${value}=${texts[index] ?? ''}`);
    console.log('  optval=opttext:', pairs.length ? JSON.stringify(pairs) : '(няма)');
  }
}

console.log('база:', base);
console.log('потребител зададен:', username ? 'да' : 'НЕ');
console.log('парола зададена:', password ? 'да' : 'НЕ');
if (!username || !password) {
  console.error('::error::липсват MOBILE_BG_API_USERNAME / MOBILE_BG_API_PASSWORD');
  process.exit(1);
}

// --- login -----------------------------------------------------------------
heading('ВХОД');
const login = await call('POST', '/import_api/login', { form: { username, password } });
console.log('HTTP', login.status, '| status:', login.body?.status ?? null);
token = login.body?.token || '';
if (!token) {
  console.log('НЯМА TOKEN:', scrub(login.body).slice(0, 300));
  process.exit(1);
}
console.log('token: получен, дължина', token.length);

// --- catfields -------------------------------------------------------------
// The full schema, printed as fname / ftype / ftext. This is what `advertpub`
// validates against, and the excerpt stored in `api_trace` is truncated at 600
// characters, so the complete list has never been visible before.
heading('CATFIELDS 1/1 (пълен)');
const catfields = await call('GET', '/import_api/catfields/1/1/');
console.log('HTTP', catfields.status);
if (catfields.body && typeof catfields.body === 'object' && !Array.isArray(catfields.body)) {
  for (const [key, value] of Object.entries(catfields.body)) {
    console.log('  ' + String(value?.fname ?? key).padEnd(22) + String(value?.ftype ?? '').padEnd(10) + String(value?.ftext ?? ''));
  }
  console.log('общо полета:', Object.keys(catfields.body).length);
} else {
  printRaw(catfields);
}

// --- dictionaries ----------------------------------------------------------
// Every list field in the minimal payload, plus the three the API named as
// wrong, so a single run answers all of them.
const listFields = ['nup', 'category', 'price_dds', 'marka', 'month', 'year', 'engine_type', 'transmission', 'color', 'locat', 'locatc', 'currency', 'euroclass', 'rub', 'term'];
const collected = {};

const wholeCategory = await call('GET', '/import_api/dictionary/1/1/');
describeDictionary('1/1 (цяла категория)', wholeCategory);

for (const field of listFields) {
  let result = await call('GET', `/import_api/dictionary/1/1/${field}/`);
  // The publisher's client assumes no token is needed; this has never been run,
  // so a rejected call is retried with the token in the query rather than
  // concluding the dictionary does not exist.
  const failed = !result.body || typeof result.body === 'string' || result.status !== 200;
  if (failed) {
    const withToken = await call('GET', `/import_api/dictionary/1/1/${field}/?token=${encodeURIComponent(token)}`);
    if (withToken.status === 200 && withToken.body && typeof withToken.body === 'object') result = withToken;
  }
  collected[field] = describeDictionary(field, result);
  // The three fields the API named as wrong are also printed raw: the exact
  // shape matters, and a rendering can hide an unexpected nesting.
  if (['nup', 'category', 'price_dds'].includes(field)) {
    console.log('  суров JSON:', scrub(result.body).slice(0, 1200));
  }
}

// --- model -----------------------------------------------------------------
// `model` is scoped to the chosen make, which is why the same parameter can be
// accepted for one car and rejected for another.
for (const make of ['Audi', 'Hyundai']) {
  const result = await call('GET', `/import_api/dictionary/1/1/model/?marka=${encodeURIComponent(make)}`);
  collected[`model:${make}`] = describeDictionary(`model?marka=${make}`, result);
}

// --- our values ------------------------------------------------------------
// The exact strings from draft ede5e898 (Audi Q7, job cae12df8) and draft
// 31e70aed (Hyundai TUCSON, job ac4f218d), so the comparison is against what
// was really sent rather than a reconstruction.
console.log('\n\n############ СРАВНЕНИЕ С ИЗПРАТЕНИТЕ СТОЙНОСТИ ############');
compare('nup ← condition "Употребяван" (изпратено)', 'Употребяван', (collected.nup || {}).values, (collected.nup || {}).labels);
compare('nup ← condition "Използван" (в черновата)', 'Използван', (collected.nup || {}).values, (collected.nup || {}).labels);
compare('category ← чернова "Автомобили и джипове" (НЕ се изпраща)', 'Автомобили и джипове', (collected.category || {}).values, (collected.category || {}).labels);
compare('category ← "1" (topmenu)', '1', (collected.category || {}).values, (collected.category || {}).labels);
compare('price_dds ← vat_included "Цената е с включено ДДС" (пращаме като dds)', 'Цената е с включено ДДС', (collected.price_dds || {}).values, (collected.price_dds || {}).labels);
compare('marka "Audi"', 'Audi', (collected.marka || {}).values, (collected.marka || {}).labels);
compare('marka "Hyundai"', 'Hyundai', (collected.marka || {}).values, (collected.marka || {}).labels);
compare('model "Q7" (Audi)', 'Q7', (collected['model:Audi'] || {}).values, (collected['model:Audi'] || {}).labels);
compare('model "TUCSON" (Hyundai)', 'TUCSON', (collected['model:Hyundai'] || {}).values, (collected['model:Hyundai'] || {}).labels);
compare('month "Април"', 'Април', (collected.month || {}).values, (collected.month || {}).labels);
compare('year "2025"', '2025', (collected.year || {}).values, (collected.year || {}).labels);
compare('engine_type "Бензин"', 'Бензин', (collected.engine_type || {}).values, (collected.engine_type || {}).labels);
compare('transmission "Автоматична"', 'Автоматична', (collected.transmission || {}).values, (collected.transmission || {}).labels);
compare('color "Черен"', 'Черен', (collected.color || {}).values, (collected.color || {}).labels);
compare('locat "Извън страната"', 'Извън страната', (collected.locat || {}).values, (collected.locat || {}).labels);
compare('locatc "Канада"', 'Канада', (collected.locatc || {}).values, (collected.locatc || {}).labels);
compare('currency "EUR"', 'EUR', (collected.currency || {}).values, (collected.currency || {}).labels);
compare('euroclass ← euro_standard "Euro 6"', 'Euro 6', (collected.euroclass || {}).values, (collected.euroclass || {}).labels);

// --- logout ----------------------------------------------------------------
heading('ИЗХОД');
const logout = await call('POST', `/import_api/logout/${token}/`);
console.log('HTTP', logout.status);
console.log(scrub(logout.body).slice(0, 200));
token = '';
