import { useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, RotateCcw, ExternalLink, Filter, Globe } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { formatEUR, formatNumber } from '@/lib/format';
import {
  canadaCatalogStats, canadaCatalogFilterOptions, canadaCatalogMeta,
  getCanadaCatalogModelsForMake, filterCanadaCatalog, type CanadaCatalogRow,
} from '@/lib/canada_catalog';

const PAGE_SIZE = 10;

const COMPARISON_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'Всички' },
  { value: 'canada_cheaper', label: 'Канада по-ниска от България' },
  { value: 'no_comparison', label: 'Няма българска цена' },
  { value: 'plain', label: 'Канада по-висока от България' },
];

export function CanadaCatalog() {
  const [makeFilter, setMakeFilter] = useState('ALL');
  const [modelFilter, setModelFilter] = useState('ALL');
  const [yearFrom, setYearFrom] = useState('ALL');
  const [yearTo, setYearTo] = useState('ALL');
  const [fuelFilter, setFuelFilter] = useState('ALL');
  const [comparison, setComparison] = useState('ALL');
  const [page, setPage] = useState(1);

  const modelsForMake = useMemo(
    () => (makeFilter === 'ALL' ? [] : getCanadaCatalogModelsForMake(makeFilter)),
    [makeFilter],
  );

  const filtered = useMemo(() => filterCanadaCatalog({
    make: makeFilter, model: modelFilter, fuel: fuelFilter,
    yearFrom, yearTo, comparison,
  }), [makeFilter, modelFilter, fuelFilter, yearFrom, yearTo, comparison]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const fromItem = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const toItem = Math.min(currentPage * PAGE_SIZE, totalCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function clearFilters() {
    setMakeFilter('ALL'); setModelFilter('ALL'); setFuelFilter('ALL');
    setYearFrom('ALL'); setYearTo('ALL'); setComparison('ALL'); setPage(1);
  }

  return <div className="space-y-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight text-[#172541]">
          <Globe className="h-5 w-5 text-slate-400" /> Канада каталог
        </h2>
        <span className="text-sm font-semibold text-slate-500">
          Общо: {formatNumber(canadaCatalogStats.total)} позиции
        </span>
      </div>
      <span className="text-[10px] font-semibold text-slate-400">{canadaCatalogMeta.title}</span>
    </div>

    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 lg:grid-cols-6">
        <FilterSelect label="Марка" value={makeFilter} onChange={(v) => { setMakeFilter(v); setModelFilter('ALL'); setPage(1); }} options={['ALL', ...canadaCatalogFilterOptions.makes]} allLabel="Всички" />
        <FilterSelect label="Модел" value={modelFilter} onChange={(v) => { setModelFilter(v); setPage(1); }} options={['ALL', ...(makeFilter !== 'ALL' ? modelsForMake : [])]} allLabel="Всички" />
        <FilterSelect label="Година от" value={yearFrom} onChange={(v) => { setYearFrom(v); setPage(1); }} options={['ALL', ...canadaCatalogFilterOptions.years.map(String)]} allLabel="Всички" />
        <FilterSelect label="Година до" value={yearTo} onChange={(v) => { setYearTo(v); setPage(1); }} options={['ALL', ...canadaCatalogFilterOptions.years.map(String)]} allLabel="Всички" />
        <FilterSelect label="Гориво" value={fuelFilter} onChange={(v) => { setFuelFilter(v); setPage(1); }} options={['ALL', ...canadaCatalogFilterOptions.fuels]} allLabel="Всички" />
        <FilterSelect label="Сравнение" value={comparison} onChange={(v) => { setComparison(v); setPage(1); }} options={COMPARISON_OPTIONS.map(o => o.value)} allLabel="Всички" labels={Object.fromEntries(COMPARISON_OPTIONS.map(o => [o.value, o.label]))} />
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => setPage(1)} className="flex h-8 items-center gap-1.5 rounded bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700"><Search className="h-3.5 w-3.5" /> Търси</button>
        <button onClick={clearFilters} className="flex h-8 items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw className="h-3.5 w-3.5" /> Изчисти</button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Kpi icon="🚙" value={canadaCatalogStats.total} label="Общо позиции" color="blue" />
      <Kpi icon="🇨🇦" value={canadaCatalogStats.withCanadaPrice} label="С канадска цена" color="red" />
      <Kpi icon="↓" value={canadaCatalogStats.canadaCheaper} label="Канада по-ниска" color="green" />
      <Kpi icon="—" value={canadaCatalogStats.noComparison} label="Без българска цена" color="rose" />
      <Kpi icon="🇧🇬" value={canadaCatalogStats.withBgPrice} label="С българска цена" color="amber" />
      <Kpi icon="☁" value={canadaCatalogStats.published} label="Публикувани" color="purple" />
    </div>

    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] table-fixed text-left text-[10px]">
          <colgroup>
            <col className="w-10" /><col className="w-[190px]" /><col className="w-14" /><col className="w-16" />
            <col className="w-[110px]" /><col className="w-[110px]" />
            <col className="w-[110px]" /><col className="w-[110px]" />
            <col className="w-[200px]" /><col className="w-[90px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-[#edf3f9] text-[9px] font-extrabold text-slate-700">
              <th rowSpan={2} className="px-1 text-center">#</th>
              <th rowSpan={2} className="px-2">Марка / Модел</th>
              <th rowSpan={2} className="px-1 text-center">Година</th>
              <th rowSpan={2} className="px-1 text-center">Гориво</th>
              <th colSpan={2} className="border-l border-slate-200 bg-blue-50 px-2 text-center"><span className="mr-1">🇨🇦</span> Канада (AutoTrader)</th>
              <th colSpan={2} className="border-l border-slate-200 bg-emerald-50 px-2 text-center"><span className="mr-1">🇧🇬</span> България (Mobile.bg)</th>
              <th rowSpan={2} className="border-l border-slate-200 px-2 text-center">Статус</th>
              <th rowSpan={2} className="px-1 text-center">Действие</th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-semibold text-slate-500">
              <th className="border-l border-slate-200 px-1 text-center">Крайна цена EUR</th><th className="px-1 text-center">Линкове</th>
              <th className="border-l border-slate-200 px-1 text-center">EUR</th><th className="px-1 text-center">Линкове</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.length === 0 ? (
              <tr><td colSpan={10} className="py-12 text-center text-slate-400">Няма намерени превозни средства</td></tr>
            ) : (
              pageRows.map(row => <CatalogRow key={row.position} row={row} />)
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500">
        <div className="flex items-center gap-2">
          Покажи
          <select className="rounded border border-slate-200 px-1.5 py-1" defaultValue={PAGE_SIZE}><option>{PAGE_SIZE}</option></select>
          на страница
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="rounded border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-3 w-3" /></button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = i + 1;
            return <button key={p} onClick={() => setPage(p)} className={`rounded px-2 py-1 ${p === currentPage ? 'bg-blue-600 text-white' : 'border border-slate-200 hover:bg-slate-50'}`}>{p}</button>;
          })}
          {totalPages > 5 && <span>...</span>}
          <button onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} className="rounded border border-slate-200 p-1 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-3 w-3" /></button>
        </div>
        <span>Показани {fromItem}–{toItem} от {totalCount} позиции</span>
      </div>
    </div>

    <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-[9px] text-slate-600 md:grid-cols-3">
      <div>
        <p className="mb-1 font-bold text-slate-700">Оцветяване на крайната цена (EUR)</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">Канада по-ниска от България</span>
          <span className="rounded bg-rose-100 px-2 py-1 text-rose-800">Няма българска цена</span>
          <span className="rounded bg-slate-50 px-2 py-1 text-slate-500">Канада по-висока</span>
        </div>
      </div>
      <div>
        <p className="mb-1 font-bold text-slate-700">Българска цена</p>
        <p>Най-ниската валидна цена от точния Mobile.bg филтър (sort=3). Липсва, когато филтърът не върне обява с цена.</p>
      </div>
      <div>
        <p className="mb-1 font-bold text-slate-700">Икони</p>
        <div className="flex gap-3 text-slate-500">
          <span><ExternalLink className="mr-1 inline h-3 w-3 text-blue-600" /> Отвори обява</span>
          <span><Filter className="mr-1 inline h-3 w-3 text-blue-600" /> Точен филтър</span>
        </div>
      </div>
    </div>
  </div>;
}

