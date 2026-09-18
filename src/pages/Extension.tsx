import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Chrome, ClipboardCopy, Check, Download, ExternalLink, Puzzle, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { buildMobileBgPlan, type FillPlan } from '@/lib/mobile_bg_options';
import type { MobileBgDraftExtra, MobileBgDraftField } from '@/types';

const FORM_URL = 'https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1';

type DraftOption = {
  id: string;
  title: string | null;
  status: string;
};

// The extension is built from this page at request time: the mapping already
// lives in the app, so the download carries the same one the sheet shows and
// there is no second copy to drift.
function buildExtensionSource(plan: FillPlan) {
  const steps = JSON.stringify(plan.steps);
  const extras = JSON.stringify(plan.extras);
  return `// AICC Mobile.bg assistant, generated for one draft.
// It runs inside the broker's own signed-in browser, so there is no proxy,
// no remote browser and no challenge to pass: the request looks like the
// person it belongs to, because it is.
(function () {
  const STEPS = ${steps};
  const EXTRAS = ${extras};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const normalize = (value) => String(value || '')
    .replace(/\\s+/g, ' ').trim().replace(/[.\\s]+$/, '').toLocaleLowerCase('bg');

  function byName(name) {
    return document.querySelector('[name="' + name + '"]');
  }

  async function waitForOptions(select, minimum = 2, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (select.options.length >= minimum) return true;
      await sleep(250);
    }
    return false;
  }

  function setNativeValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function selectByText(select, wanted) {
    if (!await waitForOptions(select)) return false;
    const target = normalize(wanted);
    const option = Array.from(select.options).find((o) => normalize(o.textContent) === target);
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findTitleInput() {
    const labels = Array.from(document.querySelectorAll('label, td, b, strong'));
    for (const node of labels) {
      if (normalize(node.textContent) !== 'заглавие') continue;
      const forId = node.getAttribute && node.getAttribute('for');
      if (forId) { const linked = document.getElementById(forId); if (linked) return linked; }
      const nested = node.querySelector('input, textarea');
      if (nested) return nested;
      const next = node.parentElement && node.parentElement.querySelector('input, textarea');
      if (next) return next;
    }
    return null;
  }

  function findCheckboxByLabel(text) {
    const target = normalize(text);
    for (const label of Array.from(document.querySelectorAll('label'))) {
      if (normalize(label.textContent) !== target) continue;
      const nested = label.querySelector('input[type="checkbox"]');
      if (nested) return nested;
      const forId = label.getAttribute('for');
      if (forId) { const linked = document.getElementById(forId); if (linked) return linked; }
    }
    return null;
  }

  async function run() {
    const report = { filled: [], skipped: [] };
    if (!byName('f5')) {
      report.error = 'Формата не е намерена. Отвори формата за нова обява и влез в профила си, после опитай пак.';
      return report;
    }
    for (const step of STEPS) {
      try {
        if (step.label === 'title') {
          const input = findTitleInput();
          if (!input) { report.skipped.push([step.label, 'Полето не е намерено']); continue; }
          setNativeValue(input, step.value);
          report.filled.push(step.label);
          continue;
        }
        const control = byName(step.selector);
        if (!control) { report.skipped.push([step.label, 'Полето липсва']); continue; }
        if (step.kind === 'select') {
          if (!await selectByText(control, step.value)) { report.skipped.push([step.label, step.value]); continue; }
          // «Марка» and «Област» drive lists that reload after them.
          if (['make', 'location', 'country'].includes(step.label)) await sleep(600);
        } else {
          setNativeValue(control, step.value);
        }
        report.filled.push(step.label);
      } catch (error) {
        report.skipped.push([step.label, String(error && error.message || error)]);
      }
    }
    for (const label of EXTRAS) {
      const box = findCheckboxByLabel(label);
      if (!box) { report.skipped.push(['extra:' + label, 'Няма такъв екстра']); continue; }
      if (!box.checked) box.click();
      report.filled.push('extra:' + label);
    }
    return report;
  }

  const existing = document.getElementById('aicc-report');
  if (existing) existing.remove();
  const panel = document.createElement('div');
  panel.id = 'aicc-report';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;padding:12px 14px;border-radius:10px;background:#0f172a;color:#e2e8f0;font:12px/1.5 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)';
  panel.textContent = 'Попълвам…';
  document.body.appendChild(panel);
  run().then((report) => {
    const lines = [];
    if (report.error) lines.push(report.error);
    lines.push('Попълнени: ' + report.filled.length);
    if (report.skipped.length) {
      lines.push('Пропуснати (' + report.skipped.length + '):');
      for (const [key, why] of report.skipped.slice(0, 8)) lines.push('  ' + key + ' — ' + why);
    }
    lines.push('Провери стойностите и натисни «Продължи» сам.');
    panel.textContent = lines.join('\\n');
    panel.style.whiteSpace = 'pre-wrap';
  });
})();`;
}

