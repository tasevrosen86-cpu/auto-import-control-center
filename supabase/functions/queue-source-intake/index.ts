import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from 'npm:@supabase/server';

type IntakeOrigin = 'LINK_FIELD' | 'ADMIN_CATALOG' | 'BROKER_LINK';

type IntakeRequest = {
  source_url?: unknown;
  intake_origin?: unknown;
  catalog_permanent_id?: unknown;
  title?: unknown;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://autoimportcontrolcenter.biz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
  });
}

function sourceFromUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Линкът не е валиден URL адрес.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const canonical = parsed.toString();
  if (host === 'encar.com' || host.endsWith('.encar.com')) {
    const match = parsed.pathname.match(/(?:cars\/detail|detail)\/(\d+)/i);
    return {
      sourceUrl: canonical,
      sourceType: 'encar',
      sourceDomain: 'encar.com',
      sourceListingId: match?.[1] ?? null,
    };
  }

  if (host === 'autotrader.ca' || host.endsWith('.autotrader.ca')) {
    const uuid = parsed.pathname.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0];
    const listingId = uuid ?? parsed.searchParams.get('id');
    return {
      sourceUrl: canonical,
      sourceType: 'autotrader_ca',
      sourceDomain: 'autotrader.ca',
      sourceListingId: listingId || null,
    };
  }

  throw new Error('Поддържат се само линкове от Encar и AutoTrader Canada.');
}

function intakeOrigin(value: unknown): IntakeOrigin {
  return value === 'ADMIN_CATALOG' || value === 'BROKER_LINK' || value === 'LINK_FIELD'
    ? value
    : 'LINK_FIELD';
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Използвайте POST.' }, 405);

    let payload: IntakeRequest;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Невалидна заявка.' }, 400);
    }

    const rawUrl = typeof payload.source_url === 'string' ? payload.source_url.trim() : '';
    if (!rawUrl || rawUrl.length > 2_000) return json({ error: 'Въведи валиден линк към обявата.' }, 400);

    let source;
    try {
      source = sourceFromUrl(rawUrl);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Невалиден линк.' }, 400);
    }

    const catalogPermanentId = Number.isInteger(payload.catalog_permanent_id) && Number(payload.catalog_permanent_id) > 0
      ? Number(payload.catalog_permanent_id)
      : null;
    const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 240) : null;

    const { data, error } = await ctx.supabaseAdmin.rpc('queue_source_intake', {
      p_source_url: source.sourceUrl,
      p_source_type: source.sourceType,
      p_source_domain: source.sourceDomain,
      p_source_listing_id: source.sourceListingId,
      p_intake_origin: intakeOrigin(payload.intake_origin),
      p_catalog_permanent_id: catalogPermanentId,
      p_title: title,
      p_requested_by: ctx.userClaims!.id,
    });

    if (error) return json({ error: 'Неуспешно добавяне към опашката.', detail: error.message }, 500);
    const queued = Array.isArray(data) ? data[0] : data;
    if (!queued?.draft_id) return json({ error: 'Не бе създадена чернова.' }, 500);

    return json(queued, 201);
  }),
};
