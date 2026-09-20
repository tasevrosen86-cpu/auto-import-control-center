import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Image, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';

type Job = { id:string; draft_id:string; source_url:string; status:'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'; error_message:string|null; created_at:string };
type Field = { draft_id:string; field_key:string; value:string|null; source:string|null };
type DraftRow = { id:string; title:string|null; source_url:string|null; price_eur:number|null; status:string; extraction_status:string; extraction_error:string|null; created_at:string };
type Draft = DraftRow & { fields:Field[]; images:Array<{id:string;is_selected:boolean}> };\ntype PublishJob={id:string;draft_id:string;status:string;error_message:string|null;public_url:string|null;created_at:string};
const labels:Record<string,string>={category:'Категория',make:'Марка',model:'Модел',title:'Заглавие',modification:'Модификация',year:'Година',month:'Месец',mileage:'Пробег',fuel:'Гориво',gearbox:'Скоростна кутия',power:'Мощност',displacement:'Кубатура',color:'Цвят',condition:'Състояние',drivetrain:'Задвижване',vin:'VIN',location:'Местоположение',seller_name:'Продавач',phone:'Телефон',final_description:'Описание'};
const required=['make','model','year','mileage','fuel','gearbox'];

export function Publications(){
  const [url,setUrl]=useState('');
  const [jobs,setJobs]=useState<Job[]>([]);
  const [drafts,setDrafts]=useState<Draft[]>([]);\n  const [publishJobs,setPublishJobs]=useState<PublishJob[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [price,setPrice]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');

  const load=useCallback(async()=>{
    const [jobsResult,draftsResult,fieldsResult,imagesResult,publishResult]=await Promise.all([
      supabase.from('publication_source_jobs').select('id,draft_id,source_url,status,error_message,created_at').order('created_at',{ascending:false}).limit(25),
      supabase.from('publication_drafts').select('id,title,source_url,price_eur,status,extraction_status,extraction_error,created_at').order('created_at',{ascending:false}).limit(25),
      supabase.from('publication_draft_fields').select('draft_id,field_key,value,source'),
      supabase.from('publication_draft_images').select('id,draft_id,is_selected'),\n      supabase.from('publication_publish_jobs').select('id,draft_id,status,error_message,public_url,created_at').order('created_at',{ascending:false}).limit(25),
    ]);
    const failed=[jobsResult.error,draftsResult.error,fieldsResult.error,imagesResult.error,publishResult.error].find(Boolean);
    if(failed){setError('Неуспешно зареждане: '+failed!.message);return;}
    const byDraft=new Map<string,Field[]>();
    for(const field of (fieldsResult.data||[]) as Field[]) byDraft.set(field.draft_id,[...(byDraft.get(field.draft_id)||[]),field]);
    const imagesByDraft=new Map<string,Array<{id:string;is_selected:boolean}>>();
    for(const image of (imagesResult.data||[]) as Array<{id:string;draft_id:string;is_selected:boolean}>) imagesByDraft.set(image.draft_id,[...(imagesByDraft.get(image.draft_id)||[]),{id:image.id,is_selected:image.is_selected}]);
    const next=((draftsResult.data||[]) as DraftRow[]).map(row=>({...row,fields:byDraft.get(row.id)||[],images:imagesByDraft.get(row.id)||[]}));
    setJobs((jobsResult.data||[]) as Job[]);
    setDrafts(next);\n    setPublishJobs((publishResult.data||[]) as PublishJob[]);
    setSelectedId(current=>current||next[0]?.id||'');
  },[]);

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),8000);return()=>window.clearInterval(timer);},[load]);
  const draft=drafts.find(item=>item.id===selectedId);
  const field=(key:string)=>draft?.fields.find(item=>item.field_key===key)?.value?.trim()||'';
  const missing=required.filter(key=>!field(key));
  const selectedImages=draft?.images.filter(image=>image.is_selected).length||0;
  const canPrepare=Boolean(draft&&price&&!missing.length&&selectedImages);

  async function importUrl(){
    if(!url.trim()){setError('Поставете линк към AutoTrader или Encar.');return;}
    setBusy(true);setError('');setNotice('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setBusy(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const {data,error:invokeError}=await supabase.functions.invoke('queue-publication-url',{body:{source_url:url.trim()},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setBusy(false);
    if(invokeError||data?.error){let detail=data?.error as string|undefined;if(!detail&&invokeError&&'context'in invokeError){try{detail=(await(invokeError as {context:Response}).context.json()).error;}catch{}}setError(detail||invokeError?.message||'Неуспешно добавяне към опашката.');return;}
    setNotice(data?.retried?'Неуспешната задача е пусната повторно.':data?.was_created?'Създадена е нова независима чернова и започна извличането.':'Този линк вече има собствена чернова в „Публикации“.');
    setUrl('');void load();
  }

  async function prepare(){
    if(!draft)return;
    setBusy(true);setError('');setNotice('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setBusy(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const {data,error:invokeError}=await supabase.functions.invoke('prepare-publication-draft',{body:{draft_id:draft.id,price_eur:Number(price.replace(',','.'))},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setBusy(false);
    if(invokeError||data?.error){let detail=data?.error as string|undefined;if(!detail&&invokeError&&'context'in invokeError){try{detail=(await(invokeError as {context:Response}).context.json()).error;}catch{}}setError(detail||invokeError?.message||'Подготовката не успя.');return;}
    setNotice('Готовата чернова е запазена в „Публикации“ с полета, снимки и ръчна EUR цена.');void load();
  }
  async function queuePublish(){
    if(!draft)return;
    setBusy(true);setError('');setNotice('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setBusy(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const {data,error:invokeError}=await supabase.functions.invoke('queue-publication-publish',{body:{draft_id:draft.id},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setBusy(false);
    if(invokeError||data?.error){let detail=data?.error as string|undefined;if(!detail&&invokeError&&'context'in invokeError){try{detail=(await(invokeError as {context:Response}).context.json()).error;}catch{}}setError(detail||invokeError?.message||'Заявката за публикуване не успя.');return;}
    setNotice(data?.already_queued?'Черновата вече е в собствената опашка за публикуване.':'Заявката е добавена. Първо ще се провери браузърната сесия и формата.');void load();
  }
  const currentPublish=publishJobs.find(item=>item.draft_id===draft?.id);
  const status=(value:string)=>value==='COMPLETED'?'Готово':value==='RUNNING'?'Извличане':value==='FAILED'?'Грешка':value==='WAITING_SESSION'?'Нужен вход':value==='WAITING_CONFIRMATION'?'Чака потвърждение':'На опашка';

  return <div className="space-y-4">
    <header className="flex items-end justify-between gap-3"><div><h1 className="text-lg font-extrabold text-slate-800">Публикации</h1><p className="mt-1 text-xs text-slate-500">Самостоятелен URL importer. Създава пълни чернови по същия механизъм като „Обяви“, но в отделна база.</p></div><button onClick={()=>void load()} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"><RefreshCw className="h-3.5 w-3.5"/>Опресни</button></header>
    {notice&&<div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
    {error&&<div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertTriangle className="h-4 w-4 shrink-0"/>{error}</div>}
    <section className="rounded-lg border border-slate-200 bg-white"><header className="border-b border-slate-100 px-3 py-3"><h2 className="text-sm font-bold text-slate-700">1. Импортирай нов URL</h2><p className="mt-1 text-[11px] text-slate-500">Поставете директен линк към AutoTrader Canada или Encar. Създава се нова чернова само за „Публикации“.</p></header><div className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.autotrader.ca/offers/... или encar.com/..." className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"/><button disabled={busy} onClick={()=>void importUrl()} className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy&&<Loader2 className="h-3.5 w-3.5 animate-spin"/>}Извлечи данни и снимки</button></div>
      {jobs.length>0&&<div className="border-t border-slate-100 p-3"><div className="mb-2 text-xs font-bold text-slate-700">Собствена опашка</div>{jobs.slice(0,5).map(job=><div key={job.id} className="flex items-center justify-between gap-2 border-t border-slate-50 py-2 text-[11px]"><a className="truncate text-blue-700 hover:underline" href={job.source_url} target="_blank" rel="noreferrer">{job.source_url}</a><span className="shrink-0 font-semibold text-slate-600">{status(job.status)}</span>{job.error_message&&<span className="text-rose-700">Грешка при извличане</span>}</div>)}</div>}
    </section>
    <section className="rounded-lg border border-slate-200 bg-white"><header className="border-b border-slate-100 px-3 py-3"><h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><FileText className="h-4 w-4"/>2. Провери извлечената чернова</h2><p className="mt-1 text-[11px] text-slate-500">Показват се само новите чернови от URL importer-а на „Публикации“.</p></header>
      {!drafts.length?<p className="p-5 text-center text-xs text-slate-400">Още няма извлечена чернова.</p>:<><div className="p-3"><select value={selectedId} onChange={e=>{setSelectedId(e.target.value);setPrice('')}} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{drafts.map(item=><option key={item.id} value={item.id}>{item.title||item.source_url||'URL чернова'} · {formatDateTime(item.created_at)}</option>)}</select></div>{draft&&<div className="border-t border-slate-100 p-3"><div className="mb-3 flex items-center justify-between gap-2">{draft.source_url&&<a href={draft.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5"/>Източник</a>}<span className="flex items-center gap-1 text-xs text-slate-600"><Image className="h-4 w-4"/>{selectedImages} избрани снимки</span></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(labels).map(([key,label])=>field(key)&&<div key={key} className="rounded-md bg-slate-50 px-2.5 py-2"><div className="text-[10px] uppercase text-slate-400">{label}</div><div className="mt-0.5 text-xs font-semibold text-slate-700">{field(key)}</div></div>)}</div>{missing.length>0&&<p className="mt-3 text-xs text-amber-700">Липсват задължителни полета: {missing.map(x=>labels[x]).join(', ')}.</p>}<div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><label><span className="mb-1 block text-xs font-bold text-slate-700">Цена за Mobile.bg (EUR) *</span><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder={draft.price_eur?String(draft.price_eur):'Брокерът въвежда цена'} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"/></label><button disabled={busy||!canPrepare} onClick={()=>void prepare()} className="mt-5 h-10 rounded-md bg-slate-800 px-4 text-xs font-bold text-white disabled:opacity-50">Подготви чернова</button></div>{draft.status==='READY'&&<div className="mt-3 rounded-md bg-emerald-50 p-3 text-xs text-emerald-800"><div className="flex gap-2"><CheckCircle2 className="h-4 w-4"/>Готова за публикуване: {draft.price_eur} EUR, {selectedImages} снимки.</div><div className="mt-2 flex items-center gap-2"><button disabled={busy||Boolean(currentPublish&&['QUEUED','RUNNING'].includes(currentPublish.status))} onClick={()=>void queuePublish()} className="h-9 rounded-md bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">Публикувай (проверка)</button>{currentPublish&&<span className="text-xs font-semibold">{status(currentPublish.status)}{currentPublish.error_message?': '+currentPublish.error_message:''}{currentPublish.public_url?' · '+currentPublish.public_url:''}</span>}</div></div>}</div>}</>}
    </section>
  </div>;
}
