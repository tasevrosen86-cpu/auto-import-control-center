import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from 'npm:@supabase/server';

const ADMIN_EMAIL = 'tasevrosen86@gmail.com';
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://autoimportcontrolcenter.biz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });

function sourceFromUrl(raw: string) {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error('Линкът не е валиден URL адрес.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Позволени са само http/https линкове.');
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');

  if (domain === 'autotrader.ca' || domain.endsWith('.autotrader.ca')) {
    const id = parsed.pathname.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0]
      ?? parsed.searchParams.get('id');
    return { source_url: parsed.toString(), source_type: 'autotrader_ca', source_domain: 'autotrader.ca', source_listing_id: id };
  }
  if (domain === 'encar.com' || domain.endsWith('.encar.com')) {
    const id = parsed.pathname.match(/(?:cars\/detail|detail)\/(\d+)/i)?.[1] ?? null;
    return { source_url: parsed.toString(), source_type: 'encar', source_domain: 'encar.com', source_listing_id: id };
  }
  throw new Error('Поддържат се само AutoTrader Canada и Encar.');
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Използвайте POST.' }, 405);
    if (ctx.userClaims?.email?.toLowerCase() !== ADMIN_EMAIL) return json({ error: 'Нямате достъп.' }, 403);

    let rawUrl = '';
    try { rawUrl = String((await request.json()).source_url || '').trim(); }
    catch { return json({ error: 'Невалидна заявка.' }, 400); }
    if (!rawUrl || rawUrl.length > 2000) return json({ error: 'Въведете валиден линк.' }, 400);

    let source;
    try { source = sourceFromUrl(rawUrl); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Невалиден линк.' }, 400); }

    const identity = source.source_domain + '|' +
      (source.source_listing_id || source.source_url.replace(/[?#].*$/, '').toLowerCase());

    const { data: existing, error: existingError } = await ctx.supabaseAdmin
      .from('publication_import_jobs')
      .select('id,status')
      .eq('owner_id', ctx.userClaims.id)
      .eq('source_identity', identity)
      .maybeSingle();

    if (existingError) {
      return json({ error: 'Проверката за дубликат не успя.', detail: existingError.message }, 500);
    }
    if (existing) return json({ id: existing.id, status: existing.status, was_created: false }, 200);

    const { data, error } = await ctx.supabaseAdmin
      .from('publication_import_jobs')
      .insert({
        owner_id: ctx.userClaims.id,
        source_url: source.source_url,
        source_type: source.source_type,
        source_domain: source.source_domain,
        source_listing_id: source.source_listing_id,
        source_identity: identity,
      })
      .select('id,status')
      .single();

    if (error) return json({ error: 'Неуспешно добавяне към опашката.', detail: error.message }, 500);
    return json({ ...data, was_created: true }, 201);
  }),
};
