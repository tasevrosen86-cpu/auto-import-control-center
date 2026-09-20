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
    try { raw = String((await request.json()).source_url || '').trim(); }
    catch { return reply({ error: 'Невалидна заявка.' }, 400); }
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
