import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from 'npm:@supabase/server';

const ADMIN_EMAIL = 'tasevrosen86@gmail.com';
const cors = {
  'Access-Control-Allow-Origin': 'https://autoimportcontrolcenter.biz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });

/**
 * The publication tables are intentionally read-only from the browser.  This
 * narrow authenticated endpoint gives the owner the same manual draft controls
 * as the proven "Обяви" editor without exposing write policies to other users.
 */
export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'Използвайте POST.' }, 405);
    if (ctx.userClaims?.email?.toLowerCase() !== ADMIN_EMAIL) return reply({ error: 'Нямате достъп.' }, 403);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return reply({ error: 'Невалидна заявка.' }, 400); }
    const draftId = typeof body.draft_id === 'string' ? body.draft_id : '';
    const action = typeof body.action === 'string' ? body.action : '';
    if (!draftId || !['toggle_extra', 'update_image'].includes(action)) return reply({ error: 'Невалидна редакция.' }, 400);

    const { data: draft, error: draftError } = await ctx.supabaseAdmin
      .from('publication_drafts').select('id').eq('id', draftId).eq('owner_id', ctx.userClaims.id).maybeSingle();
    if (draftError || !draft) return reply({ error: 'Черновата не е намерена.' }, 404);
    const now = new Date().toISOString();

    if (action === 'toggle_extra') {
      const key = typeof body.extra_key === 'string' ? body.extra_key.trim() : '';
      const label = typeof body.mobile_bg_label === 'string' ? body.mobile_bg_label.trim() : '';
      const group = typeof body.group_name === 'string' ? body.group_name.trim() : 'Други';
      if (!key || !label || typeof body.selected !== 'boolean') return reply({ error: 'Екстрата не е валидна.' }, 400);
      const { error } = await ctx.supabaseAdmin.from('publication_draft_extras').upsert({
        draft_id: draft.id, extra_key: key, mobile_bg_label: label, group_name: group || 'Други',
        selected: body.selected, source: 'manual', proof: 'Ръчно избрана в Публикации',
      }, { onConflict: 'draft_id,extra_key' });
      if (error) return reply({ error: 'Екстрата не бе запазена.', detail: error.message }, 500);
      await ctx.supabaseAdmin.from('publication_draft_action_log').insert({ draft_id: draft.id, action: 'PUBLICATION_EXTRA_EDITED', actor: 'Admin', details: { key, selected: body.selected, at: now } });
      return reply({ ok: true });
    }

    const imageId = typeof body.image_id === 'string' ? body.image_id : '';
    if (!imageId) return reply({ error: 'Снимката не е валидна.' }, 400);
    const { data: image, error: imageError } = await ctx.supabaseAdmin
      .from('publication_draft_images').select('id').eq('id', imageId).eq('draft_id', draft.id).maybeSingle();
    if (imageError || !image) return reply({ error: 'Снимката не е намерена.' }, 404);

    const changes: Record<string, boolean> = {};
    for (const key of ['is_selected', 'is_main', 'real_car_photo_check']) if (typeof body[key] === 'boolean') changes[key] = body[key] as boolean;
    if (!Object.keys(changes).length) return reply({ error: 'Няма промяна за запазване.' }, 400);
    if (changes.is_main) {
      const { error } = await ctx.supabaseAdmin.from('publication_draft_images').update({ is_main: false }).eq('draft_id', draft.id);
      if (error) return reply({ error: 'Основната снимка не бе сменена.', detail: error.message }, 500);
      changes.is_selected = true;
    }
    const { error } = await ctx.supabaseAdmin.from('publication_draft_images').update(changes).eq('id', image.id);
    if (error) return reply({ error: 'Снимката не бе запазена.', detail: error.message }, 500);
    await ctx.supabaseAdmin.from('publication_draft_action_log').insert({ draft_id: draft.id, action: 'PUBLICATION_IMAGE_EDITED', actor: 'Admin', details: { image_id: image.id, ...changes, at: now } });
    return reply({ ok: true });
  }),
};
