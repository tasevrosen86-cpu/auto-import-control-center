// Full deletion of one «Обяви» draft.
//
// The database does the work: `purge_mobile_bg_draft` removes the draft row and
// everything that cascades from it, clears the dedup rows other drafts hold
// against it, and queues the files on the VPS for `services/mobile-bg-cleanup`.
// This module only calls the two functions and turns their answers into
// something the screen can show.

import { supabase } from '@/lib/supabase';

export interface PurgePreview {
  draft_id: string;
  title: string | null;
  status: string;
  mobile_bg_url: string | null;
  is_published: boolean;
  fields: number;
  extras: number;
  images: number;
  selected_images: number;
  action_log: number;
  dedup_checks: number;
  intake_jobs: number;
  publish_jobs: number;
  running_jobs: number;
  dedup_links_elsewhere: number;
  bytes_estimate: number;
  blocked: boolean;
}

export interface PurgeResult {
  draft_id: string;
  title: string | null;
  purge_job_id: string;
  dedup_links_cleared: number;
  deleted: PurgePreview;
}

// Postgres raises these itself, so the reason survives the round trip.
const SUPABASE_ERROR_BG: Record<string, string> = {
  P0002: 'Черновата не е намерена. Може би вече е изтрита — презареди списъка.',
  P0001: 'Черновата се публикува в момента. Изчакай публикуването да приключи и опитай пак.',
};

export function purgeErrorMessage(error: unknown): string {
  if (!error) return 'Изтриването не успя по неизвестна причина.';
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
  for (const [code, text] of Object.entries(SUPABASE_ERROR_BG)) {
    if (message.includes(code)) return text;
  }
  return message;
}

export async function previewDraftPurge(draftId: string): Promise<PurgePreview> {
  const { data, error } = await supabase.rpc('mobile_bg_draft_purge_preview', { p_draft_id: draftId });
  if (error) throw new Error(purgeErrorMessage(error));
  return data as PurgePreview;
}

export async function purgeDraft(draftId: string, actor: string): Promise<PurgeResult> {
  const { data, error } = await supabase.rpc('purge_mobile_bg_draft', {
    p_draft_id: draftId,
    p_actor: actor,
  });
  if (error) throw new Error(purgeErrorMessage(error));
  return data as PurgeResult;
}

// What the confirmation actually lists, so nothing is deleted without the person
// seeing the size of it first.
export function purgeSummaryLines(preview: PurgePreview): string[] {
  const lines: string[] = [];
  const push = (count: number, one: string, many: string) => {
    if (count > 0) lines.push(`${count} ${count === 1 ? one : many}`);
  };
  push(preview.images, 'снимка', 'снимки');
  push(preview.fields, 'поле', 'полета');
  push(preview.extras, 'екстра', 'екстри');
  push(preview.publish_jobs, 'задача за публикуване', 'задачи за публикуване');
  push(preview.intake_jobs, 'задача за извличане', 'задачи за извличане');
  push(preview.action_log, 'запис в дневника', 'записа в дневника');
  push(preview.dedup_checks, 'проверка за дубликат', 'проверки за дубликати');
  if (preview.dedup_links_elsewhere > 0) {
    lines.push(`${preview.dedup_links_elsewhere} връзки от други чернови ще бъдат изчистени`);
  }
  if (lines.length === 0) lines.push('няма свързани данни');
  return lines;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
