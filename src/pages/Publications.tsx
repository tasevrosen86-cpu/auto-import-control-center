import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Image, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';

type ImportJob = { id: string; source_url: string; source_type: string; status: 'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'; error_message: string | null; created_at: string };
type Field = { key: string; value: string; source?: string };
type Draft = { id: string; import_job_id: string; title: string | null; source_url: string; source_type: string; fields: Field[]; images: Array<{ source_url: string }>; price_eur: number | null; preparation_status: 'EXTRACTED'|'READY'|'FAILED'; created_at: string };

const labels: Record<string,string> = { make:'Марка', model:'Модел', title:'Заглавие', year:'Година', mileage:'Пробег', fuel:'Гориво', gearbox:'Скоростна кутия', color:'Цвят', modification:'Модификация', condition:'Състояние', location:'Местоположение', final_description:'Описание' };
const required = ['make','model','year','mileage','fuel','gearbox'];

export function Publications() {
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [jobResult, draftResult] = await Promise.all([
      supabase.from('publication_import_jobs').select('id,source_url,source_type,status,error_message,created_at').order('created_at',{ascending:false}).limit(25),
      supabase.from('publication_url_drafts').select('id,import_job_id,title,source_url,source_type,fields,images,price_eur,preparation_status,created_at').order('created_at',{ascending:false}).limit(25),
    ]);
    if (jobResult.error || draftResult.error) setError('Неуспешно зареждане: ' + (jobResult.error?.message || draftResult.error?.message));
    else { setJobs((jobResult.data || []) as ImportJob[]); const next = (draftResult.data || []) as Draft[]; setDrafts(next); setSelectedId(id => id || next[0]?.id || ''); }
  }, []);

  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 8000); return () => window.clearInterval(t); }, [load]);
  const draft = drafts.find(item => item.id === selectedId);
  const fields = draft?.fields || [];
  const get = (key: string) => fields.find(field => field.key === key)?.value?.trim() || '';
  const missing = required.filter(key => !get(key));
  const canPrepare = Boolean(draft && price && !missing.length && draft.images.length);

  async function importUrl() {
    if (!url.trim()) { setError('Поставете линк към AutoTrader или Encar.'); return; }
    setBusy(true); setError(''); setNotice('');
    const { data, error: invokeError } = await supabase.functions.invoke('queue-publication-url', { body: { source_url: url.trim() } });
    setBusy(false);
    if (invokeError || data?.error) {
      let detail = data?.error as string | undefined;
      if (!detail && invokeError && 'context' in invokeError) {
        try { detail = (await (invokeError as { context: Response }).context.json()).error; } catch { /* generic transport error */ }
      }
      setError(detail || invokeError?.message || 'Неуспешно добавяне към опашката.'); return;
    }
    setNotice(data?.was_created ? 'Линкът е добавен. Извличането на полета и снимки започна.' : 'Този линк вече е в собствената опашка на „Публикации“.');
    setUrl(''); void load();
  }

  async function prepare() {
    if (!draft) return;
    setBusy(true); setError(''); setNotice('');
    const priceEur = Number(price.replace(',', '.'));
    const { data, error: invokeError } = await supabase.functions.invoke('prepare-publication-draft', { body: { draft_id: draft.id, price_eur: priceEur } });
    setBusy(false);
    if (invokeError || data?.error) {
      let detail = data?.error as string | undefined;
      if (!detail && invokeError && 'context' in invokeError) {
        try { detail = (await (invokeError as { context: Response }).context.json()).error; } catch { /* generic transport error */ }
      }
      setError(detail || invokeError?.message || 'Подготовката не успя.'); return;
    }
    setNotice('Черновата е готова: полетата, снимките и ръчната EUR цена са запазени само в „Публикации“.'); void load();
  }

  const status = (s: string) => s === 'COMPLETED' ? 'Готово' : s === 'RUNNING' ? 'Извличане' : s === 'FAILED' ? 'Грешка' : 'На опашка';
  return <div className="space-y-4">
    <header className="flex items-end justify-between gap-3"><div><h1 className="text-lg font-extrabold text-slate-800">Публикации</h1><p className="mt-1 text-xs text-slate-500">Самостоятелен URL importer. Тук няма Каталог и не се виждат черновите от „Обяви“.</p></div>
      <button onClick={() => void load()} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"><RefreshCw className="h-3.5 w-3.5"/>Опресни</button></header>
    {notice && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
    {error && <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertTriangle className="h-4 w-4 shrink-0"/>{error}</div>}
    <section className="rounded-lg border border-slate-200 bg-white"><header className="border-b border-slate-100 px-3 py-3"><h2 className="text-sm font-bold text-slate-700">1. Импортирай нов URL</h2><p className="mt-1 text-[11px] text-slate-500">Поставете директен линк към обява в AutoTrader Canada или Encar. Създава се нова чернова само за „Публикации“.</p></header>
      <div className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.autotrader.ca/offers/... или encar.com/..." className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"/>
      <button disabled={busy} onClick={()=>void importUrl()} className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin"/>}Извлечи данни и снимки</button></div>
      {jobs.length>0 && <div className="border-t border-slate-100 p-3"><div className="mb-2 text-xs font-bold text-slate-700">Собствена опашка</div>{jobs.slice(0,5).map(job=><div key={job.id} className="flex items-center justify-between gap-2 border-t border-slate-50 py-2 text-[11px]"><a className="truncate text-blue-700 hover:underline" href={job.source_url} target="_blank" rel="noreferrer">{job.source_url}</a><span className="shrink-0 font-semibold text-slate-600">{status(job.status)}</span>{job.error_message && <span className="text-rose-700">{job.error_message}</span>}</div>)}</div>}
    </section>
    <section className="rounded-lg border border-slate-200 bg-white"><header className="border-b border-slate-100 px-3 py-3"><h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><FileText className="h-4 w-4"/>2. Провери извлечената чернова</h2><p className="mt-1 text-[11px] text-slate-500">Показват се единствено чернови, създадени от горния URL importer.</p></header>
      {drafts.length===0 ? <p className="p-5 text-center text-xs text-slate-400">Още няма извлечена чернова.</p> : <><div className="p-3"><select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setPrice('')}} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><>{drafts.map(item=><option key={item.id} value={item.id}>{item.title || item.source_url} · {formatDateTime(item.created_at)}</option>)}</></select></div>
        {draft && <div className="border-t border-slate-100 p-3"><div className="mb-3 flex items-center justify-between gap-2"><a href={draft.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5"/>Източник</a><span className="flex items-center gap-1 text-xs text-slate-600"><Image className="h-4 w-4"/>{draft.images.length} снимки</span></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(labels).map(([key,label])=>get(key)&&<div key={key} className="rounded-md bg-slate-50 px-2.5 py-2"><div className="text-[10px] uppercase text-slate-400">{label}</div><div className="mt-0.5 text-xs font-semibold text-slate-700">{get(key)}</div></div>)}</div>
          {missing.length>0 && <p className="mt-3 text-xs text-amber-700">Липсват задължителни полета: {missing.map(x=>labels[x]).join(', ')}.</p>}
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><label><span className="mb-1 block text-xs font-bold text-slate-700">Цена за Mobile.bg (EUR) *</span><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder={draft.price_eur ? String(draft.price_eur) : 'Брокерът въвежда цена'} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"/></label><button disabled={busy||!canPrepare} onClick={()=>void prepare()} className="mt-5 h-10 rounded-md bg-slate-800 px-4 text-xs font-bold text-white disabled:opacity-50">Подготви чернова</button></div>
          {draft.preparation_status==='READY' && <div className="mt-3 flex gap-2 rounded-md bg-emerald-50 p-2 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4"/>Готова за следващата стъпка „Публикувай“: {draft.price_eur} EUR, {draft.images.length} снимки.</div>}
        </div>}</>}
    </section>
  </div>;
}