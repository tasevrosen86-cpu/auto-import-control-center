import { MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import type { DraftSeed } from '@/lib/draft_seed';
import { analyzeSourceUrl, type IntakeSourceType } from '@/lib/source_intake';
import { supabase } from '@/lib/supabase';

export type IntakeOrigin = 'LINK_FIELD' | 'BROKER_LINK';

// Mobile.bg accepts at most 17 photos per listing. The cap is also enforced on
// mobile_bg_draft_images by a database trigger, so this is only what the broker
// should see by default, not the last line of defence.
const MOBILE_BG_MAX_PHOTOS = 17;

export type CreatedSourceDraft = {
  id: string;
  sourceType: IntakeSourceType;
  sourceUrl: string;
  sourceListingId: string | null;
  wasCreated: boolean;
};

function fieldRows(draftId: string, fields: Record<string, string>, fieldSources: Record<string, string>, proof: string) {
  return MOBILE_BG_FIELD_MAP
    .filter(field => field.section !== 'extras')
    .filter(field => Boolean(fields[field.key]))
    .map(field => ({
      draft_id: draftId,
      field_key: field.key,
      mobile_bg_label: field.mobile_bg_label,
      our_db_key: field.our_db_key,
      value: fields[field.key],
      field_type: field.field_type,
      source: fieldSources[field.key] || 'catalog',
      proof,
      validation_status: 'pending',
      filled_at: new Date().toISOString(),
      is_manual_edit: false,
    }));
}

/**
 * Catalog path: the already stored catalog JSON is parsed by createDraftSeed
 * before this call. No URL extraction job is created and the link field is not
 * involved.
 */
export async function createDraftFromCatalog(seed: DraftSeed): Promise<string> {
  const intake = seed.sourceUrl ? analyzeSourceUrl(seed.sourceUrl) : null;
  const { data: draft, error: draftError } = await supabase
    .from('mobile_bg_drafts')
    .insert({
      catalog_permanent_id: seed.catalogPermanentId,
      title: seed.title,
      status: 'DRAFT',
      source_type: intake?.sourceType || 'catalog',
      source_url: seed.sourceUrl,
      source_listing_id: intake?.sourceListingId || null,
      intake_origin: 'ADMIN_CATALOG',
      extraction_status: 'CATALOG_JSON_READY',
      source_domain: intake?.sourceDomain || 'catalog',
      created_by: 'Catalog JSON',
    })
    .select('id')
    .single();

  if (draftError || !draft) throw new Error(draftError?.message || 'Черновата от Каталога не беше създадена.');

  const rows = fieldRows(draft.id, seed.fields, seed.fieldSources, seed.sourceUrl || `catalog:${seed.catalogPermanentId}`);
  if (rows.length) {
    const { error } = await supabase.from('mobile_bg_draft_fields').upsert(rows, { onConflict: 'draft_id,field_key' });
    if (error) throw new Error(error.message);
  }

  if (seed.images?.length) {
    // Every downloaded photo is kept so the broker can swap picks, but only the
    // first 17 start selected: Mobile.bg accepts no more than that, and a draft
    // whose selection already exceeds it would be silently trimmed at publish
    // instead of in front of the broker.
    const ordered = [...seed.images].sort((a, b) => a.display_order - b.display_order);
    const imageRows = ordered.map((image, index) => ({
      draft_id: draft.id,
      source_url: image.source_url,
      local_path: null,
      converted_jpg: false,
      is_selected: index < MOBILE_BG_MAX_PHOTOS,
      is_main: image.is_main,
      display_order: image.display_order,
      real_car_photo_check: false,
      processing_status: 'pending',
      size_bytes: null,
    }));
    const { error } = await supabase.from('mobile_bg_draft_images').insert(imageRows);
    if (error) throw new Error(error.message);
  }

  const { error: logError } = await supabase.from('mobile_bg_draft_action_log').insert({
    draft_id: draft.id,
    action: 'CATALOG_JSON_DRAFT_CREATED',
    actor: 'Catalog',
    details: {
      catalog_permanent_id: seed.catalogPermanentId,
      field_count: rows.length,
      source_url: seed.sourceUrl,
    },
  });
  if (logError) throw new Error(logError.message);
  return draft.id;
}

/**
 * Manual path shared by Обяви and Broker Access. It only queues a source URL;
 * the source-intake worker fetches the listing and sends its JSON to ingestion.
 */
export async function createDraftFromSourceUrl(sourceUrl: string, origin: IntakeOrigin, catalog?: { permanentId: number; title: string }): Promise<CreatedSourceDraft> {
  const intake = analyzeSourceUrl(sourceUrl);
  const { data, error: queueError } = await supabase.functions.invoke('queue-source-intake', {
    body: { source_url: intake.sourceUrl, intake_origin: origin, catalog_permanent_id: catalog?.permanentId, title: catalog?.title },
  });
  if (queueError) throw queueError;

  const queued = Array.isArray(data) ? data[0] : data;
  const draftId = queued?.draft_id as string | undefined;
  const wasCreated = Boolean(queued?.was_created);
  if (!draftId) throw new Error('Заявката за извличане не върна чернова.');

  return {
    id: draftId,
    sourceType: intake.sourceType,
    sourceUrl: intake.sourceUrl,
    sourceListingId: intake.sourceListingId,
    wasCreated,
  };
}
