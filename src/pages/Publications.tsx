import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Image, Play, RefreshCw, Rocket } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';

const FORM_URL = 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';
const REAL_PUBLISH_ENABLED = import.meta.env.VITE_PUBLICATIONS_REAL_PUBLISH === 'true';

type Draft = {
  id: string;
  title: string | null;
  source_url: string;
  source_type: string | null;
  extraction_status: string | null;
  created_at: string;
};

type Field = { field_key: string; value: string | null; source: string | null };
type Job = {
  id: string;
  action: 'browser_test' | 'prepare' | 'publish';
  source_label: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price_eur: number | null;
  image_count: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  last_error: string | null;
  public_url: string | null;
  requested_at: string;
};

const statusLabel: Record<Job['status'], string> = {
  QUEUED: 'На опашка', RUNNING: 'Изпълнява се', COMPLETED: 'Готово', FAILED: 'Грешка', BLOCKED: 'Спряно',
};
const statusColor: Record<Job['status'], string> = {
  QUEUED: 'bg-slate-100 text-slate-700', RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700', FAILED: 'bg-rose-100 text-rose-700',
  BLOCKED: 'bg-amber-100 text-amber-800',
};

const keyLabel: Record<string, string> = {
  title: 'Заглавие', category: 'Категория', make: 'Марка', model: 'Модел',
  modification: 'Модификация', year: 'Година', month: 'Месец', mileage: 'Пробег',
  fuel: 'Гориво', gearbox: 'Скоростна кутия', transmission: 'Скоростна кутия',
  body: 'Купе', color: 'Цвят', condition: 'Състояние', vin: 'VIN',
  location: 'Населено място/област', price: 'Цена', currency: 'Валута',
  phone: 'Телефон', final_description: 'Описание',
};

function value(fields: Field[], ...keys: string[]) {
  return keys.map(key => fields.find(field => field.field_key === key)?.value?.trim() || '').find(Boolean) || '';
}

