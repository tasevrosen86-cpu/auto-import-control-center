import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('/workspace/aicc/src/data/canada_catalog_v45.json', 'utf8'));
const rows = d.rows;
const FUEL_ORDER = ['Бензин', 'Дизел', 'Хибрид', 'Електрически', 'Газ (LPG)'];
const fuelRank = f => (FUEL_ORDER.indexOf(f) < 0 ? 99 : FUEL_ORDER.indexOf(f));
let pass = 0, fail = 0;
const ck = (l, c, x = '') => c ? (pass++, console.log('  ok   ' + l)) : (fail++, console.log('  FAIL ' + l + (x ? ' — ' + x : '')));

const getModels = m => Array.from(new Set(rows.filter(r => r.make === m).map(r => r.model))).sort((a, b) => a.localeCompare(b, 'bg'));
const filt = o => rows.filter(r => {
  if (o.make !== 'ALL' && r.make !== o.make) return false;
  if (o.model !== 'ALL' && r.model !== o.model) return false;
  if (o.fuel !== 'ALL' && r.fuel !== o.fuel) return false;
  if (o.yearFrom !== 'ALL' && r.model_year < Number(o.yearFrom)) return false;
  if (o.yearTo !== 'ALL' && r.model_year > Number(o.yearTo)) return false;
  if (o.comparison !== 'ALL' && r.comparison !== o.comparison) return false;
  return true;
});
const ALL = { make: 'ALL', model: 'ALL', fuel: 'ALL', yearFrom: 'ALL', yearTo: 'ALL', comparison: 'ALL' };

ck('общо 405', rows.length === 405, String(rows.length));
ck('без филтър връща всички', filt(ALL).length === 405);
ck('марка Audi има записи', filt({ ...ALL, make: 'Audi' }).length > 0);
ck('модели Audi непразни', getModels('Audi').length > 0, getModels('Audi').join(','));
ck('модели BMW непразни', getModels('BMW').length > 0);
ck('модели Mercedes непразни', getModels('Mercedes-Benz').length > 0);
ck('модел Q3 връща само Q3', filt({ ...ALL, make: 'Audi', model: 'Q3' }).every(r => r.model === 'Q3'));
ck('comparison филтър', filt({ ...ALL, comparison: 'canada_cheaper' }).length === 127);
ck('no_comparison филтър', filt({ ...ALL, comparison: 'no_comparison' }).length === 101);
ck('plain филтър', filt({ ...ALL, comparison: 'plain' }).length === 177);
ck('година от 2024', filt({ ...ALL, yearFrom: '2024' }).every(r => r.model_year >= 2024));
ck('година до 2020', filt({ ...ALL, yearTo: '2020' }).every(r => r.model_year <= 2020));
ck('година 2020-2024', filt({ ...ALL, yearFrom: '2020', yearTo: '2024' }).every(r => r.model_year >= 2020 && r.model_year <= 2024));
ck('гориво Хибрид', filt({ ...ALL, fuel: 'Хибрид' }).every(r => r.fuel === 'Хибрид'));
ck('комбиниран филтър', filt({ make: 'BMW', model: 'X5', fuel: 'ALL', yearFrom: '2020', yearTo: '2022', comparison: 'ALL' }).every(r => r.make === 'BMW' && r.model === 'X5' && r.model_year >= 2020 && r.model_year <= 2022));
const s = id => rows.filter(r => r.comparison === id).length;
ck('сума на категориите = 405', s('canada_cheaper') + s('no_comparison') + s('plain') === 405);
ck('позиции уникални', new Set(rows.map(r => r.position)).size === 405);
ck('години сортирани низходящо', (() => { const y = Array.from(new Set(rows.map(r => r.model_year))).sort((a, b) => b - a); return y.every((v, i) => i === 0 || y[i - 1] >= v); })());
ck('горива по ред', (() => { const f = Array.from(new Set(rows.map(r => r.fuel))).sort((a, b) => fuelRank(a) - fuelRank(b)); return f.every((v, i) => i === 0 || fuelRank(f[i - 1]) <= fuelRank(v)); })());
ck('no_comparison => няма bg цена', rows.filter(r => r.comparison === 'no_comparison').every(r => r.bg_price_eur === null));
ck('canada_cheaper => има bg цена', rows.filter(r => r.comparison === 'canada_cheaper').every(r => r.bg_price_eur !== null));
ck('canada_cheaper => final < bg', rows.filter(r => r.comparison === 'canada_cheaper').every(r => r.final_eur < r.bg_price_eur));
// «plain» значи само «не е по-ниска от България». Когато канадската цена липсва
// (61 реда), крайната цена също е null и няма какво да се сравни.
ck('plain => без цена или final >= bg', rows.filter(r => r.comparison === 'plain').every(r => r.final_eur === null || r.final_eur >= r.bg_price_eur));
ck('plain с двете цени винаги final >= bg', rows.filter(r => r.comparison === 'plain' && r.final_eur !== null && r.bg_price_eur !== null).every(r => r.final_eur >= r.bg_price_eur));
ck('всички URL са https', rows.every(r => [r.canada_listing_url, r.canada_filter_url, r.bg_listing_url, r.bg_filter_url].filter(Boolean).every(u => u.startsWith('https://'))));
ck('всички са SUV марки', rows.every(r => ['Audi', 'BMW', 'Mercedes-Benz'].includes(r.make)));

console.log(`\n${pass} успешни, ${fail} неуспешни`);
process.exit(fail ? 1 : 0);
