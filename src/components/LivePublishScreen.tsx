import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime } from '@/lib/format';
import { MOBILE_BG_FIELD_MAP } from '@/lib/mobile_bg_field_map';
import { Badge } from '@/components/Badge';
import type { MobileBgDraft, MobileBgDraftImage, MobileBgPublishJob } from '@/types';

type StageEntry = { text: string; at: string };
type LiveState = { stage?: string; frame?: string | null; frame_at?: string };
type SkippedField = { key: string; value?: string; reason: string };

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  MOBILE_BG_FIELD_MAP.map(field => [field.key, field.mobile_bg_label]),
);

// Extras are reported as "extra:Лизинг"; the key is not a field key, so it is
// shown with a readable prefix instead of the raw identifier.
function fieldLabel(key: string) {
  if (key.startsWith('extra:')) return `Екстра: ${key.slice('extra:'.length)}`;
  return FIELD_LABELS[key] || key;
}

function isTerminal(status: string | undefined) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'NEEDS_LOGIN' || status === 'NEEDS_CONFIGURATION' || status === 'PREVIEW_READY';
}

function statusBadge(status: string) {
  if (status === 'COMPLETED') return { color: 'emerald' as const, text: 'Публикувано' };
  if (status === 'RUNNING') return { color: 'blue' as const, text: 'Публикувам в момента' };
  if (status === 'QUEUED') return { color: 'amber' as const, text: 'Чака изпълнение' };
  return { color: 'rose' as const, text: 'Спряно' };
}

const TERMINAL_HEADLINES: Record<string, string> = {
  COMPLETED: 'Mobile.bg потвърди обявата.',
  NEEDS_LOGIN: 'Нужен е вход в Mobile.bg на сървъра.',
  NEEDS_CONFIGURATION: 'Публикуването спря и чака корекция.',
  FAILED: 'Публикуването не завърши.',
  PREVIEW_READY: 'Стъпка 1 е попълнена без изпращане.',
};