export function Extension() {
  const [drafts, setDrafts] = useState<DraftOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [plan, setPlan] = useState<FillPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('mobile_bg_drafts')
        .select('id,title,status')
        .order('created_at', { ascending: false })
        .limit(50);
      const options = (data || []) as DraftOption[];
      setDrafts(options);
      if (options[0]) setSelectedId(options[0].id);
    })();
  }, []);

  const loadPlan = useCallback(async (draftId: string) => {
    if (!draftId) return;
    setBusy(true);
    setError('');
    const [fieldsResult, extrasResult] = await Promise.all([
      supabase.from('mobile_bg_draft_fields').select('*').eq('draft_id', draftId),
      supabase.from('mobile_bg_draft_extras').select('*').eq('draft_id', draftId),
    ]);
    if (fieldsResult.error) setError(fieldsResult.error.message);
    setPlan(buildMobileBgPlan(
      (fieldsResult.data || []) as MobileBgDraftField[],
      (extrasResult.data || []) as MobileBgDraftExtra[],
    ));
    setBusy(false);
  }, []);

  useEffect(() => { void loadPlan(selectedId); }, [selectedId, loadPlan]);

  const source = useMemo(() => (plan ? buildExtensionSource(plan) : ''), [plan]);

  function download() {
    const blob = new Blob([source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aicc-mobile-bg.js';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return <div className="space-y-3 p-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Puzzle className="h-4 w-4 text-blue-600" /> Екстеншън
        </h1>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">
          Помощник, който работи в твоя браузър, на твоя профил. Няма прокси, няма отдалечен браузър,
          няма проверка, която да минаваме — защото това е истинската сесия. Извлечените данни се
          попълват директно във формата.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={selectedId} onChange={event => setSelectedId(event.target.value)}
          className="h-8 max-w-[260px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400">
          {drafts.length === 0 && <option value="">Няма чернови</option>}
          {drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.title || draft.id.slice(0, 8)}</option>)}
        </select>
        <button onClick={() => void loadPlan(selectedId)} disabled={!selectedId || busy}
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className="h-3.5 w-3.5" /> Презареди
        </button>
      </div>
    </header>

    {error && <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
    </div>}

    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Download className="h-3.5 w-3.5" /> 1. Вземи помощника
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {plan
            ? <>Готов е за <b>{plan.title || 'избраната чернова'}</b>: {plan.steps.length} полета{plan.extras.length > 0 && <>, {plan.extras.length} екстри</>}.</>
            : 'Избери чернова.'}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button onClick={download} disabled={!plan}
          className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> Свали aicc-mobile-bg.js
        </button>
        <button onClick={() => void copy()} disabled={!plan}
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          {copied ? 'Копирано' : 'Копирай кода'}
        </button>
      </div>
      <div className="border-t border-slate-100 px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
          <Chrome className="h-3.5 w-3.5" /> 2. Зареди го в браузъра
        </h3>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[11px] text-slate-500">
          <li>Отвори <code className="rounded bg-slate-100 px-1">chrome://extensions</code> и включи „Режим за разработчици“.</li>
          <li>Натисни „Зареди неопаковано“ и избери папка с файла <code className="rounded bg-slate-100 px-1">aicc-mobile-bg.js</code>.</li>
          <li>Отвори формата за нова обява и влез в профила си.</li>
          <li>Отвори конзолата (F12), постави кода и натисни Enter.</li>
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5">
        <a href={FORM_URL} target="_blank" rel="noreferrer"
          className="flex h-8 items-center gap-1.5 rounded-md bg-slate-800 px-3 text-xs font-semibold text-white hover:bg-slate-700">
          <ExternalLink className="h-3.5 w-3.5" /> Отвори формата на Mobile.bg
        </a>
      </div>
    </section>

    {plan && plan.missing.length > 0 && (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Липсват задължителни полета: {plan.missing.join(', ')}. Помощникът ще ги пропусне — попълни ги ръчно.</span>
      </div>
    )}

    {plan && plan.steps.length > 0 && (
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <header className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <h2 className="text-xs font-bold text-slate-700">Какво ще се попълни</h2>
          <span className="text-[11px] text-slate-500">редът е този, в който Mobile.bg иска стойностите</span>
        </header>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Поле</th>
              <th className="px-3 py-2 font-semibold">Стойност</th>
              <th className="px-3 py-2 font-semibold">Превод</th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map(step => (
              <tr key={step.selector} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-500">
                  <code className="rounded bg-slate-100 px-1 text-[10px]">{step.selector}</code>
                  <span className="ml-2 text-slate-600">{step.label}</span>
                </td>
                <td className="px-3 py-1.5 font-medium text-slate-800">{step.value}</td>
                <td className="px-3 py-1.5">
                  {step.translated
                    ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">преведено</span>
                    : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">както е</span>}
                </td>
              </tr>
            ))}
            {plan.extras.map(label => (
              <tr key={label} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-500">
                  <code className="rounded bg-slate-100 px-1 text-[10px]">checkbox</code>
                  <span className="ml-2 text-slate-600">екстра</span>
                </td>
                <td className="px-3 py-1.5 font-medium text-slate-800">{label}</td>
                <td className="px-3 py-1.5">
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">преведено</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )}
  </div>;
}