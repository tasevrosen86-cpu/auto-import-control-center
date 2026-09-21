import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from 'npm:@supabase/server';

const ADMIN_EMAIL = 'tasevrosen86@gmail.com';
const cors = {
  'Access-Control-Allow-Origin': 'https://autoimportcontrolcenter.biz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });

function parse(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Линкът не е валиден URL адрес.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Позволени са само http/https линкове.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'autotrader.ca' || host.endsWith('.autotrader.ca')) {
    const id = url.pathname.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0] ?? url.searchParams.get('id');
    return { source_url: url.toString(), source_type: 'autotrader_ca', source_domain: 'autotrader.ca', source_listing_id: id };
  }
  if (host === 'encar.com' || host.endsWith('.encar.com')) {
    const id = url.pathname.match(/(?:cars\/detail|detail)\/(\d+)/i)?.[1] ?? null;
    return { source_url: url.toString(), source_type: 'encar', source_domain: 'encar.com', source_listing_id: id };
  }
  throw new Error('Поддържат се само AutoTrader Canada и Encar.');
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'Използвайте POST.' }, 405);
    if (ctx.userClaims?.email?.toLowerCase() !== ADMIN_EMAIL) return reply({ error: 'Нямате достъп.' }, 403);

    let raw = '';
    let copyExistingDraft = false;
    try {
      const body = await request.json();
      raw = String(body?.source_url || '').trim();
      copyExistingDraft = body?.copy_existing_draft === true;
    } catch { return reply({ error: 'Невалидна заявка.' }, 400); }
    if (!raw || raw.length > 2000) return reply({ error: 'Въведете валиден линк.' }, 400);

    let source;
    try { source = parse(raw); }
    catch (cause) { return reply({ error: cause instanceof Error ? cause.message : 'Невалиден линк.' }, 400); }

    const identity = source.source_domain + '|' +
      (source.source_listing_id || source.source_url.replace(/[?#].*$/, '').toLowerCase());

    const { data: existing, error: duplicateError } = await ctx.supabaseAdmin
      .from('publication_source_jobs')
      .select('id,draft_id,status')
      .eq('owner_id', ctx.userClaims.id)
      .eq('source_identity', identity)
      .maybeSingle();
    if (duplicateError) return reply({ error: 'Проверката за дубликат не успя.', detail: duplicateError.message }, 500);

    if (existing) {
      if (existing.status === 'FAILED') {
        const { data: retried, error } = await ctx.supabaseAdmin
          .from('publication_source_jobs')
          .update({ status: 'QUEUED', error_message: null, started_at: null, finished_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select('id,draft_id,status')
          .single();
        if (error) return reply({ error: 'Повторното стартиране не успя.', detail: error.message }, 500);
        await ctx.supabaseAdmin.from('publication_drafts')
          .update({ status: 'DRAFT', extraction_status: 'PROCESSING', extraction_error: null, updated_at: new Date().toISOString() })
          .eq('id', retried.draft_id);
        return reply({ ...retried, was_created: false, retried: true }, 200);
      }
      return reply({ ...existing, was_created: false, retried: false }, 200);
    }

    if (copyExistingDraft) {
      const { data: sourceDraft, error: sourceDraftError } = await ctx.supabaseAdmin
        .from('mobile_bg_drafts')
        .select('id,title,status,source_type,source_url,source_listing_id,source_vin,source_price_eur,price_eur,currency,source_domain,extraction_status')
        .eq('owner_id', ctx.userClaims.id)
        .eq('source_url', source.source_url)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sourceDraftError) return reply({ error: 'Пълната чернова не можа да бъде намерена.', detail: sourceDraftError.message }, 500);
      if (!sourceDraft) return reply({ error: 'За този URL няма собствена чернова в „Обяви“, която да се копира.' }, 404);

      const [{ data: sourceFields, error: fieldsError }, { data: sourceImages, error: imagesError }, { data: sourceExtras, error: extrasError }] = await Promise.all([
        ctx.supabaseAdmin.from('mobile_bg_draft_fields').select('field_key,mobile_bg_label,our_db_key,value,field_type,source,proof,validation_status,filled_at,is_manual_edit').eq('draft_id', sourceDraft.id),
        ctx.supabaseAdmin.from('mobile_bg_draft_images').select('source_url,local_path,converted_jpg,is_selected,is_main,display_order,real_car_photo_check,processing_status,size_bytes').eq('draft_id', sourceDraft.id).order('display_order'),
        ctx.supabaseAdmin.from('mobile_bg_draft_extras').select('extra_key,mobile_bg_label,group_name,selected,proof,source').eq('draft_id', sourceDraft.id),
      ]);
      if (fieldsError || imagesError || extrasError) return reply({ error: 'Пълната чернова не можа да бъде прочетена.', detail: fieldsError?.message || imagesError?.message || extrasError?.message }, 500);

      const { data: copiedDraft, error: copiedDraftError } = await ctx.supabaseAdmin.from('publication_drafts').insert({
        owner_id: ctx.userClaims.id, title: sourceDraft.title, status: sourceDraft.status === 'READY' ? 'READY_FOR_REVIEW' : sourceDraft.status,
        source_type: sourceDraft.source_type || source.source_type, source_url: source.source_url,
        source_listing_id: sourceDraft.source_listing_id || source.source_listing_id, source_vin: sourceDraft.source_vin,
        source_price_eur: sourceDraft.source_price_eur, price_eur: sourceDraft.price_eur, currency: sourceDraft.currency || 'EUR',
        intake_origin: 'ADS_DRAFT_COPY', extraction_status: sourceDraft.extraction_status || 'COMPLETED',
        source_domain: sourceDraft.source_domain || source.source_domain, created_by: 'Publication copy from Ads',
      }).select('id').single();
      if (copiedDraftError || !copiedDraft) return reply({ error: 'Независимата чернова не беше създадена.', detail: copiedDraftError?.message }, 500);

      const now = new Date().toISOString();
      if ((sourceFields || []).length) {
        const { error } = await ctx.supabaseAdmin.from('publication_draft_fields').insert(sourceFields.map((field: any) => ({ ...field, draft_id: copiedDraft.id, filled_at: field.filled_at || now })));
        if (error) return reply({ error: 'Полетата не бяха копирани.', detail: error.message }, 500);
      }
      if ((sourceImages || []).length) {
        const { error } = await ctx.supabaseAdmin.from('publication_draft_images').insert(sourceImages.map((image: any) => ({ ...image, draft_id: copiedDraft.id })));
        if (error) return reply({ error: 'Снимките не бяха копирани.', detail: error.message }, 500);
      }
      if ((sourceExtras || []).length) {
        const { error } = await ctx.supabaseAdmin.from('publication_draft_extras').insert(sourceExtras.map((extra: any) => ({ ...extra, draft_id: copiedDraft.id })));
        if (error) return reply({ error: 'Екстрите не бяха копирани.', detail: error.message }, 500);
      }

      const result = { copied_from_ads_draft_id: sourceDraft.id, field_count: (sourceFields || []).length, image_count: (sourceImages || []).length, extra_count: (sourceExtras || []).length };
      const { data: completedJob, error: jobError } = await ctx.supabaseAdmin.from('publication_source_jobs').insert({
        draft_id: copiedDraft.id, owner_id: ctx.userClaims.id, source_url: source.source_url, source_type: source.source_type,
        source_domain: source.source_domain, source_listing_id: source.source_listing_id, source_identity: identity,
        status: 'COMPLETED', result, raw_payload: result, normalized_payload: result, payload_received_at: now, finished_at: now,
      }).select('id,draft_id,status').single();
      if (jobError || !completedJob) return reply({ error: 'Копието е създадено, но не можа да бъде добавено в собствената опашка.', detail: jobError?.message }, 500);
      await ctx.supabaseAdmin.from('publication_draft_action_log').insert({ draft_id: copiedDraft.id, action: 'COPIED_FROM_ADS_DRAFT', actor: 'Publication URL importer', details: result });
      return reply({ ...completedJob, was_created: true, retried: false, copied_from_ads: true, ...result }, 201);
    }

    const draftTitle = 'Извличане от URL…';
    const { data: draft, error: draftError } = await ctx.supabaseAdmin
      .from('publication_drafts')
      .insert({
        owner_id: ctx.userClaims.id,
        title: draftTitle,
        status: 'DRAFT',
        source_type: source.source_type,
        source_url: source.source_url,
        source_listing_id: source.source_listing_id,
        intake_origin: 'URL_IMPORT',
        extraction_status: 'PROCESSING',
        source_domain: source.source_domain,
        created_by: 'Publication URL importer',
      })
      .select('id')
      .single();
    if (draftError || !draft) return reply({ error: 'Черновата не беше създадена.', detail: draftError?.message }, 500);

    const { data: job, error: jobError } = await ctx.supabaseAdmin
      .from('publication_source_jobs')
      .insert({
        draft_id: draft.id,
        owner_id: ctx.userClaims.id,
        source_url: source.source_url,
        source_type: source.source_type,
        source_domain: source.source_domain,
        source_listing_id: source.source_listing_id,
        source_identity: identity,
      })
      .select('id,draft_id,status')
      .single();

    if (jobError || !job) {
      await ctx.supabaseAdmin.from('publication_drafts').delete().eq('id', draft.id);
      return reply({ error: 'Неуспешно добавяне към опашката.', detail: jobError?.message }, 500);
    }
    return reply({ ...job, was_created: true, retried: false }, 201);
  }),
};