export function LivePublishScreen({ draftId, onBack }: { draftId: string; onBack: () => void }) {
  const [draft, setDraft] = useState<MobileBgDraft | null>(null);
  const [job, setJob] = useState<MobileBgPublishJob | null>(null);
  const [images, setImages] = useState<MobileBgDraftImage[]>([]);
  const [stages, setStages] = useState<StageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const lastStageRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const [dRes, jRes, iRes] = await Promise.all([
      supabase.from('mobile_bg_drafts').select('*').eq('id', draftId).maybeSingle(),
      supabase.from('mobile_bg_publish_jobs').select('*').eq('draft_id', draftId).maybeSingle(),
      supabase.from('mobile_bg_draft_images').select('*').eq('draft_id', draftId).order('display_order'),
    ]);
    setDraft((dRes.data || null) as MobileBgDraft | null);
    setJob((jRes.data || null) as MobileBgPublishJob | null);
    setImages((iRes.data || []) as MobileBgDraftImage[]);
    const live = ((jRes.data?.result || {}) as Record<string, unknown>).live as LiveState | undefined;
    // The worker rewrites the same text on every heartbeat; only a new message
    // belongs in the timeline, otherwise the log fills with duplicates.
    if (live?.stage && live.stage !== lastStageRef.current) {
      lastStageRef.current = live.stage;
      setStages(previous => [...previous, { text: live.stage as string, at: live.frame_at || new Date().toISOString() }]);
    }
    setLoading(false);
  }, [draftId]);

  useEffect(() => { void load(); }, [load]);

  // The worker writes from another process and there is no Realtime channel on
  // this table, so the open screen polls while the run is active and stops as
  // soon as it reaches a terminal state.
  useEffect(() => {
    if (isTerminal(job?.status)) return;
    const timer = setInterval(() => { void load(); }, 2000);
    return () => clearInterval(timer);
  }, [job?.status, load]);

  const badge = statusBadge(job?.status || 'QUEUED');
  const result = (job?.result || {}) as Record<string, unknown>;
  const live = (result.live || {}) as LiveState;
  const uploaded = Number((result.image_upload as { uploaded?: number } | undefined)?.uploaded || 0);
  const listingUrl = typeof result.listing_url === 'string' ? result.listing_url : draft?.mobile_bg_url || null;
  const listingId = draft?.mobile_bg_listing_id || null;
  const errorText = job?.last_error || null;
  const selectedCount = images.filter(image => image.is_selected).length;
  const filled = Array.isArray(result.filled) ? result.filled as string[] : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped as SkippedField[] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="inline h-3.5 w-3.5" /> Назад към черновата
          </button>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Публикуване в Mobile.bg</h2>
            <p className="text-sm text-slate-500 mt-0.5">{draft?.title || `Чернова ${draftId.slice(0, 8)}`}</p>
          </div>
        </div>
        <Badge color={badge.color}>{badge.text}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            {isTerminal(job?.status) ? (
              job?.status === 'COMPLETED'
                ? <CheckCircle className="h-4 w-4 text-emerald-500" />
                : <XCircle className="h-4 w-4 text-rose-500" />
            ) : <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
            <h3 className="text-sm font-bold text-slate-800">Какво прави браузърът в момента</h3>
          </div>
          <div className="space-y-3 p-3">
            <p className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
              {live.stage || (job?.status === 'QUEUED' ? 'Заявката е в опашката. Изпълнението започва до минута.' : 'Изчаквам първия ред от сървъра…')}
            </p>
            {isTerminal(job?.status) && <p className="text-xs text-slate-700">{TERMINAL_HEADLINES[job!.status]}</p>}
            {errorText && (
              <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <p className="font-bold">Грешка</p>
                <p>{errorText}</p>
              </div>
            )}
            <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2">
              {stages.length === 0 && <p className="text-xs text-slate-400">Още няма преминати етапи.</p>}
              {stages.map((entry, index) => (
                <div key={`${entry.at}-${index}`} className="flex items-start justify-between gap-2 border-b border-white py-1 text-xs text-slate-600">
                  <span>{entry.text}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{formatDateTime(entry.at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <h3 className="text-sm font-bold text-slate-800">Екран на Mobile.bg</h3>
            <span className="text-[10px] text-slate-500">
              {live.frame_at ? `Кадър от ${formatDateTime(live.frame_at)}` : 'Няма кадър'}
            </span>
          </div>
          <div className="p-3">
            {live.frame ? (
              <img src={live.frame} alt="Екран на Mobile.bg" className="w-full rounded border border-slate-200" />
            ) : (
              <div className="flex min-h-40 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
                Снимката на екрана се появява, след като браузърът отвори формата.
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
              <span className="rounded border border-slate-100 bg-slate-50 px-2 py-1">Етап: {job?.status || '—'}</span>
              <span className="rounded border border-slate-100 bg-slate-50 px-2 py-1">Опит: {job?.attempt_count ?? 0}</span>
              <span className="rounded border border-slate-100 bg-slate-50 px-2 py-1">Избрани снимки: {selectedCount}</span>
              <span className="rounded border border-slate-100 bg-slate-50 px-2 py-1">Качени: {uploaded}</span>
            </div>
            {listingUrl && (
              <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-semibold text-blue-600 hover:underline">
                <ExternalLink className="inline h-3 w-3" /> Отвори обявата{listingId ? ` (ID ${listingId})` : ''}
              </a>
            )}
            {loading && <p className="mt-2 text-xs text-slate-400">Зареждане…</p>}
          </div>
        </div>
      </div>

      {/* The worker reports every field it wrote and every field it had to leave
          out with the reason, which is what makes a failure diagnosable without
          reading the server journal. */}
      {(filled.length > 0 || skipped.length > 0) && (
        <div className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <h3 className="text-sm font-bold text-slate-800">Поле по поле</h3>
            <span className="text-[10px] text-slate-500">{filled.length} попълнени · {skipped.length} пропуснати</span>
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-bold text-emerald-700">Попълнени в Mobile.bg</p>
              <div className="max-h-60 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2">
                {filled.length === 0 && <p className="text-xs text-slate-400">Няма попълнени полета.</p>}
                {filled.map(key => (
                  <p key={key} className="border-b border-white py-1 text-xs text-slate-600">{fieldLabel(key)}</p>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-amber-700">Пропуснати</p>
              <div className="max-h-60 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2">
                {skipped.length === 0 && <p className="text-xs text-slate-400">Нищо не е пропуснато.</p>}
                {skipped.map(item => (
                  <div key={item.key} className="border-b border-white py-1 text-xs text-slate-600">
                    <span className="font-semibold">{fieldLabel(item.key)}</span>
                    <span className="text-slate-400"> — {item.reason}</span>
                    {item.value && <p className="text-[10px] text-slate-400">стойност: {item.value.length > 80 ? `${item.value.slice(0, 80)}…` : item.value}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