export function Publications() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [fields, setFields] = useState<Field[]>([]);
  const [imageCount, setImageCount] = useState(0);
  const [price, setPrice] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('mobile_bg_drafts')
      .select('id,title,source_url,source_type,extraction_status,created_at')
      .is('catalog_permanent_id', null)
      .not('source_url', 'is', null)
      .eq('extraction_status', 'COMPLETED_NEEDS_REVIEW')
      .order('created_at', { ascending: false })
      .limit(50);
    if (loadError) { setError(`Черновите не се заредиха: ${loadError.message}`); return; }
    const ready = (data || []) as Draft[];
    setDrafts(ready);
    setSelectedId(current => current || ready[0]?.id || '');
  }, []);

  const loadJobs = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('publication_jobs').select('*').order('requested_at', { ascending: false }).limit(50);
    if (loadError) { setError(`Опашката не се зареди: ${loadError.message}`); }
    else setJobs((data || []) as Job[]);
    setLoading(false);
  }, []);

  const loadDraftData = useCallback(async (draftId: string) => {
    if (!draftId) { setFields([]); setImageCount(0); return; }
    const [{ data: fieldData, error: fieldError }, { count, error: imageError }] = await Promise.all([
      supabase.from('mobile_bg_draft_fields').select('field_key,value,source').eq('draft_id', draftId),
      supabase.from('mobile_bg_draft_images').select('*', { count: 'exact', head: true }).eq('draft_id', draftId).eq('is_selected', true),
    ]);
    if (fieldError || imageError) {
      setError(`Данните на черновата не се заредиха: ${fieldError?.message || imageError?.message}`);
      return;
    }
    setFields((fieldData || []) as Field[]);
    setImageCount(count || 0);
    setPrice('');
  }, []);

  useEffect(() => { void Promise.all([loadDrafts(), loadJobs()]); }, [loadDrafts, loadJobs]);
  useEffect(() => { void loadDraftData(selectedId); }, [selectedId, loadDraftData]);
  useEffect(() => {
    const interval = setInterval(() => void loadJobs(), 10000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const selected = drafts.find(draft => draft.id === selectedId);
  const summary = useMemo(() => ({
    title: selected?.title || value(fields, 'title') || `${value(fields, 'make')} ${value(fields, 'model')}`.trim(),
    make: value(fields, 'make'),
    model: value(fields, 'model'),
    year: value(fields, 'year'),
    mileage: value(fields, 'mileage'),
    fuel: value(fields, 'fuel'),
    gearbox: value(fields, 'gearbox', 'transmission'),
    color: value(fields, 'color'),
  }), [fields, selected]);

  const missing = [
    ['Марка', summary.make], ['Модел', summary.model], ['Година', summary.year],
    ['Пробег', summary.mileage], ['Гориво', summary.fuel], ['Скоростна кутия', summary.gearbox],
    ['Цена', price], ['Снимки', imageCount ? String(imageCount) : ''],
  ].filter(([, fieldValue]) => !fieldValue).map(([label]) => label);

  async function queue(action: 'prepare' | 'publish') {
    if (!selected) return;
    if (missing.length > 0) {
      setError(`Не може да се подготви: липсват ${missing.join(', ')}.`);
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    const numericPrice = Number(price.replace(',', '.'));
    const { error: insertError } = await supabase.from('publication_jobs').insert({
      action,
      source_label: summary.title || 'URL чернова',
      make: summary.make || null,
      model: summary.model || null,
      year: Number(summary.year) || null,
      price_eur: numericPrice,
      image_count: imageCount,
      requested_by: 'Публикации',
      payload: { draft_id: selected.id, price_eur: numericPrice },
    });
    setBusy(false);
    if (insertError) { setError(`Задачата не беше създадена: ${insertError.message}`); return; }
    setNotice(action === 'prepare'
      ? 'Черновата е изпратена за независима проверка и подготовка.'
      : 'Задачата за реално публикуване е изпратена.');
    void loadJobs();
  }

  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-extrabold text-slate-800">Публикации</h1>
        <p className="mt-1 text-xs text-slate-500">
          Самостоятелен publisher: взема само завършена URL-чернова и не използва Каталог.
        </p>
      </div>
      <button onClick={() => void Promise.all([loadDrafts(), loadJobs()])}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
        <RefreshCw className="h-3.5 w-3.5" /> Опресни
      </button>
    </header>

    {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
    {error && <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}

    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-3 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><FileText className="h-4 w-4" /> 1. Избери готова URL-чернова</h2>
        <p className="mt-1 text-[11px] text-slate-500">Показват се само чернови от директен линк, извлечени с готови полета и снимки. „Обяви“ не се редактира оттук.</p>
      </header>
      <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto]">
        <select value={selectedId} onChange={event => setSelectedId(event.target.value)}
          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400">
          {drafts.length === 0 && <option value="">Няма готови URL-чернови</option>}
          {drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.title || draft.id.slice(0, 8)}</option>)}
        </select>
        {selected?.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer"
          className="flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          <ExternalLink className="h-3.5 w-3.5" /> Източник
        </a>}
      </div>

      {selected && <div className="border-t border-slate-100 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[['Марка', summary.make], ['Модел', summary.model], ['Година', summary.year], ['Пробег', summary.mileage],
            ['Гориво', summary.fuel], ['Скоростна кутия', summary.gearbox], ['Цвят', summary.color],
            ['Снимки', imageCount ? `${imageCount} избрани` : 'няма']].map(([label, fieldValue]) =>
            <div key={label} className="rounded-md bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase text-slate-400">{label}</div>
              <div className={`mt-0.5 text-xs font-semibold ${fieldValue ? 'text-slate-700' : 'text-rose-600'}`}>{fieldValue || 'липсва'}</div>
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-700">Цена за публикуване (EUR) *</span>
            <input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)}
              placeholder="Брокерът въвежда цена" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" />
          </label>
          <div className="flex items-end gap-2">
            <button disabled={busy || missing.length > 0} onClick={() => void queue('prepare')}
              className="flex h-10 items-center gap-1.5 rounded-md bg-slate-800 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
              <Play className="h-3.5 w-3.5" /> Подготви
            </button>
            <button disabled={busy || missing.length > 0 || !REAL_PUBLISH_ENABLED} onClick={() => void queue('publish')}
              title={REAL_PUBLISH_ENABLED ? undefined : 'Реалното публикуване още е изключено.'}
              className="flex h-10 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
              <Rocket className="h-3.5 w-3.5" /> Публикувай
            </button>
          </div>
        </div>
        {missing.length > 0 && <p className="mt-2 text-[11px] text-amber-700">За подготовка липсват: {missing.join(', ')}.</p>}
      </div>}
    </section>

    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-3 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><Image className="h-4 w-4" /> 2. Самостоятелна опашка и резултат</h2>
        <p className="mt-1 text-[11px] text-slate-500">Преди „Публикувай“ има отделна подготовка. Успех означава единствено проверен публичен адрес.</p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Автомобил</th><th className="px-3 py-2">Действие</th><th className="px-3 py-2">Цена</th><th className="px-3 py-2">Снимки</th><th className="px-3 py-2">Статус</th><th className="px-3 py-2">Резултат / грешка</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Зареждане…</td></tr>}
            {!loading && jobs.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Още няма задачи.</td></tr>}
            {jobs.map(job => <tr key={job.id} className="border-t border-slate-100">
              <td className="px-3 py-2"><div className="font-semibold text-slate-700">{job.source_label || 'URL чернова'}</div><div className="text-[10px] text-slate-400">{formatDateTime(job.requested_at)}</div></td>
              <td className="px-3 py-2 text-slate-600">{job.action === 'prepare' ? 'Подготовка' : job.action === 'publish' ? 'Публикуване' : 'Тест'}</td>
              <td className="px-3 py-2 text-slate-600">{job.price_eur ? `${job.price_eur} EUR` : '—'}</td>
              <td className="px-3 py-2 text-slate-600">{job.image_count || 0}</td>
              <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusColor[job.status]}`}>{statusLabel[job.status]}</span></td>
              <td className="max-w-[320px] px-3 py-2 text-slate-500">{job.public_url ? <a href={job.public_url} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">Публична обява</a> : job.last_error || '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-900">
      <div className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" /><p><strong>Граница между секциите:</strong> „Обяви“ подготвя и пази своите чернови. „Публикации“ само взема завършена URL-чернова като вход, създава собствена неизменна задача и не записва обратно в „Обяви“.</p></div>
    </section>
  </div>;
}
