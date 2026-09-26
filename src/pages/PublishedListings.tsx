import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Filter, Image as ImageIcon,
  RefreshCw, Search, Tag, TrendingUp, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatDate, formatEUR, formatNumber, timeAgo } from '@/lib/format';

/**
 * A published listing, read from the `mobile_bg_published_listings` view.
 *
 * The view is the join of a draft, its field rows and its first selected photo,
 * so the list is one query rather than one per car, and it carries
 * `security_invoker`, which means it is scoped by the caller's company exactly
 * like the table underneath.
 */
interface PublishedListing {
  id: string;
  company_id: string;
  title: string | null;
  status: string;
  listing_state: 'AVAILABLE' | 'SOLD' | 'INACTIVE';
  make: string | null;
  model: string | null;
  model_year: number | null;
  fuel: string | null;
  mileage_km: number | null;
  gearbox: string | null;
  currency: string | null;
  location: string | null;
  main_image: string | null;
  source_type: string | null;
  source_url: string | null;
  source_listing_id: string | null;
  source_price_eur: number | null;
  calculated_price_eur: number | null;
  published_price_eur: number | null;
  calculated_price_note: string | null;
  calculated_price_source: string | null;
  price_difference_eur: number | null;
  broker_name: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  mobile_bg_listing_id: string | null;
  mobile_bg_url: string | null;
  publish_error: string | null;
  sold_at: string | null;
  sold_price_eur: number | null;
  is_published: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  encar: 'Encar',
  autotrader_ca: 'AutoTrader',
  catalog: 'Каталог',
  other: 'Друг',
};

const LISTING_STATE_LABELS: Record<string, string> = {
  AVAILABLE: 'В продажба',
  SOLD: 'Продадена',
  INACTIVE: 'Спряна',
};

const LISTING_STATE_COLORS: Record<string, string> = {
  AVAILABLE: 'emerald',
  SOLD: 'violet',
  INACTIVE: 'slate',
};

const STATUS_LABELS: Record<string, string> = {
  PUBLISHED: 'Публикувана',
  PUBLISH_QUEUED: 'Чака публикуване',
  MOBILE_API_PUBLISH_QUEUED: 'Чака публикуване',
  ERROR: 'Грешка',
  DRAFT: 'Чернова',
  READY_FOR_REVIEW: 'За преглед',
};

function sourceLabel(value: string | null): string {
  if (!value) return '—';
  return SOURCE_LABELS[value] || value;
}

function differenceClass(value: number | null): string {
  if (value === null) return 'text-slate-400';
  if (value > 0) return 'text-emerald-700';
  if (value < 0) return 'text-rose-700';
  return 'text-slate-600';
}

