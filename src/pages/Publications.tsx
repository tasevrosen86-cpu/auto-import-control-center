import { useCallback, useEffect, useState } from 'react';
import { Rocket, Play, FlaskConical, ExternalLink, RefreshCw, AlertTriangle, ClipboardCopy, Check, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';
import { buildSheet, missingInSheet, sheetAsText, type SheetRow } from '@/lib/publication_sheet';
import type { MobileBgDraftField } from '@/types';

const FORM_URL = 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';

type DraftOption = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
};

type PublicationJob = {
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
  finished_at: string | null;
};

const STATUS_LABELS: Record<PublicationJob['status'], string> = {
  QUEUED: 'На опашка',
  RUNNING: 'Изпълнява се',
  COMPLETED: 'Готово',
  FAILED: 'Грешка',
  BLOCKED: 'Спряно',
};

const STATUS_COLORS: Record<PublicationJob['status'], string> = {
  QUEUED: 'bg-slate-100 text-slate-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
  BLOCKED: 'bg-amber-100 text-amber-800',
};

const ACTION_LABELS: Record<PublicationJob['action'], string> = {
  browser_test: 'Тест на браузър',
  prepare: 'Подготовка',
  publish: 'Публикуване',
};

// The section is deliberately simple: one list, four buttons. The real publish
// is not enabled yet, so «Публикувай» queues nothing until that is switched on.
const REAL_PUBLISH_ENABLED = import.meta.env.VITE_PUBLICATIONS_REAL_PUBLISH === 'true';

