// Isolated worker for publication_* tables only. It does not read any
// mobile_bg_* catalogue/ads data, so «Публикации» and «Обяви» cannot mix.

import { createClient } from '@supabase/supabase-js';
import { openSession, describeTransport } from './session.mjs';
import { inspectForm, publishOne, openForm, ensureLoggedIn, fillListing } from './form.mjs';
import { preflight } from './preflight.mjs';

// Browser diagnostics must not need database credentials. The database client is
// intentionally created only when the private queue worker can authenticate.
const supabaseUrl=process.env.SUPABASE_URL||'';
const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const db=serviceRoleKey?createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false}}):null;
const worker=process.env.PUBLICATIONS_WORKER_NAME||'aicc-publications-publisher';
const now=()=>new Date().toISOString();

async function event(draftId,action,details={}) {
  await db.from('publication_draft_action_log').insert({draft_id:draftId,action,actor:worker,details}).throwOnError();
}
async function finish(job,status,result={},error=null) {
  await db.from('publication_publish_jobs').update({status,result,error_message:error,public_url:result.listing_url||null,finished_at:now(),updated_at:now()}).eq('id',job.id).throwOnError();
  await event(job.draft_id,'PUBLICATION_PUBLISH_'+status,{job_id:job.id,...result,error});
}
function value(map,...keys){for(const key of keys){const v=map.get(key);if(v&&String(v).trim())return String(v).trim();}return '';}
function num(v){const x=String(v||'').replace(/[^0-9]/g,'');return x?Number(x):null;}
function fuel(v){const s=String(v).toLowerCase();return s.includes('диз')||s.includes('diesel')?'diesel':s.includes('хиб')||s.includes('hybrid')?'hybrid':s.includes('елект')||s.includes('electric')?'electric':s.includes('бенз')||s.includes('gas')||s.includes('petrol')?'petrol':'';}
function gearbox(v){const s=String(v).toLowerCase();return s.includes('полу')||s.includes('semi')?'semi-automatic':s.includes('авто')||s.includes('automatic')?'automatic':s.includes('ръч')||s.includes('manual')?'manual':'';}
function color(v){const s=String(v).toLowerCase();const x=[['сив','grey'],['gray','grey'],['чер','black'],['black','black'],['бял','white'],['white','white'],['среб','silver'],['silver','silver'],['син','blue'],['blue','blue'],['черв','red'],['red','red'],['каф','brown'],['brown','brown'],['зелен','green'],['green','green']].find(([a])=>s.includes(a));return x?.[1]||'';}
function body(v){const s=String(v).toLowerCase();if(s.includes('седан')||s.includes('sedan'))return'sedan';if(s.includes('комби')||s.includes('wagon'))return'wagon';if(s.includes('купе')||s.includes('coupe'))return'coupe';if(s.includes('хеч')||s.includes('hatch'))return'hatchback';if(s.includes('пикап')||s.includes('pickup'))return'pickup';return'large_suv';}

