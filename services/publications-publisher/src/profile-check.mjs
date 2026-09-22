// Reads the Browser Use profiles and reports which one holds the Mobile.bg
// session.
//
// Read-only. It creates nothing, changes nothing and prints no secret — only
// profile names, ids and the domains whose cookies are stored, which is what
// says whether a saved login exists.
//
// Run: node src/profile-check.mjs

import { profileName, profileId, browserUseApiConfigured } from './browser_use.mjs';

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
  console.log(`в него има mobile.bg сесия: ${domains.some((d) => MOBILE.test(String(d))) ? 'ДА' : 'НЕ — трябва един вход през сайта'}`);
}
console.log(`агентът ще подаде профил: ${configured || match ? 'ДА' : 'НЕ'}`);
