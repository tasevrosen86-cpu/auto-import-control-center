import { useCallback, useEffect, useState } from 'react';
import { Rocket, Play, FlaskConical, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatDateTime } from '@/lib/format';

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

  useEffect(() => { void load(); }, [load]);

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
      <a href="https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1" target="_blank" rel="noreferrer"
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