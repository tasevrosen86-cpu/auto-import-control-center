import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from 'npm:@supabase/server';

const ADMIN_EMAIL='tasevrosen86@gmail.com';
const cors={'Access-Control-Allow-Origin':'https://autoimportcontrolcenter.biz','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'Cache-Control':'no-store'}});

export default {
  fetch: withSupabase({auth:'user'}, async (request,ctx)=>{
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    if(request.method!=='POST') return reply({error:'Използвайте POST.'},405);
    if(ctx.userClaims?.email?.toLowerCase()!==ADMIN_EMAIL) return reply({error:'Нямате достъп.'},403);
    let body:{draft_id?:unknown};
    try { body=await request.json(); } catch { return reply({error:'Невалидна заявка.'},400); }
    const draftId=typeof body.draft_id==='string'?body.draft_id:'';
    if(!draftId) return reply({error:'Липсва чернова.'},400);
    const {data:draft,error:draftError}=await ctx.supabaseAdmin
      .from('publication_drafts').select('id,status,price_eur').eq('id',draftId).eq('owner_id',ctx.userClaims.id).maybeSingle();
    if(draftError||!draft) return reply({error:'Черновата не е намерена.'},404);
    if(draft.status!=='READY'||!Number.isFinite(Number(draft.price_eur))||Number(draft.price_eur)<=0)
      return reply({error:'Първо въведете EUR цена и натиснете „Подготви чернова“. '},422);
    const [{count:photoCount,error:photosError},{data:fields,error:fieldsError}]=await Promise.all([
      ctx.supabaseAdmin.from('publication_draft_images').select('*',{count:'exact',head:true}).eq('draft_id',draftId).eq('is_selected',true),
      ctx.supabaseAdmin.from('publication_draft_fields').select('field_key,value').eq('draft_id',draftId),
    ]);
    if(photosError||fieldsError) return reply({error:'Черновата не можа да бъде проверена.'},500);
    const values=new Map((fields||[]).map((row:any)=>[row.field_key,String(row.value||'').trim()]));
    const missing=['make','model','year','mileage','fuel','gearbox','color'].filter(key=>!values.get(key));
    if(missing.length||!photoCount) return reply({error:'Липсват: '+[...missing,...(photoCount?[]:['снимки'])].join(', ')},422);
    const now=new Date().toISOString();
    const {data:existing}=await ctx.supabaseAdmin.from('publication_publish_jobs')
      .select('id,status').eq('draft_id',draftId).in('status',['QUEUED','RUNNING','WAITING_SESSION','WAITING_CONFIRMATION']).maybeSingle();
    if(existing) return reply({id:existing.id,status:existing.status,already_queued:true});
    const {data:job,error:jobError}=await ctx.supabaseAdmin.from('publication_publish_jobs').insert({
      draft_id:draftId,owner_id:ctx.userClaims.id,status:'QUEUED',requested_at:now
    }).select('id,status').single();
    if(jobError||!job) return reply({error:'Заявката за публикация не бе създадена.',detail:jobError?.message},500);
    await ctx.supabaseAdmin.from('publication_draft_action_log').insert({
      draft_id:draftId,action:'PUBLICATION_PUBLISH_REQUESTED',actor:'Admin',details:{job_id:job.id}
    });
    return reply({id:job.id,status:job.status,already_queued:false},201);
  })
};