function differenceText(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return 'без разлика';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatEUR(value)}`;
}

export function PublishedListings() {
  const [rows, setRows] = useState<PublishedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [brokerFilter, setBrokerFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [publishedFrom, setPublishedFrom] = useState('');
  const [publishedTo, setPublishedTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Only the published ones: a draft still being prepared belongs in
    // «Публикуване», not in the archive the broker reads with a client waiting.
    const { data, error: queryError } = await supabase
      .from('mobile_bg_published_listings')
      .select('*')
      .eq('is_published', true)
      .order('published_at', { ascending: false, nullsFirst: false });

    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setRows((data || []) as PublishedListing[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const brokers = useMemo(
    () => Array.from(new Set(rows.map((row) => row.broker_name).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'bg')),
    [rows],
  );
  const sources = useMemo(
    () => Array.from(new Set(rows.map((row) => row.source_type).filter(Boolean) as string[])).sort(),
    [rows],
  );

  /**
   * The search is deliberately over everything a broker has in front of them
   * while a client is on the phone: the car, the id, the link, the broker and the
   * source. Matching any of them means the broker does not have to know which
   * field the client's detail belongs to.
   */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sourceFilter !== 'ALL' && row.source_type !== sourceFilter) return false;
      if (brokerFilter !== 'ALL' && row.broker_name !== brokerFilter) return false;
      if (stateFilter !== 'ALL' && row.listing_state !== stateFilter) return false;

      if (yearFrom && (row.model_year ?? 0) < Number(yearFrom)) return false;
      if (yearTo && (row.model_year ?? 0) > Number(yearTo)) return false;

      if (publishedFrom && (!row.published_at || row.published_at.slice(0, 10) < publishedFrom)) return false;
      if (publishedTo && (!row.published_at || row.published_at.slice(0, 10) > publishedTo)) return false;

      if (!needle) return true;
      const haystack = [
        row.make, row.model, row.model_year, row.fuel, row.gearbox, row.title,
        row.mobile_bg_listing_id, row.mobile_bg_url, row.source_listing_id,
        row.source_url, row.broker_name, row.location,
        row.published_price_eur, row.calculated_price_eur,
      ].filter(value => value !== null && value !== undefined).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, sourceFilter, brokerFilter, stateFilter, yearFrom, yearTo, publishedFrom, publishedTo]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || null,
    [rows, selectedId],
  );

  const totals = useMemo(() => {
    const withPrices = filtered.filter(row => row.published_price_eur !== null);
    const differences = filtered
      .map(row => row.price_difference_eur)
      .filter((value): value is number => value !== null);
    return {
      count: filtered.length,
      averageDifference: differences.length
        ? Math.round(differences.reduce((sum, value) => sum + value, 0) / differences.length)
        : null,
      totalPublished: withPrices.reduce((sum, row) => sum + (row.published_price_eur || 0), 0),
      sold: filtered.filter(row => row.listing_state === 'SOLD').length,
    };
  }, [filtered]);

  function clearFilters() {
    setQuery(''); setSourceFilter('ALL'); setBrokerFilter('ALL'); setStateFilter('ALL');
    setYearFrom(''); setYearTo(''); setPublishedFrom(''); setPublishedTo('');
  }

  const activeFilterCount = [sourceFilter, brokerFilter, stateFilter].filter(value => value !== 'ALL').length
    + [yearFrom, yearTo, publishedFrom, publishedTo].filter(Boolean).length;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Публикувани обяви</h2>
        <span className="text-sm font-semibold text-slate-500">{filtered.length} от {rows.length}</span>
      </div>
      <button onClick={() => void load()} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        <RefreshCw className="h-3.5 w-3.5" /> Опресни
      </button>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[240px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Търси по марка, модел, година, Mobile.bg ID, линк, брокер…"
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-9 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>}
      </div>
      <button
        onClick={() => setShowFilters((value) => !value)}
        className={`flex h-10 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold ${showFilters || activeFilterCount ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
      >
        <Filter className="h-3.5 w-3.5" /> Филтри{activeFilterCount ? ` (${activeFilterCount})` : ''}
      </button>
      {(activeFilterCount > 0 || query) && <button onClick={clearFilters} className="h-10 rounded-md px-3 text-xs font-semibold text-slate-500 hover:text-slate-800">Изчисти</button>}
    </div>

    {showFilters && <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select label="Източник" value={sourceFilter} onChange={setSourceFilter} options={sources.map(value => ({ value, label: sourceLabel(value) }))} />
      <Select label="Брокер" value={brokerFilter} onChange={setBrokerFilter} options={brokers.map(value => ({ value, label: value }))} />
      <Select label="Състояние" value={stateFilter} onChange={setStateFilter} options={Object.entries(LISTING_STATE_LABELS).map(([value, label]) => ({ value, label }))} />
      <div className="grid grid-cols-2 gap-2">
        <Text label="Година от" value={yearFrom} onChange={setYearFrom} type="number" />
        <Text label="Година до" value={yearTo} onChange={setYearTo} type="number" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Text label="Публикувана от" value={publishedFrom} onChange={setPublishedFrom} type="date" />
        <Text label="Публикувана до" value={publishedTo} onChange={setPublishedTo} type="date" />
      </div>
    </div>}

    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Показани" value={String(totals.count)} />
      <Kpi label="Продадени" value={String(totals.sold)} />
      <Kpi label="Средна разлика" value={totals.averageDifference === null ? '—' : differenceText(totals.averageDifference)} />
      <Kpi label="Сума по публикувани цени" value={formatEUR(totals.totalPublished)} />
    </div>

    {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <p className="font-semibold">Списъкът не се зареди.</p>
      <p className="mt-1">{error}</p>
    </div>}

    {loading ? <div className="flex h-40 items-center justify-center text-slate-400">Зареждане…</div>
      : !error && filtered.length === 0 ? <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {rows.length === 0 ? 'Още няма публикувани обяви.' : 'Няма обява по тези филтри.'}
        </div>
      : !error && <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => <ListingCard key={row.id} row={row} onOpen={() => setSelectedId(row.id)} />)}
        </div>}

    {selected && <ListingDetail row={selected} onClose={() => setSelectedId(null)} onChanged={load} />}
  </div>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-0.5 truncate text-lg font-extrabold text-slate-800">{value}</p>
  </div>;
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return <label className="block text-[11px] font-semibold text-slate-600">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-500">
      <option value="ALL">Всички</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

