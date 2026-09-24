// Confirmation before a draft is deleted for good. It is a real dialog rather
// than `window.confirm`, because the point of it is to show what is about to
// disappear: counts read from the database, the size, and a warning when the
// draft is already published.

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import {
  previewDraftPurge, purgeSummaryLines, formatBytes,
  type PurgePreview,
} from '@/lib/draft_purge';

interface PurgeDraftDialogProps {
  draftId: string;
  draftTitle: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function PurgeDraftDialog({ draftId, draftTitle, onCancel, onConfirm }: PurgeDraftDialogProps) {
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let cancelled = false;
    previewDraftPurge(draftId)
      .then(result => { if (!cancelled) setPreview(result); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [draftId]);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDeleting(false);
    }
  }

  const blocked = preview?.blocked ?? false;
  // Typing the word is the second half of the guard, after the dialog itself. It
  // only appears once the draft is known and is not mid-publish.
  const confirmationWord = 'ИЗТРИЙ';
  const canDelete = Boolean(preview) && !blocked && !deleting && typed.trim().toUpperCase() === confirmationWord;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-rose-100 bg-rose-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <h3 className="text-sm font-extrabold text-rose-900">Пълно изтриване на чернова</h3>
              <p className="text-xs text-rose-700">Това не може да бъде отменено.</p>
            </div>
          </div>
          <button onClick={onCancel} disabled={deleting} className="rounded p-1 text-rose-500 hover:bg-rose-100 disabled:opacity-50" aria-label="Затвори">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-xs text-slate-700">
          <p className="text-[13px] font-bold text-slate-900">{draftTitle || `Чернова ${draftId.slice(0, 8)}`}</p>

          {!preview && !error && (
            <p className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Изчислявам какво ще бъде изтрито…
            </p>
          )}

          {error && (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{error}</div>
          )}

          {preview && (
            <>
              {preview.is_published && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  <span className="font-bold">Тази чернова е публикувана в Mobile.bg.</span>{' '}
                  Изтриването тук маха само записа в тази система — обявата в Mobile.bg остава и трябва да се махне отделно.
                </div>
              )}

              <div>
                <p className="mb-1 font-bold text-slate-800">Ще бъде изтрито:</p>
                <ul className="list-inside list-disc space-y-0.5 text-slate-600">
                  <li>самата чернова (статус „{preview.status}“)</li>
                  {purgeSummaryLines(preview).map(line => <li key={line}>{line}</li>)}
                  <li>снимките, записани на сървъра за тази чернова</li>
                </ul>
              </div>

              <p className="text-slate-500">
                Приблизителен размер в базата: <span className="font-semibold text-slate-700">{formatBytes(preview.bytes_estimate)}</span>
              </p>

              {blocked && (
                <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 font-semibold text-rose-800">
                  Черновата се публикува в момента. Изчакай публикуването да приключи и опитай пак.
                </div>
              )}

              {!blocked && (
                <div>
                  <label className="mb-1 block text-slate-600">
                    За да потвърдиш, напиши <span className="font-mono font-bold text-rose-700">{confirmationWord}</span>:
                  </label>
                  <input
                    value={typed}
                    onChange={event => setTyped(event.target.value)}
                    disabled={deleting}
                    autoFocus
                    className="h-9 w-full rounded border border-slate-300 px-2 text-xs focus:border-rose-400 focus:outline-none disabled:bg-slate-50"
                    placeholder={confirmationWord}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button onClick={onCancel} disabled={deleting} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Отказ
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canDelete}
            className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {deleting ? 'Изтривам…' : 'Изтрий завинаги'}
          </button>
        </div>
      </div>
    </div>
  );
}
