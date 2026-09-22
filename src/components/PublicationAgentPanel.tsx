import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Loader2, Send, Square } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// The Browser Use agent, driven from «Публикации».
//
// The task goes to our own VPS bridge, never to Browser Use directly: the API
// key lives only in the server environment. The bridge is protected by the same
// signed Admin ticket the visible browser uses, so this panel first asks the
// signed Edge Function for a ticket and then sends it as a query parameter.
//
// A task is created asynchronously. The POST returns a run id immediately and
// this panel polls the status endpoint, so a long task does not hold an HTTP
// request open and a timeout never silently starts a second run.

type RunState = {
  runId: string;
  sessionId: string | null;
  status: string;
  terminal: boolean;
  result: string | null;
  error: string | null;
};

const POLL_MS = 3000;

const statusLabel: Record<string, string> = {
  queued: 'На опашка',
  dispatching: 'Стартира',
  running: 'Работи',
  completed: 'Готово',
  failed: 'Грешка',
  cancelled: 'Прекратено',
};

async function getTicket(): Promise<{ ticket: string } | { error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  // The Edge Function only issues a ticket to the signed Admin. Without a
  // session there is nothing to validate, so fail here rather than at the VPS.
  if (!token) return { error: 'Сесията е изтекла. Влезте отново в сайта.' };

  const { data, error } = await supabase.functions.invoke('publication-browser-access', {
    body: {},
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) return { error: 'Неуспешно създаване на защитен достъп.' };

  const url = typeof data?.browser_url === 'string' ? data.browser_url : '';
  const ticket = url ? new URL(url).searchParams.get('ticket') || '' : '';
  if (!ticket) return { error: 'Сайтът не върна защитен достъп до агента.' };
  return { ticket };
}

async function callAgent(path: string, body: Record<string, unknown>) {
  const ticket = await getTicket();
  if ('error' in ticket) return { ok: false as const, error: ticket.error };

  const response = await fetch(`/publications-browser${path}?ticket=${encodeURIComponent(ticket.ticket)}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false as const, error: payload?.error || 'Агентът не прие заявката.' };
  return { ok: true as const, data: payload };
}

export function PublicationAgentPanel({ draftTitle }: { draftTitle?: string }) {
  const [task, setTask] = useState('');
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [followUp, setFollowUp] = useState('');
  const timer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
  }, []);

  // Polling stops on any terminal status. That is what keeps a finished run from
  // being re-read forever and a failed run from looking like it is still going.
  //
  // Each poll is for a named run, not for "the session": after a follow-up the
  // current run changes, and re-reading the old id would show the old result as
  // if it were the new answer.
  const poll = useCallback(async (runId: string) => {
    const response = await callAgent('/agent/status', { run_id: runId });
    if (!response.ok) return;
    const data = response.data as RunState;
    setRun((current) => (current ? { ...current, ...data, runId } : data));
    if (data.terminal) stopPolling();
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function submit() {
    const text = task.trim();
    if (!text) { setError('Въведете задача за агента.'); return; }
    stopPolling();
    setBusy(true); setError(''); setRun(null);

    const response = await callAgent('/agent', { task: text });
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }

    const created = response.data as { run_id: string; session_id: string | null; status: string };
    const initial: RunState = {
      runId: created.run_id,
      sessionId: created.session_id,
      status: created.status || 'queued',
      terminal: false,
      result: null,
      error: null,
    };
    setRun(initial);
    timer.current = window.setInterval(() => void poll(created.run_id), POLL_MS);
    void poll(created.run_id);
  }

  async function sendFollowUp() {
    const text = followUp.trim();
    if (!text || !run?.sessionId) return;
    stopPolling();
    setBusy(true); setError('');
    const response = await callAgent('/agent/message', { session_id: run.sessionId, run_id: run.runId, text });
    setBusy(false);
    if (!response.ok) { setError(response.error); return; }

    setFollowUp('');
    // The follow-up is a new run in the same session. Polling must switch to
    // that run — the old id is already terminal and would return the old result
    // immediately, which reads as a successful answer and is not one.
    const next = response.data as { run_id: string | null; started: boolean };
    if (!next.run_id || !next.started) {
      setError('Съобщението е прието, но новият run още не е започнал. Изчакайте и продължете отново.');
      return;
    }
    setRun((current) => (current ? { ...current, runId: next.run_id!, status: 'queued', terminal: false, result: null, error: null } : current));
    timer.current = window.setInterval(() => void poll(next.run_id!), POLL_MS);
    void poll(next.run_id!);
  }

  const running = Boolean(run && !run.terminal);
  const label = run ? statusLabel[run.status] || run.status : '';
  const result = useMemo(() => run?.result?.trim() || '', [run]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-3 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
          <Bot className="h-4 w-4" />Browser Use агент
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Агентът работи в реален браузър от сървъра. Ключът не напуска сървъра, а задачата се изпълнява асинхронно — резултатът се записва тук.
          {draftTitle ? ` Текуща чернова: ${draftTitle}.` : ''}
        </p>
      </header>

      <div className="p-3">
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="напр. Отвори черновата в Mobile.bg и провери дали всички задължителни полета са попълнени. Не публикувай."
          className="w-full rounded-md border border-slate-200 p-2 text-sm outline-none focus:border-blue-400"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">{task.length}/4000 знака</span>
          <button
            disabled={busy || running}
            onClick={() => void submit()}
            className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Send className="h-3.5 w-3.5" />Изпрати на агента
          </button>
        </div>

        {error && (
          <div className="mt-3 flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {run && (
          <div className="mt-3 rounded-md border border-slate-200">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-[11px]">
              <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : run.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Square className="h-3.5 w-3.5" />}
                {label}
              </span>
              <span className="truncate font-mono text-slate-400">{run.runId}</span>
            </div>
            <div className="p-3 text-xs text-slate-700">
              {run.error && <p className="text-rose-700">{run.error}</p>}
              {result && <pre className="whitespace-pre-wrap break-words font-sans">{result}</pre>}
              {!result && !run.error && <p className="text-slate-400">{running ? 'Агентът работи…' : 'Няма текстов резултат.'}</p>}
            </div>
            {run.sessionId && (
              <div className="flex gap-2 border-t border-slate-100 p-2">
                <input
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  placeholder="Продължи разговора в същата сесия…"
                  className="h-9 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-400"
                />
                <button
                  disabled={busy || !followUp.trim()}
                  onClick={() => void sendFollowUp()}
                  className="rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-50"
                >
                  Продължи
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