function Text({ label, value, onChange, type }: {
  label: string; value: string; onChange: (value: string) => void; type: string;
}) {
  return <label className="block text-[11px] font-semibold text-slate-600">{label}
    <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder="—" className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-500" />
  </label>;
}

function ListingCard({ row, onOpen }: { row: PublishedListing; onOpen: () => void }) {
  const car = [row.make, row.model].filter(Boolean).join(' ') || row.title || 'Без заглавие';
  return <button onClick={onOpen} className="group overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-md">
    <div className="relative h-36 bg-slate-100">
      {row.main_image
        ? <img src={row.main_image} alt={car} loading="lazy" className="h-full w-full object-cover" />
        : <div className="flex h-full items-center justify-center text-slate-300"><ImageIcon className="h-8 w-8" /></div>}
      <div className="absolute left-2 top-2 flex gap-1">
        <Badge color={LISTING_STATE_COLORS[row.listing_state] || 'slate'}>{LISTING_STATE_LABELS[row.listing_state] || row.listing_state}</Badge>
      </div>
      <div className="absolute right-2 top-2">
        <Badge color="blue">{sourceLabel(row.source_type)}</Badge>
      </div>
    </div>
    <div className="space-y-1.5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-bold text-slate-800">{car}</p>
        <span className="shrink-0 text-xs font-semibold text-slate-500">{row.model_year || '—'}</span>
      </div>
      <p className="truncate text-[11px] text-slate-500">
        {[row.fuel, row.gearbox, row.mileage_km ? `${formatNumber(row.mileage_km)} км` : null].filter(Boolean).join(' · ') || '—'}
      </p>
      <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-1.5">
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-400">Публикувана</p>
          <p className="text-sm font-extrabold text-slate-800">{formatEUR(row.published_price_eur)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase text-slate-400">Разлика</p>
          <p className={`text-xs font-bold ${differenceClass(row.price_difference_eur)}`}>{differenceText(row.price_difference_eur)}</p>
        </div>
      </div>
      <p className="flex items-center justify-between text-[10px] text-slate-400">
        <span>{row.broker_name || '—'}</span>
        <span>{row.published_at ? timeAgo(row.published_at) : '—'}</span>
      </p>
    </div>
  </button>;
}

function ListingDetail({ row, onClose, onChanged }: {
  row: PublishedListing; onClose: () => void; onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [calculated, setCalculated] = useState(row.calculated_price_eur === null ? '' : String(row.calculated_price_eur));
  const [note, setNote] = useState(row.calculated_price_note || '');

  const car = [row.make, row.model].filter(Boolean).join(' ') || row.title || 'Без заглавие';

  /**
   * The calculated price is entered by hand at this stage. It is stored in its
   * own column, so the price that came from the source and the price the advert
   * actually went out at both stay readable. A later calculator writes the same
   * column and marks the source, which is why the source is recorded here.
   */
  async function saveCalculated() {
    setSaving(true);
    setNotice('');
    setError('');
    const value = calculated.trim() === '' ? null : Number(calculated);
    if (value !== null && !Number.isFinite(value)) {
      setSaving(false);
      setError('Калкулираната цена трябва да е число.');
      return;
    }

    const { error: updateError } = await supabase
      .from('mobile_bg_drafts')
      .update({
        calculated_price_eur: value,
        calculated_price_note: note.trim() || null,
        calculated_price_source: 'MANUAL',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNotice('Калкулираната цена е запазена.');
    onChanged();
  }

  async function setListingState(next: 'AVAILABLE' | 'SOLD' | 'INACTIVE') {
    setSaving(true);
    setNotice('');
    setError('');
    const patch: Record<string, unknown> = {
      listing_state: next,
      updated_at: new Date().toISOString(),
    };
    // A car marked sold keeps the date, so the statistics can tell when it left
    // the lot. Nothing is deleted: the owner asked for the history to stay.
    if (next === 'SOLD') patch.sold_at = row.sold_at || new Date().toISOString();
    if (next === 'AVAILABLE') { patch.sold_at = null; patch.sold_price_eur = null; }

    const { error: updateError } = await supabase.from('mobile_bg_drafts').update(patch).eq('id', row.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNotice('Състоянието е обновено.');
    onChanged();
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
    <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{car}</p>
          <p className="text-[11px] text-slate-500">{card_subtitle(row)}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-4 p-4">
        <div className="h-48 overflow-hidden rounded-lg bg-slate-100">
          {row.main_image
            ? <img src={row.main_image} alt={car} className="h-full w-full object-cover" />
            : <div className="flex h-full items-center justify-center text-slate-300"><ImageIcon className="h-10 w-10" /></div>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge color={LISTING_STATE_COLORS[row.listing_state] || 'slate'}>{LISTING_STATE_LABELS[row.listing_state] || row.listing_state}</Badge>
          <Badge color="blue">{sourceLabel(row.source_type)}</Badge>
          <Badge color="slate">{STATUS_LABELS[row.status] || row.status}</Badge>
        </div>

        {row.publish_error && <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{row.publish_error}</span>
        </div>}

        <div className="grid gap-2 sm:grid-cols-2">
          <Row label="Марка" value={row.make} />
          <Row label="Модел" value={row.model} />
          <Row label="Година" value={row.model_year ? String(row.model_year) : null} />
          <Row label="Гориво" value={row.fuel} />
          <Row label="Пробег" value={row.mileage_km ? `${formatNumber(row.mileage_km)} км` : null} />
          <Row label="Скоростна кутия" value={row.gearbox} />
          <Row label="Локация" value={row.location} />
          <Row label="Брокер" value={row.broker_name} />
          <Row label="Публикувана на" value={row.published_at ? formatDate(row.published_at) : null} />
          <Row label="Създадена на" value={formatDate(row.created_at)} />
          <Row label="Mobile.bg ID" value={row.mobile_bg_listing_id} />
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Цени</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Row label="Цена от източника" value={formatEUR(row.source_price_eur)} />
            <Row label="Калкулирана / крайна" value={formatEUR(row.calculated_price_eur)} />
            <Row label="Реална публикувана" value={formatEUR(row.published_price_eur)} />
            <div>
              <p className="text-[10px] font-semibold uppercase text-slate-400">Разлика</p>
              <p className={`text-sm font-bold ${differenceClass(row.price_difference_eur)}`}>{differenceText(row.price_difference_eur)}</p>
            </div>
          </div>
          {row.calculated_price_source === 'CALCULATOR' && <p className="mt-2 flex items-center gap-1 text-[11px] text-blue-700"><TrendingUp className="h-3 w-3" /> Въведена от калкулатор</p>}
          {row.calculated_price_note && <p className="mt-2 text-[11px] text-slate-500">{row.calculated_price_note}</p>}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-slate-600">Калкулирана цена (ръчно)
              <input
                value={calculated}
                onChange={(event) => setCalculated(event.target.value)}
                inputMode="numeric"
                placeholder="—"
                className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-xs outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-[11px] font-semibold text-slate-600">Бележка
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="напр. включена доставка"
                className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-xs outline-none focus:border-blue-500"
              />
            </label>
          </div>
          <button
            onClick={() => void saveCalculated()}
            disabled={saving}
            className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Запази калкулираната цена
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {row.source_url && <a href={row.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <ExternalLink className="h-3.5 w-3.5" /> Оригинална обява
          </a>}
          {row.mobile_bg_url && <a href={row.mobile_bg_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <ExternalLink className="h-3.5 w-3.5" /> Mobile.bg обява
          </a>}
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Състояние на обявата</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void setListingState('AVAILABLE')} disabled={saving || row.listing_state === 'AVAILABLE'} className="flex items-center gap-1.5 rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
              <CheckCircle2 className="h-3.5 w-3.5" /> В продажба
            </button>
            <button onClick={() => void setListingState('SOLD')} disabled={saving || row.listing_state === 'SOLD'} className="flex items-center gap-1.5 rounded-md border border-violet-300 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50">
              <Tag className="h-3.5 w-3.5" /> Продадена
            </button>
            <button onClick={() => void setListingState('INACTIVE')} disabled={saving || row.listing_state === 'INACTIVE'} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Спряна
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">Нищо не се изтрива — обявата остава в статистиката.</p>
        </div>

        {notice && <p className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">{notice}</p>}
        {error && <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800">{error}</p>}
      </div>
    </div>
  </div>;
}

function card_subtitle(row: PublishedListing): string {
  return [row.model_year, row.fuel, sourceLabel(row.source_type)].filter(Boolean).join(' · ');
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return <div>
    <p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p>
    <p className="truncate text-xs font-medium text-slate-700">{value || '—'}</p>
  </div>;
}
