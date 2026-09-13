import { MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import { analyzeSourceUrl, type IntakeSourceType } from '@/lib/source_intake';
import { supabase } from '@/lib/supabase';

export type DraftOrigin = 'DIRECT_LINK' | 'CATALOG';

export type CreateDraftFromSourceInput = {
  sourceUrl: string;
  origin: DraftOrigin;
  title?: string;
  catalogPermanentId?: number;
  fields?: Record<string, string>;
  fieldSources?: Record<string, string>;
  createdBy?: string;
};

export type CreatedSourceDraft = {
  id: string;
  sourceType: IntakeSourceType;
  sourceUrl: string;
  sourceListingId: string | null;
};

// The single intake path for pasted links and catalog buttons. It records the
// source immediately and leaves actual extraction to the private JSON script.
export async function createDraftFromSourceUrl(input: CreateDraftFromSourceInput): Promise<CreatedSourceDraft> {
  const intake = analyzeSourceUrl(input.sourceUrl);
  const title = input.title || `Изчаква извличане — ${intake.sourceLabel}${intake.sourceListingId ? ` #${intake.sourceListingId}` : ''}`;
  const { data: draft, error: draftError } = await supabase.from('mobile_bg_drafts').insert({
    catalog_permanent_id: input.catalogPermanentId ?? null,
    title,
    status: 'DRAFT',
    source_type: intake.sourceType,
    source_url: intake.sourceUrl,
    source_listing_id: intake.sourceListingId,
    intake_origin: input.origin,
    extraction_status: 'SOURCE_PENDING',
    source_domain: intake.sourceDomain,
    created_by: input.createdBy || 'Росен',
  }).select('id').single();
  if (draftError || !draft) throw draftError || new Error('Черновата не беше създадена.');

  const sourceFields = input.fields || {};
  const fieldRows = MOBILE_BG_FIELD_MAP
    .filter(field => field.section !== 'extras')
    .filter(field => Boolean(sourceFields[field.key]))
    .map(field => ({
      draft_id: draft.id,
      field_key: field.key,
      mobile_bg_label: field.mobile_bg_label,
      our_db_key: field.our_db_key,
      value: sourceFields[field.key],
      field_type: field.field_type,
      source: input.fieldSources?.[field.key] || field.source,
      proof: intake.sourceUrl,
      validation_status: 'pending',
      filled_at: new Date().toISOString(),
      is_manual_edit: false,
    }));
  if (fieldRows.length) {
    const { error } = await supabase.from('mobile_bg_draft_fields').insert(fieldRows);
    if (error) throw error;
  }

  const { error: jobError } = await supabase.from('source_listing_jobs').insert({
    draft_id: draft.id,
    source_type: intake.sourceType,
    source_url: intake.sourceUrl,
    status: 'QUEUED',
  });
  if (jobError) throw jobError;

  const action = input.origin === 'CATALOG' ? 'CATALOG_PUBLISH_REQUEST_QUEUED' : 'SOURCE_INTAKE_QUEUED';
  const { error: logError } = await supabase.from('mobile_bg_draft_action_log').insert({
    draft_id: draft.id,
    action,
    actor: input.createdBy || 'Росен',
    details: {
      intake_origin: input.origin,
      source_type: intake.sourceType,
      source_url: intake.sourceUrl,
      source_listing_id: intake.sourceListingId,
      catalog_permanent_id: input.catalogPermanentId ?? null,
    },
  });
  if (logError) throw logError;

  return { id: draft.id, sourceType: intake.sourceType, sourceUrl: intake.sourceUrl, sourceListingId: intake.sourceListingId };
}