async function payload(job){
 const [{data:draft,error:de},{data:fields,error:fe},{data:images,error:ie}]=await Promise.all([
  db.from('publication_drafts').select('id,title,source_url,source_type,price_eur,status').eq('id',job.draft_id).single(),
  db.from('publication_draft_fields').select('field_key,value').eq('draft_id',job.draft_id),
  db.from('publication_draft_images').select('source_url,processing_status').eq('draft_id',job.draft_id).eq('is_selected',true).order('display_order').limit(17),
 ]);
 if(de||fe||ie||!draft)throw new Error('Не могат да се прочетат изолираните данни на черновата.');
 if(draft.status!=='READY')throw new Error('Черновата не е подготвена с EUR цена.');
 const f=new Map((fields||[]).map(r=>[r.field_key,r.value]));
 return {draft_id:draft.id,source_url:draft.source_url,source_images:(images||[]).filter(i=>i.source_url&&i.processing_status!=='failed').map(i=>i.source_url),title:draft.title||'',make:value(f,'make'),model:value(f,'model'),year:num(value(f,'year')),mileage:num(value(f,'mileage')),fuel:fuel(value(f,'fuel')),transmission:gearbox(value(f,'gearbox','transmission')),body:body(value(f,'body','body_type','category')),color:color(value(f,'color')),power:num(value(f,'power')),description:value(f,'final_description','description'),price_eur:Number(draft.price_eur),currency:'EUR',month:'декември',country_label:'Канада'};
}
export async function browserTest(){
 const session=await openSession();
 try{await openForm(session);const login=await ensureLoggedIn(session);const form=await inspectForm(session);return {...form,login_state:login.state,transport:describeTransport(),live_url:session.liveUrl||null,verdict:login.state==='already_logged_in'&&form.form_found?'SUCCESS':'WAITING_SESSION'};}finally{await session.close();}
}
async function processJob(job){
 let item;try{item=await payload(job);}catch(error){return finish(job,'FAILED',{},String(error));}
 const check=preflight(item);if(!check.ok)return finish(job,'FAILED',{preflight:check},check.failures.map(x=>x.message).join(' '));
 if(process.env.PUBLICATIONS_REAL_PUBLISH_ENABLED!=='true')return finish(job,'WAITING_CONFIRMATION',{preflight:check,transport:describeTransport()},'Защитният превключвател за реално публикуване е изключен.');
 const approvedDraft=process.env.PUBLICATIONS_REAL_PUBLISH_DRAFT_ID||'';
 if(approvedDraft&&job.draft_id!==approvedDraft)return finish(job,'WAITING_CONFIRMATION',{},'Реалният тест е разрешен само за конкретната потвърдена чернова.');
 const previous=await db.from('publication_publish_jobs').select('id,public_url').eq('draft_id',job.draft_id).not('public_url','is',null).limit(1);
 if(previous.error)return finish(job,'FAILED',{},'Проверката за вече публикувана обява не успя: '+previous.error.message);
 if(previous.data?.length)return finish(job,'COMPLETED',{listing_url:previous.data[0].public_url,reused_existing_publication:true});
 let session;
 try{
  session=await openSession();await openForm(session);const login=await ensureLoggedIn(session);const form=await inspectForm(session);
  if(login.state!=='already_logged_in'||!form.form_found)return finish(job,'WAITING_SESSION',{login,form,transport:describeTransport()},'Нужен е ръчен вход в Mobile.bg в избрания браузърен профил.');
  const result=await publishOne(session,{...item,stageImages:urls=>session.stageImages(urls)});
  return finish(job,result.state==='published'?'COMPLETED':'FAILED',result,result.state==='published'?null:result.message||'Mobile.bg не потвърди публикацията.');
 }catch(error){return finish(job,'FAILED',{},String(error));}finally{await session?.close().catch(()=>undefined);}
}
// Dry run for one draft: fills the real Mobile.bg form with that draft's own
// values and stops. It never submits and never touches the file input, so it
// cannot create a listing — which is precisely why it is safe to run against
// production before the real thing. Its job is to answer "would every mapped
// value be accepted", and it answers with the page's own chosen option text, not
// with an internal value.
//
// Usage: node src/index.mjs fill-test <draft-id>
export async function fillTest(draftId){
 if(!db) throw new Error('Липсва SUPABASE_SERVICE_ROLE_KEY: няма достъп до черновата.');
 if(!draftId) throw new Error('Дай draft_id: node src/index.mjs fill-test <draft-id>');
 const item=await payload({draft_id:draftId});
 const check=preflight(item);
 const session=await openSession();
 try{
  await openForm(session);
  const login=await ensureLoggedIn(session);
  const form=await inspectForm(session);
  if(login.state!=='already_logged_in'||!form.form_found) return {verdict:'NO_SESSION',login_state:login.state,form:form.verdict,transport:describeTransport()};
  const filled=await fillListing(session,item);
  return {verdict:'FILLED',draft_id:draftId,transport:describeTransport(),preflight:check,login_state:login.state,...filled};
 }catch(error){
  return {verdict:'FILL_FAILED',draft_id:draftId,error:String(error),transport:describeTransport()};
 }finally{await session.close().catch(()=>undefined);}
}
export async function drain(){
 if(!db)throw new Error('Липсва SUPABASE_SERVICE_ROLE_KEY: publisher-ът няма право да чете собствената опашка.');
 const {data,error}=await db.rpc('claim_publication_publish_job',{worker_name:worker});if(error)throw error;
 const job=Array.isArray(data)?data[0]:data;if(!job)return {processed:0};await processJob(job);return {processed:1,job_id:job.id};
}
if(process.argv[1]&&import.meta.url===('file://' + process.argv[1])){
 const command=process.argv[2]||'drain';
 const run=command==='browser-test'?browserTest():command==='fill-test'?fillTest(process.argv[3]):drain();
 run.then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message||e);process.exit(1)});
}
