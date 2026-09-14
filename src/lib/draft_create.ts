import { MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import { analyzeSourceUrl, type IntakeSourceType } from '@/lib/source_intake';
import { supabase } from '@/lib/supabase';

export type IntakeOrigin = 'LINK_FIELD' | 'ADMIN_CATALOG' | 'BROKER_LINK';

export type SourceIntakeContext = {
  origin: IntakeOrigin;
  catalogPermanentId?: number;
  title?: string;
  fields?: Record<string, string>;
  fieldSources?: Record<string, string>;
};

export type CreateDraftFromSourceInput = {
  sourceUrl: string;
  context: SourceIntakeContext;
};

export type CreatedSourceDraft = {
  id: string;
  sourceType: IntakeSourceType;
  sourceUrl: string;
  sourceListingId: string | null;
  wasCreated: boolean;
};

// Every source enters here: a pasted broker link or a catalog link prefilled
// for an administrator. The database owns deduplication and job creation.
export async function createDraftFromSourceUrl(input: CreateDraftFromSourceInput): Promise<CreatedSourceDraft> {
  const intake = analyzeSourceUrl(input.sourceUrl);
  const { data, error: queueError } = await supabase.functions.invoke('queue-source-intake', {
    body: {
      source_url: intake.sourceUrl,
      intake_origin: input.context.origin,
      catalog_permanent_id: input.context.catalogPermanentId ?? null,
      title: input.context.title ?? null,
    },
  });
  if (queueError) throw queueError;

  const queued = Array.isArray(data) ? data[0] : data;
  const draftId = queued?.draft_id as string | undefined;
  const wasCreated = Boolean(queued?.was_created);
  if (!draftId) throw new Error('Заявката за извличане не върна чернова.');

  const sourceFields = input.context.fields || {};
  const fieldRows = MOBILE_BG_FIELD_MAP
    .filter(field => field.section !== 'extras')
    .filter(field => Boolean(sourceFields[field.key]))
    .map(field => ({
      draft_id: draftId,
      field_key: field.key,
      mobile_bg_label: field.mobile_bg_label,
      our_db_key: field.our_db_key,
      value: sourceFields[field.key],
      field_type: field.field_type,
      source: input.context.fieldSources?.[field.key] || field.source,
      proof: intake.sourceUrl,
      validation_status: 'pending',
      filled_at: new Date().toISOString(),
      is_manual_edit: false,
    }));
  if (wasCreated && fieldRows.length) {
    const { error } = await supabase.from('mobile_bg_draft_fields').upsert(fieldRows, { onConflict: 'draft_id,field_key' });
    if (error) throw error;
  }

  return { id: draftId, sourceType: intake.sourceType, sourceUrl: intake.sourceUrl, sourceListingId: intake.sourceListingId, wasCreated };
}
