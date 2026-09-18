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

  const payload = useMemo<DraftPayload | null>(() => (
    plan ? { title: plan.title, steps: plan.steps, extras: plan.extras } : null
  ), [plan]);

  function downloadZip() {
    if (!payload) return;
    downloadExtension(buildExtensionZip(payload), payload.title);
  }

  async function copyScript() {
    if (!payload) return;
    await navigator.clipboard.writeText(buildUserscript(payload));
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
          Истинска екстеншън за Chrome, която се инсталира веднъж и после само натискаш иконата.
          Работи в твоя браузър, на твоя профил — няма прокси, няма отдалечен браузър, няма проверка,
          която да минаваме. Данните са само за избраната чернова и стоят в екстеншъна, не излизат никъде.
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
          <Chrome className="h-3.5 w-3.5" /> 1. Инсталирай екстеншъна (Chrome на компютър)
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {plan
            ? <>Готов е за <b>{plan.title || 'избраната чернова'}</b>: {plan.steps.length} полета{plan.extras.length > 0 && <>, {plan.extras.length} екстри</>}.</>
            : 'Избери чернова.'}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button onClick={downloadZip} disabled={!payload}
          className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> Свали екстеншъна (.zip)
        </button>
      </div>
      <div className="border-t border-slate-100 px-3 py-2.5">
        <ol className="list-decimal space-y-1 pl-4 text-[11px] text-slate-500">
          <li>Разархивирай папката (не я мести после).</li>
          <li>Отвори <code className="rounded bg-slate-100 px-1">chrome://extensions</code> и включи „Режим за разработчици“.</li>
          <li>Натисни „Зареди неопаковано“ и избере папката.</li>
          <li>Отвори формата за нова обява и влез в профила си.</li>
          <li>Натисни иконата на AICC в лентата — полетата се попълват.</li>
        </ol>
        <p className="mt-2 text-[11px] text-slate-400">
          Екстеншънът вижда само <code className="rounded bg-slate-100 px-1">mobile.bg</code>. Не изпраща обявата —
          ти преглеждаш и натискаш „Продължи“.
        </p>
      </div>
    </section>

    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Smartphone className="h-3.5 w-3.5" /> 2. От телефон — userscript
        </h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          Chrome на Android <b>не поддържа</b> екстеншъни — това е ограничение на Chrome, не на нас.
          За телефон ползвай браузър с userscript (Firefox с Tampermonkey, Kiwi, Brave).
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button onClick={() => void copyScript()} disabled={!payload}
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          {copied ? 'Копиран' : 'Копирай userscript'}
        </button>
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