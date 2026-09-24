import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, Eye, Image, ImageIcon, Loader2, MonitorUp, RefreshCw, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { timeAgo } from '@/lib/format';
import { Badge } from '@/components/Badge';
import { DRAFT_STATUS_COLORS, DRAFT_STATUS_LABELS_BG, EXTRA_GROUPS, MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import { PublicationAgentPanel } from '@/components/PublicationAgentPanel';

type Job = { id:string; draft_id:string; source_url:string; status:'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'; error_message:string|null; created_at:string };
type Field = { draft_id:string; field_key:string; value:string|null; source:string|null; mobile_bg_label:string; is_manual_edit:boolean };
type Extra = { draft_id:string; extra_key:string; mobile_bg_label:string; group_name:string; selected:boolean; proof:string|null; source:string|null };
type DraftRow = { id:string; title:string|null; source_url:string|null; price_eur:number|null; status:string; extraction_status:string; extraction_error:string|null; created_at:string };
type DraftImage={id:string;draft_id:string;source_url:string|null;is_selected:boolean;is_main:boolean;display_order:number;converted_jpg:boolean;real_car_photo_check:boolean;processing_status:string};
type Draft = DraftRow & { fields:Field[]; images:DraftImage[]; extras:Extra[] };
type PublishJob={id:string;draft_id:string;status:string;error_message:string|null;public_url:string|null;created_at:string};
const labels:Record<string,string>={category:'Категория',make:'Марка',model:'Модел',title:'Заглавие',modification:'Модификация',year:'Година',month:'Месец',mileage:'Пробег',fuel:'Гориво',gearbox:'Скоростна кутия',power:'Мощност',displacement:'Кубатура',color:'Цвят',condition:'Състояние',drivetrain:'Задвижване',vin:'VIN',location:'Местоположение',seller_name:'Продавач',phone:'Телефон',final_description:'Описание'};
const required=['category','make','model','year','month','mileage','fuel','gearbox','location'];
// Статусът READY се слага само от prepare-publication-draft и го няма в общата
// карта, която описва „Обяви“. Пазим го тук, за да не пипаме чуждия речник.
const publicationStatusLabel=(value:string)=>DRAFT_STATUS_LABELS_BG[value]||(value==='READY'?'Готова за публикуване':value);
const publicationStatusColor=(value:string)=>DRAFT_STATUS_COLORS[value]||(value==='READY'?'emerald':'slate');

export function Publications(){
  const [url,setUrl]=useState('');
  const [copyFromAds,setCopyFromAds]=useState(false);
  const [jobs,setJobs]=useState<Job[]>([]);
  const [drafts,setDrafts]=useState<Draft[]>([]);
  const [publishJobs,setPublishJobs]=useState<PublishJob[]>([]);
  const [selectedId,setSelectedId]=useState('');
  // Отделен от selectedId: load() продължава да поддържа избора, а този флаг
  // само решава дали списъкът или черновата е на екрана.
  const [detailOpen,setDetailOpen]=useState(false);
  const [price,setPrice]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [savingEditor,setSavingEditor]=useState(false);

  const load=useCallback(async()=>{
    const [jobsResult,draftsResult,fieldsResult,imagesResult,extrasResult,publishResult]=await Promise.all([
      supabase.from('publication_source_jobs').select('id,draft_id,source_url,status,error_message,created_at').order('created_at',{ascending:false}).limit(25),
      supabase.from('publication_drafts').select('id,title,source_url,price_eur,status,extraction_status,extraction_error,created_at').order('created_at',{ascending:false}).limit(25),
      supabase.from('publication_draft_fields').select('draft_id,field_key,value,source,mobile_bg_label,is_manual_edit'),
      supabase.from('publication_draft_images').select('id,draft_id,source_url,is_selected,is_main,display_order,converted_jpg,real_car_photo_check,processing_status').order('display_order'),
      supabase.from('publication_draft_extras').select('draft_id,extra_key,mobile_bg_label,group_name,selected,proof,source').order('group_name').order('mobile_bg_label'),
      supabase.from('publication_publish_jobs').select('id,draft_id,status,error_message,public_url,created_at').order('created_at',{ascending:false}).limit(25),
    ]);
    const failed=[jobsResult.error,draftsResult.error,fieldsResult.error,imagesResult.error,extrasResult.error,publishResult.error].find(Boolean);
    if(failed){setError('Неуспешно зареждане: '+failed!.message);return;}
    const byDraft=new Map<string,Field[]>();
    for(const field of (fieldsResult.data||[]) as Field[]) byDraft.set(field.draft_id,[...(byDraft.get(field.draft_id)||[]),field]);
    const imagesByDraft=new Map<string,DraftImage[]>();
    for(const image of (imagesResult.data||[]) as DraftImage[]) imagesByDraft.set(image.draft_id,[...(imagesByDraft.get(image.draft_id)||[]),image]);
    const extrasByDraft=new Map<string,Extra[]>();
    for(const extra of (extrasResult.data||[]) as Extra[]) extrasByDraft.set(extra.draft_id,[...(extrasByDraft.get(extra.draft_id)||[]),extra]);
    const next=((draftsResult.data||[]) as DraftRow[]).map(row=>({...row,fields:byDraft.get(row.id)||[],images:imagesByDraft.get(row.id)||[],extras:extrasByDraft.get(row.id)||[]}));
    setJobs((jobsResult.data||[]) as Job[]);
    setDrafts(next);
    setPublishJobs((publishResult.data||[]) as PublishJob[]);
    setSelectedId(current=>current||next[0]?.id||'');
  },[]);

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),8000);return()=>window.clearInterval(timer);},[load]);
  const draft=drafts.find(item=>item.id===selectedId);
  // Същият избор като досега, само че вече не се прави през падащо меню.
  const openDraft=(id:string)=>{setSelectedId(id);setPrice('');setDetailOpen(true)};
  const backToList=()=>setDetailOpen(false);
  const field=(key:string)=>draft?.fields.find(item=>item.field_key===key)?.value?.trim()||'';
  const missing=required.filter(key=>!field(key));
  const selectedImages=draft?.images.filter(image=>image.is_selected).length||0;
  const canPrepare=Boolean(draft&&price&&!missing.length&&selectedImages);

  async function editDraft(action:string,payload:Record<string,unknown>){
    if(!draft) return;
    setSavingEditor(true);setError('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setSavingEditor(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const {data, error:invokeError}=await supabase.functions.invoke('edit-publication-draft',{body:{draft_id:draft.id,action,...payload},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setSavingEditor(false);
    if(invokeError||data?.error){setError(data?.error||invokeError?.message||'Промяната не бе запазена.');return;}
    void load();
  }

  async function importUrl(){
    if(!url.trim()){setError('Поставете линк към AutoTrader или Encar.');return;}
    setBusy(true);setError('');setNotice('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setBusy(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const {data,error:invokeError}=await supabase.functions.invoke('queue-publication-url',{body:{source_url:url.trim(),copy_existing_draft:copyFromAds},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setBusy(false);
    if(invokeError||data?.error){let detail=data?.error as string|undefined;if(!detail&&invokeError&&'context'in invokeError){try{detail=(await(invokeError as {context:Response}).context.json()).error;}catch{}}setError(detail||invokeError?.message||'Неуспешно добавяне към опашката.');return;}
    setNotice(data?.copied_from_ads?'Създадено е самостоятелно копие с всички полета, снимки и екстри от „Обяви“.':data?.retried?'Неуспешната задача е пусната повторно.':data?.was_created?'Създадена е нова независима чернова и започна извличането.':'Този линк вече има собствена чернова в „Публикации“.');
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
  async function openMobileBrowser(){
    // Open synchronously from the user click so Android Chrome cannot treat the
    // Browser Use view as an unwanted popup after the protected request returns.
    const liveWindow=window.open('about:blank','_blank');
    setBusy(true);setError('');setNotice('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setBusy(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const {data,error:invokeError}=await supabase.functions.invoke('publication-browser-access',{body:{},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setBusy(false);
    if(invokeError||data?.error){let detail=data?.error as string|undefined;if(!detail&&invokeError&&'context'in invokeError){try{detail=(await(invokeError as {context:Response}).context.json()).error;}catch{}}setError(detail||invokeError?.message||'Неуспешно отваряне на браузъра.');return;}
    const ticketUrl=typeof data?.browser_url==='string'?data.browser_url:'';
    if(!ticketUrl){setError('Защитеният достъп до браузъра не бе върнат.');return;}
    // The signed Edge Function issues only a short-lived access ticket. The VPS
    // exchanges it for a Browser Use live URL; the API key never reaches this page.
    const accessUrl=ticketUrl.replace('/publications-browser/vnc.html','/publications-browser/open');
    try{
      const response=await fetch(accessUrl,{method:'POST',credentials:'same-origin',cache:'no-store'});
      const payload=await response.json().catch(()=>null);
      const liveUrl=typeof payload?.live_url==='string'?payload.live_url:'';
      if(!response.ok||!liveUrl){liveWindow?.close();setError(payload?.error||'Browser Use не отвори браузърната сесия.');return;}
      setNotice('Browser Use е отворен в нов раздел. Влезте ръчно в Mobile.bg; паролата не минава през сайта.');
      if(liveWindow) liveWindow.location.assign(liveUrl); else window.location.assign(liveUrl);
    }catch{
      setError('Неуспешна връзка със защитения Browser Use достъп.');
    }
  }

  async function queuePublish(){
    if(!draft)return;
    setBusy(true);setError('');setNotice('');
    const {data:sessionData}=await supabase.auth.getSession();
    if(!sessionData.session?.access_token){setBusy(false);setError('Сесията е изтекла. Влезте отново в сайта.');return;}
    const waitingJob=publishJobs.find(item=>item.draft_id===draft.id&&['WAITING_CONFIRMATION','WAITING_SESSION'].includes(item.status));
    if(waitingJob){
      const {data:resumed,error:resumeError}=await supabase.from('publication_publish_jobs')
        .update({status:'QUEUED',error_message:null,finished_at:null,requested_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        .eq('id',waitingJob.id).eq('draft_id',draft.id)
        .in('status',['WAITING_CONFIRMATION','WAITING_SESSION']).select('id');
      setBusy(false);
      if(resumeError||!resumed?.length){setError(resumeError?.message||'Задачата промени състоянието си. Опреснете преди нов опит.');void load();return;}
      setNotice('Задачата е пусната повторно за реална публикация в Mobile.bg.');void load();return;
    }
    const {data,error:invokeError}=await supabase.functions.invoke('queue-publication-publish',{body:{draft_id:draft.id},headers:{Authorization:`Bearer ${sessionData.session.access_token}`}});
    setBusy(false);
    if(invokeError||data?.error){
      let detail=data?.error as string|undefined;
      const serverDetail=typeof data?.detail==='string'?data.detail.trim():'';
      if(serverDetail) detail=`${detail||'Заявката за публикуване не успя.'}: ${serverDetail}`;
      if(!detail&&invokeError&&'context'in invokeError){try{const payload=await(invokeError as {context:Response}).context.json();detail=payload?.detail?`${payload.error||'Заявката за публикуване не успя.'}: ${payload.detail}`:payload?.error;}catch{}}
      setError(detail||invokeError?.message||'Заявката за публикуване не успя.');
      return;
    }
    setNotice(data?.already_queued?'Черновата вече е в собствената опашка за публикуване.':'Заявката е добавена. Първо ще се провери браузърната сесия и формата.');void load();
  }
  const currentPublish=publishJobs.find(item=>item.draft_id===draft?.id);
  const status=(value:string)=>value==='COMPLETED'?'Готово':value==='RUNNING'?'Извличане':value==='FAILED'?'Грешка':value==='WAITING_SESSION'?'Нужен вход':value==='WAITING_CONFIRMATION'?'Чака потвърждение':'На опашка';

  return <div className="space-y-4">
    <PublicationHeader onRefresh={()=>void load()} onOpenBrowser={()=>void openMobileBrowser()} busy={busy}/>
    {notice&&<div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}
    {error&&<div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertTriangle className="h-4 w-4 shrink-0"/>{error}</div>}
    <PublicationImportSection url={url} setUrl={setUrl} copyFromAds={copyFromAds} setCopyFromAds={setCopyFromAds} jobs={jobs} busy={busy} onImport={()=>void importUrl()} status={status}/>
    {detailOpen&&draft
      ? <PublicationDraftView draft={draft} field={field} missing={missing} selectedImages={selectedImages} price={price} setPrice={setPrice} busy={busy||savingEditor} currentPublish={currentPublish} onPrepare={prepare} onPublish={queuePublish} onEdit={editDraft} status={status} onBack={backToList}/>
      : <PublicationDraftList drafts={drafts} publishJobs={publishJobs} onOpen={openDraft}/>}
    <PublicationAgentPanel draftTitle={draft?.title||undefined}/>
  </div>;
}

function PublicationHeader({onRefresh,onOpenBrowser,busy}:{onRefresh:()=>void;onOpenBrowser:()=>void;busy:boolean}){
  return <header className="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Browser Use</h2>
      <p className="mt-0.5 text-sm text-slate-500">Чернови за Mobile.bg — AUTO IMPORT CONTROL CENTER</p>
    </div>
    <div className="flex items-center gap-2">
      <button disabled={busy} onClick={onOpenBrowser} className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><MonitorUp className="h-3.5 w-3.5"/>Влез в Mobile.bg</button>
      <button onClick={onRefresh} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5"/>Опресни</button>
    </div>
  </header>;
}

function PublicationImportSection({url,setUrl,copyFromAds,setCopyFromAds,jobs,busy,onImport,status}:{url:string;setUrl:(value:string)=>void;copyFromAds:boolean;setCopyFromAds:(value:boolean)=>void;jobs:Job[];busy:boolean;onImport:()=>void;status:(value:string)=>string}){
  return <section className="rounded-md border border-slate-200 bg-white shadow-sm"><header className="border-b border-slate-100 px-3 py-3"><h3 className="text-sm font-bold text-slate-700">1. Импортирай нов URL</h3><p className="mt-1 text-[11px] text-slate-500">Поставете директен линк към AutoTrader Canada или Encar. Създава се нова чернова само за „Публикации“.</p></header><div className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.autotrader.ca/offers/... или encar.com/..." className="h-10 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"/><button disabled={busy} onClick={onImport} className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busy&&<Loader2 className="h-3.5 w-3.5 animate-spin"/>}{copyFromAds?'Копирай пълна чернова':'Извлечи данни и снимки'}</button></div><label className="mx-3 mb-3 flex items-start gap-2 text-[11px] text-slate-600"><input type="checkbox" checked={copyFromAds} onChange={e=>setCopyFromAds(e.target.checked)} className="mt-0.5"/><span>За тест: копирай пълната чернова за същия URL от „Обяви“ — полета, снимки и екстри се записват като нова независима чернова тук.</span></label>
    {jobs.length>0&&<div className="border-t border-slate-100 p-3"><div className="mb-2 text-xs font-bold text-slate-700">Собствена опашка</div>{jobs.slice(0,5).map(job=><div key={job.id} className="flex items-center justify-between gap-2 border-t border-slate-50 py-2 text-[11px]"><a className="truncate text-blue-700 hover:underline" href={job.source_url} target="_blank" rel="noreferrer">{job.source_url}</a><span className="shrink-0 font-semibold text-slate-600">{status(job.status)}</span>{job.error_message&&<span className="text-rose-700">Грешка при извличане</span>}</div>)}</div>}
  </section>;
}

function PublicationDraftList({drafts,publishJobs,onOpen}:{drafts:Draft[];publishJobs:PublishJob[];onOpen:(id:string)=>void}){
  const publishedByDraft=new Map(publishJobs.filter(job=>job.public_url).map(job=>[job.draft_id,job.public_url!]));
  return <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
      <h3 className="text-sm font-bold text-slate-700">Чернови за публикуване</h3>
      <span className="text-[10px] text-slate-500">Отвори чернова, за да видиш данните и да я подготвиш</span>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-[11px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#edf3f9] text-[9px] font-extrabold text-slate-700">
            <th className="px-2 py-2">Заглавие / Източник</th>
            <th className="px-2 py-1 text-center">Статус</th>
            <th className="px-2 py-1 text-center">Създадена</th>
            <th className="px-2 py-1 text-center">Публикувана</th>
            <th className="px-2 py-1 text-center">Действие</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {drafts.length===0
            ? <tr><td colSpan={5} className="py-12 text-center text-slate-400">Още няма извлечена чернова.</td></tr>
            : drafts.map(item=><tr key={item.id} className="cursor-pointer transition hover:bg-blue-50/60" onClick={()=>onOpen(item.id)}>
              <td className="px-2 py-2">
                <p className="truncate font-bold text-slate-800">{item.title||`Чернова ${item.id.slice(0,8)}`}</p>
                <p className="truncate text-slate-500">{item.source_url||'—'}</p>
              </td>
              <td className="px-2 py-1 text-center">
                <Badge color={publicationStatusColor(item.status)}>{publicationStatusLabel(item.status)}</Badge>
              </td>
              <td className="px-2 py-1 text-center text-slate-500">{timeAgo(item.created_at)}</td>
              <td className="px-2 py-1 text-center">
                {publishedByDraft.has(item.id)
                  ? <a href={publishedByDraft.get(item.id)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="text-blue-600 hover:underline">Линк</a>
                  : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-2 py-1 text-center">
                <button onClick={e=>{e.stopPropagation();onOpen(item.id)}} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-600 hover:bg-blue-100"><Eye className="inline h-3 w-3"/> Отвори</button>
              </td>
            </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}

function PublicationDraftView(props:{draft:Draft;field:(key:string)=>string;missing:string[];selectedImages:number;price:string;setPrice:(value:string)=>void;busy:boolean;currentPublish:PublishJob|undefined;onPrepare:()=>Promise<void>;onPublish:()=>Promise<void>;onEdit:(action:string,payload:Record<string,unknown>)=>Promise<void>;status:(value:string)=>string;onBack:()=>void}){
  const {draft,onBack,...rest}=props;
  return <section className="rounded-md border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ChevronRight className="h-3.5 w-3.5 rotate-180"/> Назад</button>
        <div>
          <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">{draft.title||`Чернова ${draft.id.slice(0,8)}`}</h2>
          <p className="text-xs text-slate-500">{draft.source_url||'—'}</p>
        </div>
      </div>
      <Badge color={publicationStatusColor(draft.status)}>{publicationStatusLabel(draft.status)}</Badge>
    </div>
    <PublicationDraftEditor draft={draft} {...rest}/>
  </section>;
}

function PublicationDraftEditor({draft,field,missing,selectedImages,price,setPrice,busy,currentPublish,onPrepare,onPublish,onEdit,status}:{draft:Draft;field:(key:string)=>string;missing:string[];selectedImages:number;price:string;setPrice:(value:string)=>void;busy:boolean;currentPublish:PublishJob|undefined;onPrepare:()=>Promise<void>;onPublish:()=>Promise<void>;onEdit:(action:string,payload:Record<string,unknown>)=>Promise<void>;status:(value:string)=>string}){
  const extraByKey=useMemo(()=>new Map(draft.extras.map(extra=>[extra.extra_key,extra])),[draft.extras]);
  const groups=useMemo(()=>EXTRA_GROUPS.map(group=>({group,items:MOBILE_BG_FIELD_MAP.filter(def=>def.section==='extras'&&def.group===group)})),[]);
  const canPrepare=Boolean(price&&!missing.length&&selectedImages);
  return <div className="border-t border-slate-100 p-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{draft.source_url&&<a href={draft.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5"/>Източник</a>}<div className="flex gap-3 text-xs text-slate-600"><span className="flex items-center gap-1"><Image className="h-4 w-4"/>{selectedImages} избрани снимки</span><span>{draft.extras.filter(extra=>extra.selected).length} избрани екстри</span></div></div>
    {draft.extraction_status==='FAILED'&&<div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">Извличането не е успешно: {draft.extraction_error||'без техническо описание'}.</div>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(labels).map(([key,label])=>field(key)&&<div key={key} className="rounded-md bg-slate-50 px-2.5 py-2"><div className="text-[10px] uppercase text-slate-400">{label}</div><div className="mt-0.5 text-xs font-semibold text-slate-700">{field(key)}</div></div>)}</div>
    <div className="mt-3 rounded-md border border-slate-200 bg-white"><div className="border-b border-slate-100 px-3 py-2"><h3 className="text-sm font-bold text-slate-800">3. Екстри</h3><p className="text-[10px] text-slate-500">Отбелязвай и махай екстри ръчно. Те се записват веднага в тази чернова.</p></div><div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">{groups.map(({group,items})=><div key={group}><p className="mb-1.5 text-xs font-bold text-slate-700">{group}</p><div className="space-y-1">{items.map(def=>{const saved=extraByKey.get(def.key);return <label key={def.key} className="flex cursor-pointer items-start gap-1.5 text-[11px] text-slate-700"><input type="checkbox" checked={Boolean(saved?.selected)} disabled={busy} onChange={()=>void onEdit('toggle_extra',{extra_key:def.key,mobile_bg_label:def.mobile_bg_label,group_name:def.group||'Други',selected:!saved?.selected})} className="mt-0.5 h-3.5 w-3.5"/><span>{def.mobile_bg_label}</span></label>})}</div></div>)}</div></div>
    <div className="mt-3 rounded-md border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2"><div><h3 className="text-sm font-bold text-slate-800">5. Снимки</h3><p className="text-[10px] text-slate-500">Избери снимките за Mobile.bg и основната снимка.</p></div><span className="text-[11px] font-bold text-slate-600">Избрани: {selectedImages} / 17</span></div><div className="p-3">{draft.images.length===0?<p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">Няма извлечени снимки.</p>:<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{draft.images.map(image=><div key={image.id} className={`overflow-hidden rounded border bg-white ${image.is_selected?'border-emerald-300 ring-1 ring-emerald-200':'border-slate-200'}`}><div className="relative h-24 bg-slate-100">{image.source_url?<img src={image.source_url} alt="" loading="lazy" className="h-24 w-full object-cover"/>:<div className="flex h-24 items-center justify-center text-slate-400"><ImageIcon className="h-5 w-5"/></div>}{image.is_main&&<span className="absolute left-1 top-1 rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">Основна</span>}</div><div className="space-y-1 p-1.5"><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={image.is_selected} disabled={busy||(!image.is_selected&&selectedImages>=17)} onChange={()=>void onEdit('update_image',{image_id:image.id,is_selected:!image.is_selected})} className="h-3.5 w-3.5"/>Избрана</label><label className="flex items-center gap-1 text-[10px]"><input type="radio" name="publication-main-image" checked={image.is_main} disabled={busy} onChange={()=>void onEdit('update_image',{image_id:image.id,is_main:true})} className="h-3.5 w-3.5"/>Основна</label><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={image.real_car_photo_check} disabled={busy} onChange={()=>void onEdit('update_image',{image_id:image.id,real_car_photo_check:!image.real_car_photo_check})} className="h-3.5 w-3.5"/>Реална кола</label></div></div>)}</div>}</div></div>
    {missing.length>0&&<p className="mt-3 text-xs text-amber-700">Липсват задължителни полета: {missing.map(x=>labels[x]).join(', ')}.</p>}
    <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><label><span className="mb-1 block text-xs font-bold text-slate-700">Цена за Mobile.bg (EUR) *</span><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder={draft.price_eur?String(draft.price_eur):'Брокерът въвежда цена'} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"/></label><button disabled={busy||!canPrepare} onClick={()=>void onPrepare()} className="mt-5 flex h-10 items-center justify-center gap-1.5 rounded-md bg-slate-800 px-4 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5"/>Подготви чернова</button></div>
    {draft.status==='READY'&&<div className="mt-3 rounded-md bg-emerald-50 p-3 text-xs text-emerald-800"><div className="flex gap-2"><CheckCircle2 className="h-4 w-4"/>Готова за публикуване: {draft.price_eur} EUR, {selectedImages} снимки.</div><div className="mt-2 flex items-center gap-2"><button disabled={busy||Boolean(currentPublish&&['QUEUED','RUNNING'].includes(currentPublish.status))} onClick={()=>void onPublish()} className="h-9 rounded-md bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">Публикувай в Mobile.bg</button>{currentPublish&&<span className="text-xs font-semibold">{status(currentPublish.status)}{currentPublish.error_message?': '+currentPublish.error_message:''}{currentPublish.public_url?' · '+currentPublish.public_url:''}</span>}</div></div>}
  </div>
}
