import { useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, RotateCcw, Plus, Download, SlidersHorizontal, ExternalLink, Filter, Eye } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { formatEUR, STATUS_COLORS, STATUS_LABELS_BG, getStatusLabel, getPriceColor, priceColorClass, calcDiff, diffColor } from '@/lib/format';
import { catalogSorted, catalogStats, catalogFilterOptions, getCatalogModelsForMake, filterCatalog } from '@/lib/catalog';
import type { VehicleWithMarketplace, VehicleMarketplace } from '@/types';

interface VehicleListProps { onSelectVehicle: (id: number) => void; }

const PAGE_SIZE = 10;

const FUEL_ORDER_LABEL = ['Бензин', 'Дизел', 'Хибрид', 'Електрически', 'Газ (LPG)'];

export function VehicleList({ onSelectVehicle }: VehicleListProps) {
  const [makeFilter, setMakeFilter] = useState('ALL');
  const [modelFilter, setModelFilter] = useState('ALL');
  const [yearFrom, setYearFrom] = useState('ALL');
  const [yearTo, setYearTo] = useState('ALL');
  const [fuelFilter, setFuelFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const years = useMemo(
    () => Array.from(new Set(catalogSorted.map((v) => v.model_year))).sort((a, b) => b - a),
    [],
  );

  const modelsForMake = useMemo(() => {
    if (makeFilter === 'ALL') return [];
    return getCatalogModelsForMake(makeFilter);
  }, [makeFilter]);

  const filtered = useMemo(() => {
    return filterCatalog({
      make: makeFilter,
      model: modelFilter,
      fuel: fuelFilter,
      yearFrom,
      yearTo,
    });
  }, [makeFilter, modelFilter, fuelFilter, yearFrom, yearTo]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const fromItem = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const toItem = Math.min(currentPage * PAGE_SIZE, totalCount);
  const pageVehicles = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function clearFilters() {
    setMakeFilter('ALL'); setModelFilter('ALL'); setFuelFilter('ALL');
    setYearFrom('ALL'); setYearTo('ALL'); setPage(1);
  }

  return <div className="space-y-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Каталог автомобили</h2>
        <span className="text-sm font-semibold text-slate-500">Общо: {catalogStats.total.toLocaleString('bg-BG')} позиции</span>
      </div>
      <div className="flex gap-2">
        <button className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"><Plus className="h-3.5 w-3.5" /> Добави бележка</button>
        <button className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> Експорт</button>
        <button className="hidden items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 md:flex"><SlidersHorizontal className="h-3.5 w-3.5" /> Колони</button>
      </div>
    </div>

    <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5">
        <FilterSelect label="Марка" value={makeFilter} onChange={(v) => { setMakeFilter(v); setModelFilter('ALL'); setPage(1); }} options={['ALL', ...catalogFilterOptions.makes]} allLabel="Всички" />
        <FilterSelect label="Модел" value={modelFilter} onChange={(v) => { setModelFilter(v); setPage(1); }} options={['ALL', ...(makeFilter !== 'ALL' ? modelsForMake : [])]} allLabel="Всички" />
        <FilterSelect label="Година от" value={yearFrom} onChange={(v) => { setYearFrom(v); setPage(1); }} options={['ALL', ...years.map(String)]} allLabel="Всички" />
        <FilterSelect label="Година до" value={yearTo} onChange={(v) => { setYearTo(v); setPage(1); }} options={['ALL', ...years.map(String)]} allLabel="Всички" />
        <FilterSelect label="Гориво" value={fuelFilter} onChange={(v) => { setFuelFilter(v); setPage(1); }} options={['ALL', ...FUEL_ORDER_LABEL.filter(f => catalogFilterOptions.fuels.includes(f))]} allLabel="Всички" />
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => setPage(1)} className="flex h-8 items-center gap-1.5 rounded bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700"><Search className="h-3.5 w-3.5" /> Търси</button>
        <button onClick={clearFilters} className="flex h-8 items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw className="h-3.5 w-3.5" /> Изчисти</button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi icon="🚙" value={catalogStats.total} label="Общо позиции" color="blue" />
      <Kpi icon="✓" value={catalogStats.active} label="Активни" color="green" />
      <Kpi icon="◷" value={catalogStats.review} label="За преглед" color="amber" />
      <Kpi icon="×" value={catalogStats.noValid} label="Няма валидна обява" color="red" />
      <Kpi icon="☁" value={catalogStats.publishedBg} label="Публикувани в Mobile.bg" color="purple" />
    </div>

    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] table-fixed text-left text-[10px]">
          <colgroup>
            <col className="w-8" /><col className="w-10" /><col className="w-[190px]" /><col className="w-12" /><col className="w-14" />
            <col className="w-[80px]" /><col className="w-[100px]" />
            <col className="w-[80px]" /><col className="w-[100px]" />
            <col className="w-[80px]" /><col className="w-[100px]" />
            <col className="w-[80px]" /><col className="w-[80px]" />
            <col className="w-[78px]" /><col className="w-[60px]" /><col className="w-[74px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 bg-[#edf3f9] text-[9px] font-extrabold text-slate-700">
              <th rowSpan={2} className="px-2 text-center">□</th>
              <th rowSpan={2} className="px-1">ID</th>
              <th rowSpan={2} className="px-2">Снимка &nbsp; Марка / Модел</th>
              <th rowSpan={2} className="px-1 text-center">Година</th>
              <th rowSpan={2} className="px-1 text-center">Гориво</th>
              <th colSpan={2} className="border-l border-slate-200 bg-rose-50 px-2 text-center"><span className="mr-1">🇰🇷</span> Корея (Encar)</th>
              <th colSpan={2} className="border-l border-slate-200 bg-blue-50 px-2 text-center"><span className="mr-1">🇨🇦</span> Канада (AutoTrader)</th>
              <th colSpan={2} className="border-l border-slate-200 bg-emerald-50 px-2 text-center"><span className="mr-1">🇧🇬</span> България (Mobile.bg)</th>
              <th colSpan={2} className="border-l border-slate-200 px-2 text-center">Разлика спрямо BG</th>
              <th rowSpan={2} className="border-l border-slate-200 px-1 text-center">Статус</th>
              <th rowSpan={2} className="px-1 text-center">Публ.</th>
              <th rowSpan={2} className="px-1 text-center">Действие</th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-semibold text-slate-500">
              <th className="border-l border-slate-200 px-1 text-center">EUR</th><th className="px-1 text-center">Линкове</th>
              <th className="border-l border-slate-200 px-1 text-center">EUR</th><th className="px-1 text-center">Линкове</th>
              <th className="border-l border-slate-200 px-1 text-center">EUR</th><th className="px-1 text-center">Линкове</th>
              <th className="border-l border-slate-200 px-1 text-center">Корея</th><th className="px-1 text-center">Канада</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageVehicles.length === 0 ? (
              <tr><td colSpan={15} className="py-12 text-center text-slate-400">Няма намерени превозни средства</td></tr>
            ) : (
              pageVehicles.map(v => <VehicleRow key={v.permanent_id} vehicle={v} onSelect={onSelectVehicle} />)
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500">
        <div className="flex items-center gap-2">
          Покажи
          <select className="rounded border border-slate-200 px-1.5 py-1" defaultValue={PAGE_SIZE}>
            <option>{PAGE_SIZE}</option>
          </select>
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
        <p className="mb-1 font-bold text-slate-700">Легенда — статус</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(STATUS_LABELS_BG).slice(0, 8).map(([key, label]) => (
            <Badge key={key} color={STATUS_COLORS[key] || 'slate'}>{label}</Badge>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-bold text-slate-700">Оцветяване на цени (спрямо BG)</p>
        <div className="flex gap-2">
          <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">По-ниска от BG</span>
          <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">Близка до BG</span>
          <span className="rounded bg-rose-100 px-2 py-1 text-rose-800">По-висока от BG</span>
        </div>
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

function FilterSelect({ label, value, onChange, options, allLabel }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; allLabel: string;
}) {
  return <label>
    <span className="mb-0.5 block text-[10px] font-semibold text-slate-500">{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)} className="h-8 w-full rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400">
      {options.map(o => <option key={o} value={o}>{o === 'ALL' ? allLabel : o}</option>)}
    </select>
  </label>;
}

function Kpi({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  const styles: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-600',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-600',
    red: 'border-rose-200 bg-rose-50 text-rose-600',
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

function VehicleRow({ vehicle: v, onSelect }: { vehicle: VehicleWithMarketplace; onSelect: (id: number) => void }) {
  const mps: VehicleMarketplace[] = v.vehicle_marketplace || [];
  const korea = mps.find(m => m.marketplace === 'korea');
  const canada = mps.find(m => m.marketplace === 'canada');
  const bulgaria = mps.find(m => m.marketplace === 'mobile_bg');

  const koreaColor = getPriceColor(korea?.final_eur ?? null, bulgaria?.final_eur ?? null);
  const canadaColor = getPriceColor(canada?.final_eur ?? null, bulgaria?.final_eur ?? null);
  const bgColor = getPriceColor(bulgaria?.final_eur ?? null, bulgaria?.final_eur ?? null);

  return <tr onClick={() => onSelect(v.permanent_id)} className="group cursor-pointer transition hover:bg-blue-50/60">
    <td className="px-2 text-center text-slate-400"><input type="checkbox" onClick={e => e.stopPropagation()} className="h-3 w-3" /></td>
    <td className="px-1 font-bold text-slate-700">{v.permanent_id}</td>
    <td className="px-2">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-gradient-to-br from-slate-100 to-slate-300 text-[9px] font-bold text-slate-500">{v.make.slice(0, 2).toUpperCase()}</div>
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-800">{v.make}</p>
          <p className="truncate font-semibold text-slate-700">{v.model}</p>
        </div>
      </div>
    </td>
    <td className="px-1 text-center font-semibold text-slate-600">{v.model_year}</td>
    <td className="px-1 text-center font-semibold text-slate-600">{v.fuel}</td>

    <td className={`px-1 text-center font-bold ${priceColorClass(koreaColor)}`}>{formatEUR(korea?.final_eur ?? null)}</td>
    <td className="px-1 text-center"><LinkButtons listingUrl={korea?.listing_url} filterUrl={korea?.filter_url} /></td>

    <td className={`px-1 text-center font-bold ${priceColorClass(canadaColor)}`}>{formatEUR(canada?.final_eur ?? null)}</td>
    <td className="px-1 text-center"><LinkButtons listingUrl={canada?.listing_url} filterUrl={canada?.filter_url} /></td>

    <td className={`px-1 text-center font-bold ${priceColorClass(bgColor)}`}>{formatEUR(bulgaria?.final_eur ?? null)}</td>
    <td className="px-1 text-center"><LinkButtons listingUrl={bulgaria?.listing_url} filterUrl={bulgaria?.filter_url} /></td>

    <td className={`px-1 text-center font-bold ${diffColor(korea?.final_eur, bulgaria?.final_eur)}`}>{calcDiff(korea?.final_eur, bulgaria?.final_eur)}</td>
    <td className={`px-1 text-center font-bold ${diffColor(canada?.final_eur, bulgaria?.final_eur)}`}>{calcDiff(canada?.final_eur, bulgaria?.final_eur)}</td>

    <td className="px-1 text-center"><Badge color={STATUS_COLORS[v.status] || 'slate'}>{getStatusLabel(v.status)}</Badge></td>
    <td className="px-1 text-center">
      {bulgaria?.publication_status === 'PUBLISHED'
        ? <Badge color="emerald">Да</Badge>
        : bulgaria?.publication_status ? <Badge color="slate">{getStatusLabel(bulgaria.publication_status)}</Badge>
        : <span className="text-slate-300">—</span>}
    </td>
    <td className="px-1 text-center">
      <button onClick={e => { e.stopPropagation(); onSelect(v.permanent_id); }} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-600 hover:bg-blue-100">
        <Eye className="inline h-3 w-3" /> Детайли
      </button>
    </td>
  </tr>;
}

function LinkButtons({ listingUrl, filterUrl }: { listingUrl: string | null | undefined; filterUrl: string | null | undefined }) {
  return <span className="inline-flex gap-0.5">
    {listingUrl
      ? <a href={listingUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="rounded border border-blue-200 bg-white p-1 text-blue-600 hover:bg-blue-50" title="Отвори обява"><ExternalLink className="h-3 w-3" /></a>
      : <span className="rounded border border-slate-100 bg-slate-50 p-1 text-slate-300" title="Няма линк към обява"><ExternalLink className="h-3 w-3" /></span>}
    {filterUrl
      ? <a href={filterUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="rounded border border-blue-200 bg-white p-1 text-blue-600 hover:bg-blue-50" title="Точен филтър"><Filter className="h-3 w-3" /></a>
      : <span className="rounded border border-slate-100 bg-slate-50 p-1 text-slate-300" title="Няма филтър линк"><Filter className="h-3 w-3" /></span>}
  </span>;
}