export function Publications() {
  const [jobs, setJobs] = useState<PublicationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [sheet, setSheet] = useState<SheetRow[]>([]);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('publication_jobs')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(50);
    if (loadError) setError(`Списъкът не се зареди: ${loadError.message}`);
    else { setError(null); setJobs((data || []) as PublicationJob[]); }
    setLoading(false);
  }, []);

  const loadDrafts = useCallback(async () => {
    const { data } = await supabase
      .from('mobile_bg_drafts')
      .select('id,title,status,created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    const options = (data || []) as DraftOption[];
    setDrafts(options);
    setSelectedId(current => current || options[0]?.id || '');
  }, []);

  // The sheet is read from the draft that already exists. Nothing is created
  // here and nothing is written back: this screen only shows what the draft
  // holds, so the broker can carry it into the Mobile.bg form.
  const loadSheet = useCallback(async (draftId: string) => {
    if (!draftId) { setSheet([]); return; }
    setSheetBusy(true);
    const { data, error: sheetError } = await supabase
      .from('mobile_bg_draft_fields')
      .select('*')
      .eq('draft_id', draftId);
    setSheetBusy(false);
    if (sheetError) { setError(`Полетата не се заредиха: ${sheetError.message}`); setSheet([]); return; }
    setSheet(buildSheet((data || []) as MobileBgDraftField[]));
  }, []);

  useEffect(() => { void load(); void loadDrafts(); }, [load, loadDrafts]);

  useEffect(() => { if (selectedId) void loadSheet(selectedId); }, [selectedId, loadSheet]);

  useEffect(() => {
    const timer = setInterval(() => { void load(); }, 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function queue(action: PublicationJob['action'], label: string) {
    setBusy(true); setNotice(null);
    const { error: insertError } = await supabase.from('publication_jobs').insert({
      action,
      source_label: label,
      requested_by: 'Публикации',
    });
    setBusy(false);
    if (insertError) { setError(`Задачата не беше създадена: ${insertError.message}`); return; }
    setNotice(`Задачата „${ACTION_LABELS[action]}“ е на опашка. Работникът ще я поеме при следващия цикъл.`);
    void load();
  }

  const selectedDraft = drafts.find(draft => draft.id === selectedId);
  // The draft row carries only a title; make and model live in the field rows,
  // so the heading is read from the sheet rather than from the draft.
  const title = selectedDraft?.title
    || [sheet.find(row => row.key === 'make')?.value, sheet.find(row => row.key === 'model')?.value]
      .filter(Boolean).join(' ')
    || 'Чернова';
  const missing = missingInSheet(sheet);

  // The clipboard, not a URL parameter. Browsers refuse to pre-fill a form on
  // another site, and injecting into it would be blocked anyway, so the sheet
  // is handed over as text the broker pastes into the open Mobile.bg form.
  async function copySheet() {
    const text = sheetAsText(sheet, title);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setNotice(`Листът за „${title}“ е копиран. Отвори формата на Mobile.bg и го постави.`);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Копирането не беше разрешено от браузъра. Отвори листа и го копирай ръчно.');
    }
  }

  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-extrabold text-slate-800">Публикации</h1>
        <p className="mt-1 text-xs text-slate-500">
          Нов двигател за публикуване, отделен от секция „Обяви“. Работи през Browser Use сесия, а не през headless браузър.
        </p>
      </div>
      <button onClick={() => void load()} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
        <RefreshCw className="h-3.5 w-3.5" /> Опресни
      </button>
    </header>

    <section className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => void queue('browser_test', 'Тест на браузър')}
        className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
        <FlaskConical className="h-3.5 w-3.5" /> Тествай браузър
      </button>
      <a href={FORM_URL} target="_blank" rel="noreferrer"
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
        <ExternalLink className="h-3.5 w-3.5" /> Отвори Mobile.bg
      </a>
      <button disabled={busy} onClick={() => void queue('prepare', 'Подготовка на публикация')}
        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        <Play className="h-3.5 w-3.5" /> Подготви публикация
      </button>
      <button disabled={busy || !REAL_PUBLISH_ENABLED} onClick={() => void queue('publish', 'Реално публикуване')}
        title={REAL_PUBLISH_ENABLED ? undefined : 'Реалното публикуване още не е включено.'}
        className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
        <Rocket className="h-3.5 w-3.5" /> Публикувай
      </button>
      {!REAL_PUBLISH_ENABLED && <span className="self-center text-[11px] text-slate-500">Реалното публикуване е изключено до отделно разрешение.</span>}
    </section>

    {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
    {error && <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</div>}

    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <FileText className="h-3.5 w-3.5" /> Подготвен лист за попълване
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Данните идват от вече готова чернова. Копирай ги, отвори формата на Mobile.bg и ги постави там.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={selectedId} onChange={event => setSelectedId(event.target.value)}
            className="h-8 max-w-[280px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400">
            {drafts.length === 0 && <option value="">Няма чернови</option>}
            {drafts.map(draft => (
              <option key={draft.id} value={draft.id}>
                {draft.title || draft.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <button onClick={() => void loadSheet(selectedId)} disabled={!selectedId || sheetBusy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" /> Презареди
          </button>
          <button onClick={() => void copySheet()} disabled={!sheet.length}
            className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? 'Копирано' : 'Копирай листа'}
          </button>
          <a href={FORM_URL} target="_blank" rel="noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-md bg-slate-800 px-2.5 text-xs font-semibold text-white hover:bg-slate-700">
            <ExternalLink className="h-3.5 w-3.5" /> Отвори формата
          </a>
        </div>
      </header>

      {sheetBusy && <p className="px-3 py-6 text-center text-xs text-slate-400">Зареждане на полетата…</p>}
      {!sheetBusy && sheet.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-slate-400">
          Избери чернова. Ако списъкът е празен, първо създай чернова в секция „Обяви“.
        </p>
      )}
      {!sheetBusy && sheet.length > 0 && (
        <>
          {missing.length > 0 && (
            <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Още {missing.length} задължителни полета са празни: {missing.map(row => row.label).join(', ')}.
                Попълни ги в „Обяви“, преди да публикуваш.
              </span>
            </div>
          )}
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Поле в Mobile.bg</th>
                <th className="px-3 py-2 font-semibold">Стойност</th>
                <th className="px-3 py-2 font-semibold">Кой решава</th>
              </tr>
            </thead>
            <tbody>
              {sheet.map(row => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-600">
                    {row.label}
                    {row.required && <span className="ml-1 text-rose-500">*</span>}
                  </td>
                  <td className={`px-3 py-1.5 ${row.value ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
                    {row.value || 'празно'}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.human
                      ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">брокер</span>
                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">извлечено</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>

    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Източник / автомобил</th>
            <th className="px-3 py-2 font-semibold">Марка</th>
            <th className="px-3 py-2 font-semibold">Модел</th>
            <th className="px-3 py-2 font-semibold">Година</th>
            <th className="px-3 py-2 font-semibold">Цена</th>
            <th className="px-3 py-2 font-semibold">Снимки</th>
            <th className="px-3 py-2 font-semibold">Статус</th>
            <th className="px-3 py-2 font-semibold">Последна грешка</th>
            <th className="px-3 py-2 font-semibold">Публичен адрес</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Зареждане…</td></tr>}
          {!loading && jobs.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Още няма задачи. Започни с „Тествай браузър“.</td></tr>}
          {jobs.map((job) => <tr key={job.id} className="border-t border-slate-100">
            <td className="px-3 py-2">
              <div className="font-semibold text-slate-700">{job.source_label || ACTION_LABELS[job.action]}</div>
              <div className="text-[10px] text-slate-400">{formatDateTime(job.requested_at)}</div>
            </td>
            <td className="px-3 py-2 text-slate-600">{job.make || '—'}</td>
            <td className="px-3 py-2 text-slate-600">{job.model || '—'}</td>
            <td className="px-3 py-2 text-slate-600">{job.year || '—'}</td>
            <td className="px-3 py-2 text-slate-600">{job.price_eur ? `${job.price_eur} €` : '—'}</td>
            <td className="px-3 py-2 text-slate-600">{job.image_count || 0}</td>
            <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_COLORS[job.status]}`}>{STATUS_LABELS[job.status]}</span></td>
            <td className="max-w-[260px] px-3 py-2 text-slate-500">{job.last_error ? <span className="line-clamp-2" title={job.last_error}>{job.last_error}</span> : '—'}</td>
            <td className="px-3 py-2">
              {job.public_url
                ? <a href={job.public_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Отвори</a>
                : '—'}
            </td>
          </tr>)}
        </tbody>
      </table>
    </section>

    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="text-xs font-bold text-slate-700">Как работи този поток</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Всеки бутон създава задача в <code className="rounded bg-slate-100 px-1">publication_jobs</code>. Сървърът я поема през{' '}
        <code className="rounded bg-slate-100 px-1">claim_publication_job</code> и я изпълнява в Browser Use сесия, която не среща проверката на Cloudflare.
        Тези таблици и този код са отделни от секция „Обяви“ — старият поток не се пипа и остава за връщане назад.
      </p>
    </section>
  </div>;
}