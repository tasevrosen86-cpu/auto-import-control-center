import { useEffect, useState } from 'react';
import { ChevronRight, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { MobileBgPublishJob, MobileBgApiTraceEntry } from '@/types';

// Diagnostics for the «Обяви» API publishing path.
//
// This panel exists so a real run can be followed step by step without reading
// server logs. It shows the request that went out — endpoint, HTTP status,
// Mobile.bg's own answer — and the fields that were sent, and it names the exact
// step a run stopped on.
//
// Nothing secret is ever rendered. The trace comes from the worker, which
// redacts the token, the password and the username before writing anything, and
// this panel would show only what the trace holds. So it deliberately has no
// access to credentials and no way to read them.

type Props = {
  draftId: string;
  onBack: () => void;
};

const STEP_LABELS: Record<string, string> = {
  LOGIN: 'Вход в Mobile.bg',
  FIELDS: 'Проверка на полетата',
  PUBLISH: 'Публикуване на обявата',
  PICTURES: 'Снимки към обявата',
  VERIFY: 'Проверка на обявата',
  LOGOUT: 'Затваряне на сесията',
};

const STEP_ORDER = ['LOGIN', 'FIELDS', 'PUBLISH', 'PICTURES', 'VERIFY', 'LOGOUT'];

const STATUS_LABELS: Record<string, string> = {
  QUEUED: 'Чака изпълнение',
  RUNNING: 'Изпълнява се',
  COMPLETED: 'Успешно публикувана',
  FAILED: 'Провали се',
  NEEDS_PUBLISHING: 'Нужна е корекция',
  NEEDS_LOGIN: 'Нужен е вход',
  NEEDS_HUMAN_REVIEW: 'Нужна е ръчна проверка',
  PREVIEW_READY: 'Преглед готов',
};

const STATUS_COLORS: Record<string, string> = {
  QUEUED: 'bg-slate-100 text-slate-700 border-slate-200',
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
  NEEDS_PUBLISHING: 'bg-amber-50 text-amber-800 border-amber-200',
  NEEDS_LOGIN: 'bg-amber-50 text-amber-800 border-amber-200',
  NEEDS_HUMAN_REVIEW: 'bg-orange-50 text-orange-800 border-orange-200',
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] || 'bg-slate-100 text-slate-700 border-slate-200';
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

function httpColor(status: number | null): string {
  if (status === null) return 'text-slate-400';
  if (status < 300) return 'text-emerald-600';
  if (status < 500) return 'text-amber-600';
  return 'text-rose-600';
}

// The steps are shown in their fixed order rather than in the order they arrived,
// so a run that stopped early leaves the remaining steps visibly untouched — the
// single most useful thing on this screen.
function stepState(step: string, entries: MobileBgApiTraceEntry[]) {
  const own = entries.filter(entry => entry.step === step);
  if (own.length === 0) {
    const reached = entries.some(entry => STEP_ORDER.indexOf(entry.step) > STEP_ORDER.indexOf(step));
    return reached ? 'skipped' : 'pending';
  }
  return own.every(entry => entry.ok) ? 'ok' : 'failed';
}

export function ApiPublishDiagnostics({ draftId, onBack }: Props) {
  const [job, setJob] = useState<MobileBgPublishJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    const { data } = await supabase
      .from('mobile_bg_publish_jobs')
      .select('*')
      .eq('draft_id', draftId)
      .eq('transport', 'OFFICIAL_API')
      .maybeSingle();
    setJob((data as MobileBgPublishJob) || null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
    // A run is short but not instant, and this screen is opened to watch it.
    // Polling stops once the job reaches a terminal status.
    const timer = setInterval(() => {
      setJob(current => {
        if (current && !['QUEUED', 'RUNNING'].includes(current.status)) return current;
        void load();
        return current;
      });
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const trace = (job?.api_trace || []) as MobileBgApiTraceEntry[];
  const running = job ? ['QUEUED', 'RUNNING'].includes(job.status) : false;
  const result = (job?.result || {}) as Record<string, unknown>;
  const notes = Array.isArray(result.notes) ? (result.notes as string[]) : [];
  const sentParams = Array.isArray(result.sent_params) ? (result.sent_params as string[]) : [];
  const droppedParams = Array.isArray(result.dropped_params) ? (result.dropped_params as string[]) : [];
  const readiness = Array.isArray(result.readiness)
    ? (result.readiness as Array<{ severity: string; message: string }>)
    : [];
  const pictures = Array.isArray(result.pictures)
    ? (result.pictures as Array<{ path: string; ok: boolean; reason?: string | null; bytes?: number }>)
    : [];
  const listingId = (result.listing_id as string) || job?.listing_id || null;
  const listingUrl = (result.listing_url as string) || null;
  const stage = (result.stage as string) || null;
  const uploaded = typeof result.uploaded_pictures === 'number' ? result.uploaded_pictures : null;
  const verified = typeof result.verified === 'boolean' ? result.verified : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Назад
          </button>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Диагностика на API публикуването</h2>
            <p className="text-xs text-slate-500">Официално Mobile.bg API · чернова {draftId.slice(0, 8)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job && <span className={`rounded-md border px-2 py-1 text-xs font-bold ${statusColor(job.status)}`}>{statusLabel(job.status)}</span>}
          <button onClick={() => void load(true)} disabled={refreshing} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Опресни
          </button>
        </div>
      </div>

      {loading && <div className="rounded-md border border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">Зареждане…</div>}

      {!loading && !job && (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
          Няма API заявка за тази чернова. Натисни „Публикувай през Mobile.bg API“ в черновата.
        </div>
      )}

      {job && (
        <>
          {running && (
            <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              <span>Изпълнява се — екранът се обновява сам. Опит {job.attempt_count}.</span>
            </div>
          )}

          {/* The step ladder: which step ran, and on which one the run stopped. */}
          <div className="rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3 py-2">
              <h3 className="text-sm font-bold text-slate-800">Стъпки</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {STEP_ORDER.map(step => {
                const state = stepState(step, trace);
                const entries = trace.filter(entry => entry.step === step);
                return (
                  <div key={step} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {state === 'ok' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                      {state === 'failed' && <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
                      {state === 'pending' && <Clock className="h-4 w-4 shrink-0 text-slate-300" />}
                      {state === 'skipped' && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                      <span className={`text-xs font-bold ${state === 'pending' ? 'text-slate-400' : 'text-slate-800'}`}>
                        {STEP_LABELS[step] || step}
                      </span>
                      {state === 'pending' && !running && <span className="text-[10px] text-slate-400">не е изпълнена</span>}
                      {state === 'skipped' && <span className="text-[10px] text-amber-600">пропусната</span>}
                    </div>

                    {entries.map((entry, index) => (
                      <div key={`${entry.at}-${index}`} className="ml-6 mt-1.5 rounded border border-slate-100 bg-slate-50/60 px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="font-semibold text-slate-700">{entry.label}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 border border-slate-200">{entry.method}</span>
                          <span className="break-all font-mono text-[10px] text-slate-500">{entry.path}</span>
                          <span className={`font-mono text-[10px] font-bold ${httpColor(entry.http_status)}`}>
                            HTTP {entry.http_status ?? '—'}
                          </span>
                          {entry.api_status && (
                            <span className={`font-mono text-[10px] ${entry.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                              status: {entry.api_status}
                            </span>
                          )}
                        </div>
                        {entry.api_msg && <p className="mt-1 text-[11px] text-rose-700">Mobile.bg: {entry.api_msg}</p>}
                        {entry.response_excerpt && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-700">Отговор от Mobile.bg</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-1.5 text-[10px] text-slate-600 border border-slate-200">{entry.response_excerpt}</pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Where it stopped and what to do, in one sentence. */}
          {(job.last_error || stage) && (
            <div className={`rounded-md border px-3 py-2 text-xs ${job.status === 'COMPLETED' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              {stage && <p className="font-bold">Спря на стъпка: {STEP_LABELS[stage] || stage}</p>}
              {job.last_error && <p className="mt-0.5">{job.last_error}</p>}
              {job.status === 'COMPLETED' && <p>Обявата е приета и прочетена обратно от Mobile.bg.</p>}
            </div>
          )}

          {/* Result summary */}
          {(listingId || uploaded !== null || verified !== null) && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <h3 className="mb-1 text-sm font-bold text-slate-800">Резултат</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                {listingId && <span><span className="font-bold">ID в Mobile.bg:</span> {listingId}</span>}
                {listingUrl && <a href={listingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">Отвори обявата</a>}
                {uploaded !== null && <span><span className="font-bold">Приети снимки:</span> {uploaded}</span>}
                {verified !== null && <span><span className="font-bold">Прочетена обратно:</span> {verified ? 'да' : 'не'}</span>}
              </div>
            </div>
          )}

          {/* Readiness: what was checked before anything was sent. */}
          {readiness.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <h3 className="mb-1 text-sm font-bold text-slate-800">Проверка преди изпращане</h3>
              <ul className="space-y-1">
                {readiness.map((issue, index) => (
                  <li key={index} className={`text-xs ${issue.severity === 'blocker' ? 'text-rose-700' : 'text-amber-700'}`}>
                    {issue.severity === 'blocker' ? '✖ ' : '⚠ '}{issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Which parameters went out, and which were dropped. This is the list
              a first real run is read for: it reveals Mobile.bg's real schema. */}
          {(sentParams.length > 0 || droppedParams.length > 0) && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <h3 className="mb-1 text-sm font-bold text-slate-800">Изпратени задължителни полета</h3>
              <p className="text-xs text-slate-700">{sentParams.length > 0 ? sentParams.join(', ') : '—'}</p>
              {droppedParams.length > 0 && (
                <>
                  <p className="mt-1 text-[11px] font-bold text-amber-700">Пропуснати (непознати за категорията)</p>
                  <p className="text-xs text-amber-700">{droppedParams.join(', ')}</p>
                </>
              )}
            </div>
          )}

          {pictures.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <h3 className="mb-1 text-sm font-bold text-slate-800">Снимки</h3>
              <ul className="space-y-0.5">
                {pictures.map((picture, index) => (
                  <li key={index} className={`flex flex-wrap items-center gap-2 text-[11px] ${picture.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                    <span>{picture.ok ? '✔' : '✖'}</span>
                    <span className="break-all font-mono">{picture.path}</span>
                    {picture.reason && <span className="text-rose-700">— {picture.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <h3 className="mb-1 text-sm font-bold text-slate-800">Дневник на изпълнението</h3>
              <ul className="space-y-0.5">
                {notes.map((note, index) => (
                  <li key={index} className="text-[11px] text-slate-600">{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* A failed run keeps its draft. Retrying is a separate transport so the
              browser path is not touched, and a listing that already exists is
              reused rather than republished. */}
          {!running && ['NEEDS_PUBLISHING', 'FAILED', 'NEEDS_HUMAN_REVIEW'].includes(job.status) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-bold">Черновата е запазена.</p>
              <p className="mt-0.5">
                Нищо не е загубено. Коригирай полетата в черновата и натисни „Публикувай през Mobile.bg API“ отново.
                {job.listing_id || result.listing_id
                  ? ` Обявата вече съществува с ID ${job.listing_id || result.listing_id} и повторният опит ще добави само снимките, без да създава втора обява.`
                  : ''}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
