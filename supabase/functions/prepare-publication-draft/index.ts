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
    let body:{draft_id?:unknown;price_eur?:unknown};
    try { body=await request.json(); } catch { return reply({error:'Невалидна заявка.'},400); }
    const draftId=typeof body.draft_id==='string'?body.draft_id:'';
    const price=Number(body.price_eur);
    if(!draftId || !Number.isFinite(price) || price<=0 || price>1000000) return reply({error:'Въведете валидна EUR цена.'},400);

    const {data:draft,error:draftError}=await ctx.supabaseAdmin
      .from('publication_drafts').select('id').eq('id',draftId).eq('owner_id',ctx.userClaims.id).maybeSingle();
    if(draftError || !draft) return reply({error:'Черновата не е намерена.'},404);

    const [{data:fields,error:fieldsError},{data:images,error:imagesError}]=await Promise.all([
      ctx.supabaseAdmin.from('publication_draft_fields').select('field_key,value').eq('draft_id',draft.id),
      ctx.supabaseAdmin.from('publication_draft_images').select('id').eq('draft_id',draft.id).eq('is_selected',true),
    ]);
    if(fieldsError || imagesError) return reply({error:'Черновата не можа да бъде проверена.',detail:fieldsError?.message||imagesError?.message},500);
    const values=new Map((fields||[]).map((row:any)=>[row.field_key,String(row.value||'').trim()]));
    const required=['category','make','model','year','month','mileage','fuel','gearbox','location'];
    const missing=required.filter(key=>!values.get(key));
    if(missing.length || !(images||[]).length) return reply({error:'Липсват: '+[...missing,...((images||[]).length?[]:['снимки'])].join(', ')},422);

    const now=new Date().toISOString();
    const {error:priceError}=await ctx.supabaseAdmin.from('publication_draft_fields').upsert({
      draft_id:draft.id,field_key:'price',mobile_bg_label:'Цена',our_db_key:'price_eur',
      value:String(price),field_type:'number',source:'manual',proof:'Ръчно въведена EUR цена',
      validation_status:'pending',filled_at:now,is_manual_edit:true,
    },{onConflict:'draft_id,field_key'});
    if(priceError) return reply({error:'Цената не бе запазена.',detail:priceError.message},500);
    const {error:currencyError}=await ctx.supabaseAdmin.from('publication_draft_fields').upsert({
      draft_id:draft.id,field_key:'currency',mobile_bg_label:'Валута',our_db_key:'currency',
      value:'EUR',field_type:'select',source:'system',proof:'Публикации',validation_status:'pending',filled_at:now,is_manual_edit:true,
    },{onConflict:'draft_id,field_key'});
    if(currencyError) return reply({error:'Валутата не бе запазена.',detail:currencyError.message},500);
    const {error:updateError}=await ctx.supabaseAdmin.from('publication_drafts').update({
      price_eur:price,currency:'EUR',status:'READY',updated_at:now,
    }).eq('id',draft.id);
    if(updateError) return reply({error:'Черновата не бе подготвена.',detail:updateError.message},500);
    await ctx.supabaseAdmin.from('publication_draft_action_log').insert({
      draft_id:draft.id,action:'PUBLICATION_DRAFT_PREPARED',actor:'Admin',details:{price_eur:price,image_count:(images||[]).length},
    });
    return reply({ok:true,id:draft.id,price_eur:price,image_count:(images||[]).length});
  })
};