function FilterSelect({ label, value, onChange, options, allLabel, labels }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; allLabel: string; labels?: Record<string, string>;
}) {
  return <label>
    <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)} className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400">
      {options.map(o => <option key={o} value={o}>{o === 'ALL' ? allLabel : (labels?.[o] ?? o)}</option>)}
    </select>
  </label>;
}

function Kpi({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  const styles: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-600',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-600',
    rose: 'border-rose-200 bg-rose-50 text-rose-600',
    red: 'border-red-200 bg-red-50 text-red-700',
    purple: 'border-violet-200 bg-violet-50 text-violet-600',
  };
  return <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${styles[color]}`}>
    <span className="text-xl font-bold">{icon}</span>
    <div>
      <p className="text-lg font-extrabold leading-5">{value.toLocaleString('bg-BG')}</p>
      <p className="text-[9px] font-semibold opacity-80">{label}</p>
    </div>
  </div>;
}

const FINAL_PRICE_CLASS: Record<string, string> = {
  canada_cheaper: 'bg-emerald-50 text-emerald-800',
  no_comparison: 'bg-rose-50 text-rose-800',
  plain: 'bg-slate-50 text-slate-600',
};

function CatalogRow({ row: r }: { row: CanadaCatalogRow }) {
  return <tr className={`transition hover:bg-blue-50/60 ${r.published ? 'bg-amber-50/40' : ''}`}>
    <td className="px-1 text-center font-bold text-slate-400">{r.position}</td>
    <td className="px-2">
      <p className="font-bold text-slate-800">{r.make}</p>
      <p className="font-semibold text-slate-700">{r.model}</p>
    </td>
    <td className="px-1 text-center font-semibold text-slate-600">{r.model_year}</td>
    <td className="px-1 text-center font-semibold text-slate-600">{r.fuel}</td>

    <td className="border-l border-slate-100 px-1 text-center">
      <span className={`inline-block rounded px-1.5 py-0.5 font-bold ${FINAL_PRICE_CLASS[r.comparison]}`}>
        {formatEUR(r.final_eur)}
      </span>
      {r.price_cad !== null && <p className="mt-0.5 text-[9px] text-slate-400">{formatNumber(r.price_cad)} CAD</p>}
    </td>
    <td className="px-1 text-center">
      <LinkButtons listingUrl={r.canada_listing_url} filterUrl={r.canada_filter_url} />
    </td>

    <td className="border-l border-slate-100 px-1 text-center font-bold text-slate-700">
      {r.bg_price_eur !== null ? formatEUR(r.bg_price_eur) : <span className="text-slate-300">—</span>}
    </td>
    <td className="px-1 text-center">
      <LinkButtons listingUrl={r.bg_listing_url} filterUrl={r.bg_filter_url} />
    </td>

    <td className="border-l border-slate-100 px-2 text-center">
      {r.published
        ? <Badge color="amber">Публикувана</Badge>
        : r.bg_found
          ? <Badge color="emerald">Намерена най-ниска обява</Badge>
          : <Badge color="rose">Няма валидна обява с цена</Badge>}
    </td>
    <td className="px-1 text-center">
      {r.canada_listing_url
        ? <a href={r.canada_listing_url} target="_blank" rel="noopener noreferrer" className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-600 hover:bg-blue-100">
            <ExternalLink className="inline h-3 w-3" /> Отвори
          </a>
        : <span className="text-slate-300">—</span>}
    </td>
  </tr>;
}

function LinkButtons({ listingUrl, filterUrl }: { listingUrl: string | null; filterUrl: string | null }) {
  return <span className="inline-flex gap-0.5">
    {listingUrl
      ? <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="rounded border border-blue-200 bg-white p-1 text-blue-600 hover:bg-blue-50" title="Отвори обява"><ExternalLink className="h-3 w-3" /></a>
      : <span className="rounded border border-slate-100 bg-slate-50 p-1 text-slate-300" title="Няма линк към обява"><ExternalLink className="h-3 w-3" /></span>}
    {filterUrl
      ? <a href={filterUrl} target="_blank" rel="noopener noreferrer" className="rounded border border-blue-200 bg-white p-1 text-blue-600 hover:bg-blue-50" title="Точен филтър"><Filter className="h-3 w-3" /></a>
      : <span className="rounded border border-slate-100 bg-slate-50 p-1 text-slate-300" title="Няма филтър линк"><Filter className="h-3 w-3" /></span>}
  </span>;
}
