import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Download, CheckCircle, AlertTriangle, Plus, Image as ImageIcon,
  Shield, Save, Send, ChevronDown, ChevronRight,
  Lock, Eye, Edit3, History, AlertOctagon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createDraftFromSourceUrl } from '@/lib/draft_create';
import { composeRoyalCarsDescription, ROYAL_CARS_PUBLISH_DEFAULTS } from '@/lib/company_profile';
import { Badge } from '@/components/Badge';
import { formatDateTime, timeAgo, STATUS_COLORS, getStatusLabel } from '@/lib/format';
import {
  MOBILE_BG_FIELD_MAP, fieldsBySection, extrasByGroup, requiredFields,
  EXTRA_GROUPS, SECTION_LABELS_BG, SOURCE_LABELS_BG,
  DRAFT_STATUSES, DRAFT_STATUS_LABELS_BG, DRAFT_STATUS_COLORS,
  type FieldSection, type MobileBgFieldDef,
} from '@/lib/mobile_bg_field_map';
import { getPublishReadiness } from '@/lib/mobile_publisher';
import type {
  ImportRecord, ImportConflict,
  MobileBgDraft, MobileBgDraftField, MobileBgDraftExtra,
  MobileBgDraftImage, MobileBgDraftActionLog, MobileBgDedupCheck,
  MobileBgPublishJob,
} from '@/types';

const MOBILE_BG_VISIBLE_FIELD_KEYS = new Set([
  'category', 'make', 'model', 'modification', 'fuel', 'condition',
  'power', 'euro_standard', 'gearbox', 'displacement', 'price', 'currency',
  'mileage', 'year', 'month', 'color', 'location', 'vin',
  'title', 'description', 'final_description',
  'seller_name', 'phone', 'email', 'mobile_bg_profile', 'ad_type',
  'source_type', 'source_url', 'source_listing_id',
]);

function mobileBgVisibleFieldsBySection(section: FieldSection): MobileBgFieldDef[] {
  if (section === 'basic') {
    const base = fieldsBySection('basic').filter(field => MOBILE_BG_VISIBLE_FIELD_KEYS.has(field.key));
    const location = MOBILE_BG_FIELD_MAP.find(field => field.key === 'location');
    return location ? [...base, location] : base;
  }
  return fieldsBySection(section).filter(field => MOBILE_BG_VISIBLE_FIELD_KEYS.has(field.key));
}

type Tab = 'list' | 'new' | 'detail';

interface ImportsProps {
  openDraftId?: string | null;
  onDraftOpened?: () => void;
}

export function Imports({ openDraftId = null, onDraftOpened }: ImportsProps) {
  const [tab, setTab] = useState<Tab>('list');
  const [drafts, setDrafts] = useState<MobileBgDraft[]>([]);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sourceUrl, setSourceUrl] = useState('');
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [creatingFromUrl, setCreatingFromUrl] = useState(false);
  useEffect(() => {
    if (!openDraftId) return;
    setSelectedDraftId(openDraftId);
    setTab('detail');
    onDraftOpened?.();
  }, [openDraftId, onDraftOpened]);

  const load = useCallback(async () => {
    setLoading(true);
    const [dRes, iRes, cRes] = await Promise.all([
      supabase.from('mobile_bg_drafts').select('*').order('created_at', { ascending: false }),
      supabase.from('imports').select('*').order('started_at', { ascending: false }),
      supabase.from('import_conflicts').select('*').order('created_at', { ascending: false }),
    ]);
    setDrafts((dRes.data || []) as MobileBgDraft[]);
    setImports((iRes.data || []) as ImportRecord[]);
    setConflicts((cRes.data || []) as ImportConflict[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredDrafts = useMemo(() => {
    if (statusFilter === 'ALL') return drafts;
    return drafts.filter(d => d.status === statusFilter);
  }, [drafts, statusFilter]);

  const draftStats = useMemo(() => ({
    total: drafts.length,
    draft: drafts.filter(d => d.status === 'DRAFT').length,
    review: drafts.filter(d => d.status === 'READY_FOR_REVIEW').length,
    approved: drafts.filter(d => d.status === 'APPROVED').length,
    published: drafts.filter(d => d.status === 'PUBLISHED').length,
    error: drafts.filter(d => d.status === 'ERROR').length,
  }), [drafts]);

  async function handleNewDraft() {
    const rawUrl = sourceUrl.trim();
    setIntakeError(null);

    if (!rawUrl) {
      setTab('new');
      setSelectedDraftId(null);
      return;
    }

    setCreatingFromUrl(true);
    try {
      const draft = await createDraftFromSourceUrl(rawUrl, 'LINK_FIELD');

      setSourceUrl('');
      if (!draft.wasCreated) window.alert('Този линк вече има активна чернова. Отварям я вместо да създам дубликат.');
      setSelectedDraftId(draft.id);
      setTab('detail');
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : 'Черновата не можа да бъде създадена.');
    } finally {
      setCreatingFromUrl(false);
    }
  }
  function handleSelectDraft(id: string) { setSelectedDraftId(id); setTab('detail'); }

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-slate-400">Зареждане...</div>;
  }

  if (tab === 'new') {
    return <DraftEditor
      sourceUrl={sourceUrl.trim() || null}
      onBack={() => { setTab('list'); load(); }}
      onSave={() => { setTab('list'); load(); }}
    />;
  }

  if (tab === 'detail' && selectedDraftId) {
    return <DraftDetail
      draftId={selectedDraftId}
      onBack={() => { setTab('list'); load(); }}
    />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Обяви</h2>
          <p className="text-sm text-slate-500 mt-0.5">Чернови за Mobile.bg — AUTO IMPORT CONTROL CENTER</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleNewDraft(); }}
            placeholder="Постави линк към автомобилна обява..."
            className="h-9 w-64 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 lg:w-80"
          />
          <button onClick={handleNewDraft} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700">
            <Plus className="h-3.5 w-3.5" /> {creatingFromUrl ? 'Обработване…' : sourceUrl ? 'Обработи линка' : 'Нова обява'}
          </button>
        </div>
      </div>
      {intakeError && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{intakeError}</div>}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <DraftKpi icon="📋" value={draftStats.total} label="Общо" color="blue" />
        <DraftKpi icon="✎" value={draftStats.draft} label="Чернови" color="slate" />
        <DraftKpi icon="◷" value={draftStats.review} label="За проверка" color="amber" />
        <DraftKpi icon="✓" value={draftStats.approved} label="Одобрени" color="green" />
        <DraftKpi icon="☁" value={draftStats.published} label="Публикувани" color="emerald" />
        <DraftKpi icon="×" value={draftStats.error} label="Грешки" color="red" />
      </div>

      {/* Drafts table */}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <h3 className="text-sm font-bold text-slate-700">Чернови за публикуване</h3>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-8 rounded border border-slate-200 px-2 text-xs text-slate-700">
            <option value="ALL">Всички статуси</option>
            {DRAFT_STATUSES.map(s => <option key={s} value={s}>{DRAFT_STATUS_LABELS_BG[s]}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 bg-[#edf3f9] text-[9px] font-extrabold text-slate-700">
                <th className="px-2 py-2">Заглавие / Източник</th>
                <th className="px-2 py-1 text-center">Статус</th>
                <th className="px-2 py-1 text-center">Брокер</th>
                <th className="px-2 py-1 text-center">Създадена</th>
                <th className="px-2 py-1 text-center">Публикувана</th>
                <th className="px-2 py-1 text-center">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDrafts.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">Няма чернови. Натиснете „Нова обява" за да създадете.</td></tr>
              ) : filteredDrafts.map(d => (
                <tr key={d.id} className="cursor-pointer transition hover:bg-blue-50/60" onClick={() => handleSelectDraft(d.id)}>
                  <td className="px-2 py-2">
                    <p className="font-bold text-slate-800 truncate">{d.title || `Чернова ${d.id.slice(0, 8)}`}</p>
                    <p className="text-slate-500 truncate">
                      {d.source_type === 'encar' ? '🇰🇷' : (d.source_type === 'autotrader' || d.source_type === 'autotrader_ca') ? '🇨🇦' : '📋'} {d.source_type}
                      {d.source_listing_id ? ` · ${d.source_listing_id}` : ''}
                      {d.catalog_permanent_id ? ` · PID ${d.catalog_permanent_id}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Badge color={DRAFT_STATUS_COLORS[d.status] || 'slate'}>{DRAFT_STATUS_LABELS_BG[d.status] || d.status}</Badge>
                  </td>
                  <td className="px-2 py-1 text-center text-slate-600">{d.broker_name || '—'}</td>
                  <td className="px-2 py-1 text-center text-slate-500">{timeAgo(d.created_at)}</td>
                  <td className="px-2 py-1 text-center">
                    {d.mobile_bg_url
                      ? <a href={d.mobile_bg_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline">Линк</a>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={e => { e.stopPropagation(); handleSelectDraft(d.id); }} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-600 hover:bg-blue-100">
                      <Eye className="inline h-3 w-3" /> Отвори
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import history */}
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Download className="w-4 h-4 text-slate-400" /> История на импорти
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Име</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Режим</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Статус</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Записи</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Вмъкнати</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Обновени</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Конфликти</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Стартиран</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {imports.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">Няма импорти</td></tr>
              ) : imports.map((imp) => (
                <tr key={imp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{imp.label}</p>
                    <p className="text-xs text-slate-400">{imp.source_path}</p>
                  </td>
                  <td className="px-4 py-3"><Badge color={imp.mode === 'full' ? 'blue' : imp.mode === 'test' ? 'amber' : 'slate'}>{imp.mode === 'dry_run' ? 'Тест' : imp.mode === 'test' ? 'Тестов' : 'Пълен'}</Badge></td>
                  <td className="px-4 py-3"><Badge color={STATUS_COLORS[imp.status] || 'slate'}>{getStatusLabel(imp.status)}</Badge></td>
                  <td className="px-4 py-3 text-sm text-slate-600">{imp.total_records}</td>
                  <td className="px-4 py-3 text-sm text-emerald-600 font-medium">{imp.inserted}</td>
                  <td className="px-4 py-3 text-sm text-blue-600 font-medium">{imp.updated}</td>
                  <td className="px-4 py-3">{imp.conflicts > 0 ? <span className="text-sm text-rose-600 font-medium">{imp.conflicts}</span> : <span className="text-sm text-slate-300">0</span>}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{timeAgo(imp.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conflicts */}
      <div className="bg-white rounded-md border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" /> Конфликти от импорти
        </h3>
        {conflicts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" /> Няма конфликти
          </div>
        ) : (
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div key={c.id} className="flex items-start justify-between p-3 border border-slate-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-md bg-rose-50"><AlertTriangle className="w-4 h-4 text-rose-500" /></div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{c.conflict_type}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{c.permanent_id ? `#${c.permanent_id}` : ''} {c.stable_key ? `· ${c.stable_key}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.resolved ? <Badge color="emerald">Разрешен</Badge> : <Badge color="rose">Неразрешен</Badge>}
                  <span className="text-xs text-slate-400">{formatDateTime(c.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Draft Editor — "Нова обява"
// ============================================================

interface DraftEditorProps {
  sourceUrl: string | null;
  onBack: () => void;
  onSave: () => void;
}

function DraftEditor({ sourceUrl, onBack, onSave }: DraftEditorProps) {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    if (!sourceUrl) return {} as Record<string, string>;
    const host = (() => {
      try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ''; }
    })();
    let sourceType = 'catalog';
    if (host.includes('encar') || host.includes('encar.com')) sourceType = 'Encar';
    else if (host.includes('autotrader') || host.includes('autotrader.ca')) sourceType = 'AutoTrader';
    return { source_url: sourceUrl, source_type: sourceType };
  });
  const [fieldSources, setFieldSources] = useState<Record<string, string>>(() => {
    if (!sourceUrl) return {} as Record<string, string>;
    const host = (() => {
      try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ''; }
    })();
    let src = 'manual';
    if (host.includes('encar')) src = 'encar';
    else if (host.includes('autotrader')) src = 'autotrader';
    return { source_url: src, source_type: 'catalog' };
  });
  const [fieldProofs, setFieldProofs] = useState<Record<string, string>>({});
  const [fieldManualEdits, setFieldManualEdits] = useState<Record<string, boolean>>({});
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const [extraProofs, setExtraProofs] = useState<Record<string, string>>({});
  const [expandedSections, setExpandedSections] = useState<Set<FieldSection>>(
    new Set(['basic', 'price', 'extras', 'description', 'images', 'publishing', 'source_control'])
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function toggleSection(section: FieldSection) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function setField(key: string, value: string, source?: string) {
    setFieldValues(prev => ({ ...prev, [key]: value }));
    if (source) setFieldSources(prev => ({ ...prev, [key]: source }));
    setFieldManualEdits(prev => ({ ...prev, [key]: true }));
  }

  function toggleExtra(key: string) {
    setSelectedExtras(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function validate(): string[] {
    const errors: string[] = [];
    for (const field of requiredFields()) {
      const val = fieldValues[field.key];
      if (!val || val.trim() === '') {
        errors.push(`Липсва задължително поле: ${field.mobile_bg_label}`);
      }
    }
    if (selectedExtras.size === 0) {
      // extras not required, no error
    }
    return errors;
  }

  async function handleSave(status: string) {
    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0 && status !== 'DRAFT') return;

    setSaving(true);
    setSaveError(null);

    try {
      const dedupHash = [
        fieldValues['make'] || '', fieldValues['model'] || '',
        fieldValues['year'] || '', fieldValues['fuel'] || '',
        fieldValues['generation'] || '', fieldValues['facelift'] || '',
        fieldValues['drivetrain'] || '',
      ].join('|').toLowerCase();

      const { data: draftData, error: draftErr } = await supabase.from('mobile_bg_drafts').insert({
        catalog_permanent_id: null,
        title: fieldValues['title'] || null,
        status,
        source_type: fieldValues['source_type'] || 'catalog',
        source_url: fieldValues['source_url'] || null,
        source_listing_id: fieldValues['source_listing_id'] || null,
        source_vin: fieldValues['source_vin'] || fieldValues['vin'] || null,
        source_price_eur: fieldValues['source_price'] ? Number(fieldValues['source_price']) : null,
        mobile_bg_url: fieldValues['mobile_bg_url'] || null,
        mobile_bg_listing_id: fieldValues['mobile_bg_id'] || null,
        dedup_hash: dedupHash || null,
        broker_name: fieldValues['broker'] || null,
        created_by: fieldValues['created_by'] || 'Росен',
      }).select().single();

      if (draftErr) throw draftErr;
      const draftId = draftData.id;

      // Save fields
      const fieldRows = MOBILE_BG_FIELD_MAP
        .filter(f => f.section !== 'extras')
        .filter(f => fieldValues[f.key] !== undefined && fieldValues[f.key] !== '')
        .map(f => ({
          draft_id: draftId,
          field_key: f.key,
          mobile_bg_label: f.mobile_bg_label,
          our_db_key: f.our_db_key,
          value: fieldValues[f.key] || null,
          field_type: f.field_type,
          source: fieldSources[f.key] || f.source,
          proof: fieldProofs[f.key] || null,
          validation_status: 'pending',
          filled_at: new Date().toISOString(),
          is_manual_edit: fieldManualEdits[f.key] || false,
        }));

      if (fieldRows.length > 0) {
        const { error: fErr } = await supabase.from('mobile_bg_draft_fields').insert(fieldRows);
        if (fErr) throw fErr;
      }

      // Save extras
      const extraRows = MOBILE_BG_FIELD_MAP
        .filter(f => f.section === 'extras' && selectedExtras.has(f.key))
        .map(f => ({
          draft_id: draftId,
          extra_key: f.key,
          mobile_bg_label: f.mobile_bg_label,
          group_name: f.group || 'Други',
          selected: true,
          proof: extraProofs[f.key] || null,
          source: f.source,
        }));

      if (extraRows.length > 0) {
        const { error: eErr } = await supabase.from('mobile_bg_draft_extras').insert(extraRows);
        if (eErr) throw eErr;
      }

      // Action log
      await supabase.from('mobile_bg_draft_action_log').insert({
        draft_id: draftId,
        action: status === 'DRAFT' ? 'DRAFT_CREATED' : 'DRAFT_READY_FOR_REVIEW',
        actor: fieldValues['created_by'] || 'Росен',
        details: { field_count: fieldRows.length, extra_count: extraRows.length },
      });

      onSave();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Неизвестна грешка при запис');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Назад
          </button>
          <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">Нова обява</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleSave('DRAFT')} disabled={saving} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <Save className="h-3.5 w-3.5" /> Запази чернова
          </button>
          <button onClick={() => handleSave('READY_FOR_REVIEW')} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">
            <Send className="h-3.5 w-3.5" /> Готова за проверка
          </button>
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertOctagon className="h-4 w-4 text-rose-600" />
            <p className="text-sm font-bold text-rose-800">Липсващи задължителни полета:</p>
          </div>
          <ul className="ml-6 list-disc text-xs text-rose-700">
            {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            <p className="text-sm text-rose-700">{saveError}</p>
          </div>
        </div>
      )}

      {/* Sections */}
      {(['basic', 'price', 'extras', 'description', 'images', 'publishing'] as FieldSection[]).map(section => {
        const fields = section === 'extras' || section === 'images' ? fieldsBySection(section) : mobileBgVisibleFieldsBySection(section);
        const isExpanded = expandedSections.has(section);
        return (
          <div key={section} className="rounded-md border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => toggleSection(section)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="text-sm font-bold text-slate-800">{SECTION_LABELS_BG[section]}</span>
              {isExpanded
                ? <ChevronDown className="h-4 w-4 text-slate-400" />
                : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>
            {isExpanded && (
              <div className="border-t border-slate-100 p-3">
                {section === 'extras' ? (
                  <ExtrasSection
                    selectedExtras={selectedExtras}
                    onToggle={toggleExtra}
                    extraProofs={extraProofs}
                    onProofChange={(key, val) => setExtraProofs(prev => ({ ...prev, [key]: val }))}
                  />
                ) : section === 'images' ? (
                  <ImagesSection />
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {fields.map(field => (
                      <FieldInput
                        key={field.key}
                        field={field}
                        value={fieldValues[field.key] || ''}
                        source={fieldSources[field.key] || field.source}
                        proof={fieldProofs[field.key] || ''}
                        isManualEdit={fieldManualEdits[field.key] || false}
                        onChange={(val) => setField(field.key, val)}
                        onSourceChange={(src) => setFieldSources(prev => ({ ...prev, [field.key]: src }))}
                        onProofChange={(val) => setFieldProofs(prev => ({ ...prev, [field.key]: val }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Dedup warning section */}
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <Shield className="h-4 w-4 text-amber-600 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">8. Предотвратяване на дублиране</p>
            <p className="text-xs text-amber-700 mt-1">
              Преди публикуване системата проверява: source listing ID, VIN, вече записан Mobile.bg ID/URL,
              и комбинация марка + модел + година + гориво + генерация + фейслифт + задвижване.
              При съвпадение публикуването се блокира и се показва съществуващата обява.
            </p>
          </div>
        </div>
      </div>

      {/* Roles */}
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-sm font-bold text-slate-800 mb-2">9. Роли за текущата фирма</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded border border-slate-200 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">Р</div>
            <div>
              <p className="text-xs font-bold text-slate-800">Росен — Admin + Broker</p>
              <p className="text-[10px] text-slate-500">Вижда всички чернови, одобрява и публикува</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded border border-slate-200 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">Д</div>
            <div>
              <p className="text-xs font-bold text-slate-800">Денис — Broker</p>
              <p className="text-[10px] text-slate-500">Създава и редактира своите чернови</p>
            </div>
          </div>
        </div>
      </div>

      {/* Script intake info */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-start gap-2">
          <Lock className="h-4 w-4 text-blue-600 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-blue-800">10. Скрипт за извличане</p>
            <p className="text-xs text-blue-700 mt-1">
              Външният скрипт извлича данните и изпраща JSON към защитения вход на системата.
              Системата пази оригиналния JSON, попълва полетата, екстрите и снимките и показва какво още липсва за проверка.
              Публикуването в Mobile.bg остава изключено, докато не се свърже отделно и не се тества с една обява.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Field Input Component
// ============================================================

function FieldInput({ field, value, source, proof, isManualEdit, onChange, onSourceChange, onProofChange }: {
  field: MobileBgFieldDef;
  value: string;
  source: string;
  proof: string;
  isManualEdit: boolean;
  onChange: (v: string) => void;
  onSourceChange: (s: string) => void;
  onProofChange: (v: string) => void;
}) {
  const [showMeta, setShowMeta] = useState(false);

  return (
    <div className={`rounded border ${field.required ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'} p-2`}>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold text-slate-700">
          {field.mobile_bg_label}
          {field.required && <span className="ml-1 text-rose-500">*</span>}
        </label>
        <button onClick={() => setShowMeta(!showMeta)} className="text-slate-300 hover:text-slate-500">
          {showMeta ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      </div>

      {field.field_type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          rows={3}
          className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-blue-400"
        />
      ) : field.field_type === 'select' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400"
        >
          <option value="">—</option>
          {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.field_type === 'checkbox' ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value === 'true'} onChange={e => onChange(e.target.checked ? 'true' : 'false')} className="h-3.5 w-3.5" />
          <span className="text-[10px] text-slate-600">{field.options?.[0] || 'Да/Не'}</span>
        </label>
      ) : (
        <input
          type={field.field_type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          className="h-8 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400"
        />
      )}

      {showMeta && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-semibold text-slate-500">Източник:</span>
            <select value={source} onChange={e => onSourceChange(e.target.value)} className="h-6 rounded border border-slate-200 px-1 text-[9px] text-slate-600">
              {Object.entries(SOURCE_LABELS_BG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {isManualEdit && <span className="text-[9px] text-amber-600"><Edit3 className="inline h-2.5 w-2.5" /> ръчно</span>}
          </div>
          <input
            type="text"
            value={proof}
            onChange={e => onProofChange(e.target.value)}
            placeholder="доказателство (напр. обява, снимка, VIN декодер)"
            className="h-7 w-full rounded border border-slate-200 px-2 text-[9px] text-slate-600 outline-none focus:border-blue-400"
          />
          <div className="flex items-center gap-2 text-[9px] text-slate-400">
            <span>Ключ: {field.key}</span>
            <span>·</span>
            <span>DB: {field.our_db_key}</span>
            <span>·</span>
            <span>Агент: {field.agent_can_fill ? '✓' : '✗'}</span>
            <span>·</span>
            <span>Потвърждение: {field.needs_human_confirmation ? '✓' : '✗'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Extras Section
// ============================================================

function ExtrasSection({ selectedExtras, onToggle, extraProofs, onProofChange }: {
  selectedExtras: Set<string>;
  onToggle: (key: string) => void;
  extraProofs: Record<string, string>;
  onProofChange: (key: string, val: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded border border-amber-200 bg-amber-50 p-2">
        <p className="text-[10px] text-amber-700">
          Маркирайте само екстри, за които има доказателство в обявата, снимките, VIN декодера или описанието на източника.
          При липса на доказателство — не маркирайте.
        </p>
      </div>
      {EXTRA_GROUPS.map(group => {
        const extras = extrasByGroup(group);
        return (
          <div key={group} className="rounded border border-slate-200 p-2">
            <p className="mb-2 text-xs font-bold text-slate-700">{group}</p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {extras.map(extra => {
                const isSelected = selectedExtras.has(extra.key);
                return (
                  <div key={extra.key} className={`flex items-center gap-1.5 rounded p-1.5 ${isSelected ? 'bg-emerald-50 border border-emerald-200' : 'border border-transparent'}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(extra.key)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="text-[10px] font-medium text-slate-700">{extra.mobile_bg_label}</span>
                    {isSelected && (
                      <input
                        type="text"
                        value={extraProofs[extra.key] || ''}
                        onChange={e => onProofChange(extra.key, e.target.value)}
                        placeholder="доказателство"
                        className="ml-auto h-6 w-24 rounded border border-slate-200 px-1 text-[9px] text-slate-600 outline-none"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Images Section
// ============================================================

function ImagesSection() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Снимки от източника</label>
          <div className="mt-1 flex items-center justify-center rounded border border-dashed border-slate-300 p-4 text-slate-400">
            <ImageIcon className="h-6 w-6" />
          </div>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Избрани за публикуване</label>
          <div className="mt-1 flex items-center justify-center rounded border border-dashed border-slate-300 p-4 text-slate-400">
            <ImageIcon className="h-6 w-6" />
          </div>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Основна снимка</label>
          <div className="mt-1 flex items-center justify-center rounded border border-dashed border-slate-300 p-4 text-slate-400">
            <ImageIcon className="h-6 w-6" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Подредба</label>
          <input type="text" placeholder="1,2,3..." className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
        </div>
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Статус на обработка</label>
          <select className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400">
            <option>Чакащи</option><option>В обработка</option><option>Готови</option><option>Грешка</option>
          </select>
        </div>
        <div className="flex items-center gap-2 rounded border border-slate-200 p-2">
          <input type="checkbox" className="h-3.5 w-3.5" />
          <label className="text-[10px] font-medium text-slate-700">JPG готова за Mobile.bg</label>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Оригинален URL</label>
          <input type="text" placeholder="https://..." className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
        </div>
        <div className="rounded border border-slate-200 p-2">
          <label className="text-[10px] font-bold text-slate-700">Локален/сървърен файл</label>
          <input type="text" placeholder="/path/to/file.jpg" className="mt-1 h-8 w-full rounded border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-blue-400" />
        </div>
        <div className="flex items-center gap-2 rounded border border-slate-200 p-2">
          <input type="checkbox" className="h-3.5 w-3.5" />
          <label className="text-[10px] font-medium text-slate-700">Проверка „реална снимка на автомобил"</label>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Draft Detail View
// ============================================================

function draftSourceTypeLabel(sourceType: string | null | undefined): string {
  const normalized = (sourceType || '').toLowerCase();
  if (normalized.includes('encar')) return 'Encar';
  if (normalized.includes('autotrader')) return 'AutoTrader';
  return 'Каталог';
}

function draftAutofillRows(draft: MobileBgDraft, loadedFields: MobileBgDraftField[]) {
  const values = new Map(
    loadedFields.map(field => [field.field_key, String(field.value || '').trim()]),
  );
  const value = (key: string) => values.get(key) || '';
  const sourceType = draftSourceTypeLabel(draft.source_type);
  const make = value('make');
  const model = value('model');
  const year = value('year');
  const generatedTitle = (draft.title || value('title') || [make, model, year].filter(Boolean).join(' ') || 'Автомобил').trim();
  const generatedDescription = value('description') || composeRoyalCarsDescription();
  const sourceLocation = sourceType === 'AutoTrader'
    ? 'Извън страната → Канада'
    : sourceType === 'Encar'
      ? 'Извън страната → Южна Корея'
      : 'България';

  const defaults: Record<string, string> = {
    title: generatedTitle,
    description: generatedDescription,
    final_description: value('final_description') || generatedDescription,
    seller_name: ROYAL_CARS_PUBLISH_DEFAULTS.seller_name,
    phone: ROYAL_CARS_PUBLISH_DEFAULTS.phone,
    ad_type: ROYAL_CARS_PUBLISH_DEFAULTS.ad_type,
    source_type: sourceType,
    location: value('location') || sourceLocation,
  };
  const sources: Record<string, string> = {
    title: 'agent',
    description: 'broker',
    final_description: 'broker',
    seller_name: 'broker',
    phone: 'broker',
    ad_type: 'broker',
    source_type: 'agent',
    location: 'agent',
  };

  const now = new Date().toISOString();
  return Object.entries(defaults)
    .filter(([key, fieldValue]) => Boolean(fieldValue) && !value(key))
    .map(([key, fieldValue]) => {
      const definition = MOBILE_BG_FIELD_MAP.find(field => field.key === key);
      return {
        draft_id: draft.id,
        field_key: key,
        mobile_bg_label: definition?.mobile_bg_label || key,
        our_db_key: definition?.our_db_key || key,
        value: fieldValue,
        field_type: definition?.field_type || 'text',
        source: sources[key] || 'agent',
        proof: null,
        validation_status: 'valid',
        filled_at: now,
        is_manual_edit: false,
      };
    });
}

function DraftDetail({ draftId, onBack }: { draftId: string; onBack: () => void }) {
  const [draft, setDraft] = useState<MobileBgDraft | null>(null);
  const [fields, setFields] = useState<MobileBgDraftField[]>([]);
  const [extras, setExtras] = useState<MobileBgDraftExtra[]>([]);
  const [images, setImages] = useState<MobileBgDraftImage[]>([]);
  const [logs, setLogs] = useState<MobileBgDraftActionLog[]>([]);
  const [dedupChecks, setDedupChecks] = useState<MobileBgDedupCheck[]>([]);
  const [publishJob, setPublishJob] = useState<MobileBgPublishJob | null>(null);
  const [queuingPublish, setQueuingPublish] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingFields, setSavingFields] = useState(false);
  const [saveFieldsError, setSaveFieldsError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [dRes, fRes, eRes, iRes, lRes, ddRes, pRes] = await Promise.all([
        supabase.from('mobile_bg_drafts').select('*').eq('id', draftId).maybeSingle(),
        supabase.from('mobile_bg_draft_fields').select('*').eq('draft_id', draftId).order('field_key'),
        supabase.from('mobile_bg_draft_extras').select('*').eq('draft_id', draftId).order('group_name'),
        supabase.from('mobile_bg_draft_images').select('*').eq('draft_id', draftId).order('display_order'),
        supabase.from('mobile_bg_draft_action_log').select('*').eq('draft_id', draftId).order('created_at', { ascending: false }),
        supabase.from('mobile_bg_dedup_checks').select('*').eq('draft_id', draftId).order('created_at', { ascending: false }),
        supabase.from('mobile_bg_publish_jobs').select('*').eq('draft_id', draftId).maybeSingle(),
      ]);
      const loadedDraft = (dRes.data || null) as MobileBgDraft | null;
      const loadedFields = (fRes.data || []) as MobileBgDraftField[];
      let effectiveFields = loadedFields;
      if (loadedDraft) {
        const autofillRows = draftAutofillRows(loadedDraft, loadedFields);
        if (autofillRows.length > 0) {
          const { error: autofillError } = await supabase
            .from('mobile_bg_draft_fields')
            .upsert(autofillRows, { onConflict: 'draft_id,field_key' });
          if (!autofillError) {
            effectiveFields = [...loadedFields, ...autofillRows] as MobileBgDraftField[];
            await supabase.from('mobile_bg_draft_action_log').insert({
              draft_id: loadedDraft.id,
              action: 'PUBLISH_FIELDS_AUTOFILLED',
              actor: 'Агент',
              details: { fields: autofillRows.map(row => row.field_key) },
            });
          }
        }
      }
      setDraft(loadedDraft);
      setFields(effectiveFields);
      setEditValues(Object.fromEntries(effectiveFields.map(field => [field.field_key, field.value || ''])));
      setExtras((eRes.data || []) as MobileBgDraftExtra[]);
      setImages((iRes.data || []) as MobileBgDraftImage[]);
      setLogs((lRes.data || []) as MobileBgDraftActionLog[]);
      setDedupChecks((ddRes.data || []) as MobileBgDedupCheck[]);
      setPublishJob((pRes.data || null) as MobileBgPublishJob | null);
      setLoading(false);
    }
    load();
  }, [draftId]);

  async function saveEditedFields() {
    setSavingFields(true);
    setSaveFieldsError(null);
    try {
      const rows = mobileBgVisibleFieldsBySection('basic')
        .concat(mobileBgVisibleFieldsBySection('price'))
        .concat(mobileBgVisibleFieldsBySection('description'))
        .concat(mobileBgVisibleFieldsBySection('publishing'))
        .concat(mobileBgVisibleFieldsBySection('source_control'))
        .filter((def, index, all) => all.findIndex(item => item.key === def.key) === index)
        .map(def => ({
          draft_id: draftId,
          field_key: def.key,
          mobile_bg_label: def.mobile_bg_label,
          our_db_key: def.our_db_key,
          value: (editValues[def.key] || '').trim() || null,
          field_type: def.field_type,
          source: 'manual',
          proof: null,
          validation_status: (editValues[def.key] || '').trim() ? 'valid' : 'missing',
          filled_at: (editValues[def.key] || '').trim() ? new Date().toISOString() : null,
          is_manual_edit: true,
        }));
      const { error } = await supabase.from('mobile_bg_draft_fields').upsert(rows, { onConflict: 'draft_id,field_key' });
      if (error) throw error;
      await supabase.from('mobile_bg_draft_action_log').insert({
        draft_id: draftId, action: 'DRAFT_FIELDS_MANUALLY_UPDATED', actor: 'Росен',
        details: { fields: rows.filter(row => row.value !== null).map(row => row.field_key) },
      });
      setFields(rows as MobileBgDraftField[]);
      setDraft(current => current ? { ...current, updated_at: new Date().toISOString() } : current);
    } catch (error) {
      setSaveFieldsError(error instanceof Error ? error.message : 'Промените не бяха записани.');
    } finally {
      setSavingFields(false);
    }
  }

  async function queuePublish() {
    const readiness = getPublishReadiness(fields);
    if (!readiness.ready) {
      window.alert(`Не могат да се изпратят данните без: ${readiness.missing.join(', ')}`);
      return;
    }
    if (!window.confirm('Подготвям формата в Mobile.bg за ръчна проверка. Няма да има финално изпращане или публикуване. Продължаваме?')) return;
    setQueuingPublish(true);
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('mobile_bg_publish_jobs').upsert({
        draft_id: draftId, status: 'QUEUED', transport: 'BROWSER_ON_DEMAND', mode: 'PREVIEW',
        requested_by: 'Росен', requested_at: now, updated_at: now, last_error: null,
      }, { onConflict: 'draft_id' }).select().single();
      if (error) throw error;
      await supabase.from('mobile_bg_drafts').update({ status: 'PUBLISH_QUEUED', publish_error: null, updated_at: now }).eq('id', draftId);
      await supabase.from('mobile_bg_draft_action_log').insert({
        draft_id: draftId, action: 'MOBILE_PUBLISH_QUEUED', actor: 'Росен',
        details: { transport: 'BROWSER_ON_DEMAND', mode: 'PREVIEW' },
      });
      setPublishJob(data as MobileBgPublishJob);
      setDraft(current => current ? { ...current, status: 'PUBLISH_QUEUED', publish_error: null } : current);
    } catch (error) {
      window.alert(`Заявката не можа да бъде изпратена: ${error instanceof Error ? error.message : 'неизвестна грешка'}`);
    } finally {
      setQueuingPublish(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-96 text-slate-400">Зареждане...</div>;
  if (!draft) return <div className="text-center text-slate-400 py-12">Черновата не е намерена</div>;

  const fieldsByKey = new Map(fields.map(field => [field.field_key, field]));
  const extrasByKey = new Map(extras.map(extra => [extra.extra_key, extra]));
  const groupedExtras = EXTRA_GROUPS.map(group => ({
    group,
    items: extrasByGroup(group).map(def => ({ def, saved: extrasByKey.get(def.key) })),
  }));

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Назад
          </button>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-[#172541]">{draft.title || `Чернова ${draft.id.slice(0, 8)}`}</h2>
            <p className="text-xs text-slate-500">
              {draft.source_type} · {draft.source_listing_id || '—'} · PID {draft.catalog_permanent_id || '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge color={DRAFT_STATUS_COLORS[draft.status] || 'slate'}>{DRAFT_STATUS_LABELS_BG[draft.status] || draft.status}</Badge>
          <button onClick={queuePublish} disabled={queuingPublish || publishJob?.status === 'RUNNING' || draft.extraction_status === 'SOURCE_PENDING'} className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
            {queuingPublish ? 'Подготвяне…' : 'Публикувай (ръчно потвърждение)'}
          </button>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><span className="font-bold">Източник:</span> {draft.source_type === 'encar' ? '🇰🇷 Encar Korea' : draft.source_type === 'autotrader_ca' ? '🇨🇦 AutoTrader Canada' : draft.source_type}</span>
          <span><span className="font-bold">ID:</span> {draft.source_listing_id || 'няма'}</span>
          <span><span className="font-bold">Статус:</span> {draft.extraction_status === 'SOURCE_PENDING' ? 'Изчаква извличане' : draft.extraction_status || '—'}</span>
          {draft.source_url && <a href={draft.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">Отвори източника</a>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <span className="text-xs text-amber-800">Полената могат да се редактират ръчно.</span>
        <button onClick={saveEditedFields} disabled={savingFields} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">{savingFields ? 'Записване…' : 'Запази промените'}</button>
      </div>
      {saveFieldsError && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveFieldsError}</div>}

      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Този бутон само предава черновата към браузъра на Mobile.bg и попълва формата. Финалното публикуване остава ръчно и не се натиска от системата.
        {publishJob && <span className="ml-1 font-bold">Последна заявка: {publishJob.status}{publishJob.last_error ? ` — ${publishJob.last_error}` : ''}</span>}
      </div>

      {/* Full Mobile.bg mirror: every field stays visible, even while extraction is pending */}
      {(['basic', 'price', 'description', 'publishing', 'source_control'] as FieldSection[]).map(section => {
        const definitions = mobileBgVisibleFieldsBySection(section);
        return (
          <div key={section} className="rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="px-3 py-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">{SECTION_LABELS_BG[section]}</h3>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {definitions.map(def => {
                  const saved = fieldsByKey.get(def.key);
                  return (
                    <div key={def.key} className={`rounded border p-2 ${saved?.value ? 'border-slate-200' : def.required ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
                      <p className="text-[10px] font-bold text-slate-700">{def.key === 'final_description' ? 'Допълнителна информация' : def.mobile_bg_label}{def.required ? ' *' : ''}</p>
                      {def.field_type === 'textarea' || def.key === 'description' || def.key === 'final_description' ? (
                        <textarea value={editValues[def.key] ?? saved?.value ?? ''} onChange={e => setEditValues(prev => ({ ...prev, [def.key]: e.target.value }))} rows={def.key === 'final_description' ? 7 : 3} className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5 text-[11px] text-slate-800 outline-none focus:border-blue-500" placeholder="Въведи стойност..." />
                      ) : (
                        <input value={editValues[def.key] ?? saved?.value ?? ''} onChange={e => setEditValues(prev => ({ ...prev, [def.key]: e.target.value }))} className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-800 outline-none focus:border-blue-500" placeholder="Въведи стойност..." />
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-slate-400">
                        <span>Източник: {saved ? (SOURCE_LABELS_BG[saved.source] || saved.source) : (SOURCE_LABELS_BG[def.source] || def.source)}</span>
                        {saved?.is_manual_edit && <span className="text-amber-600"><Edit3 className="inline h-2.5 w-2.5" /> ръчно</span>}
                        {saved?.proof && <span className="break-all">· доказателство: {saved.proof}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {/* Complete Mobile.bg extras mirror */}
      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-3 py-2">
          <h3 className="text-sm font-bold text-slate-800">3. Екстри</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {groupedExtras.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-2 text-xs font-bold text-slate-700">{group}</p>
              <div className="space-y-1.5">
                {items.map(({ def, saved }) => (
                  <div key={def.key} className="flex items-start gap-2 text-[11px] text-slate-700">
                    <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${saved?.selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {saved?.selected ? '✓' : ''}
                    </span>
                    <span>{def.mobile_bg_label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Extracted source images */}
      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <h3 className="text-sm font-bold text-slate-800">5. Снимки</h3>
          <span className="text-[10px] text-slate-500">{images.length ? `${images.length} извлечени` : draft.extraction_status === 'SOURCE_PENDING' ? 'Извличат се…' : 'Няма извлечени снимки'}</span>
        </div>
        <div className="p-3">
          {images.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {images.map(img => {
                const imageUrl = img.local_path || img.source_url;
                return (
                  <div key={img.id} className="overflow-hidden rounded border border-slate-200 bg-white">
                    {imageUrl ? (
                      <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                        <img src={imageUrl} alt={img.is_main ? 'Основна снимка' : `Снимка ${img.display_order}`} className="h-28 w-full bg-slate-100 object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      </a>
                    ) : (
                      <div className="flex h-28 items-center justify-center bg-slate-100 text-slate-400"><ImageIcon className="h-6 w-6" /></div>
                    )}
                    <p className="px-2 py-1 text-[9px] text-slate-500">
                      {img.is_main ? '★ Основна' : `#${img.display_order}`} · {img.processing_status}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
              {draft.extraction_status === 'SOURCE_PENDING' ? 'Черновата е създадена. Изчаква извличане на данни и снимки.' : 'Източникът не е върнал снимки.'}
            </div>
          )}
        </div>
      </div>

      {/* Dedup checks */}
      {dedupChecks.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="px-3 py-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-500" /> 8. Проверки за дублиране
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {dedupChecks.map(dc => (
              <div key={dc.id} className={`flex items-center justify-between rounded border p-2 ${dc.is_duplicate ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <div>
                  <p className="text-xs font-bold text-slate-700">{dc.check_type}</p>
                  {dc.matched_mobile_bg_url && <a href={dc.matched_mobile_bg_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">{dc.matched_mobile_bg_url}</a>}
                  {dc.matched_broker_name && <p className="text-[10px] text-slate-500">Брокер: {dc.matched_broker_name}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {dc.is_duplicate
                    ? <Badge color="rose">Дубликат!</Badge>
                    : <Badge color="emerald">OK</Badge>}
                  {dc.resolved && <Badge color="slate">Разрешен</Badge>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action log */}
      {logs.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="px-3 py-2 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" /> Лог на действията
            </h3>
          </div>
          <div className="p-3 space-y-1">
            {logs.map(log => (
              <div key={log.id} className="flex items-center justify-between text-xs text-slate-600 border-b border-slate-50 py-1">
                <span><span className="font-bold">{log.action}</span> · {log.actor}</span>
                <span className="text-slate-400">{formatDateTime(log.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// KPI Component
// ============================================================

function DraftKpi({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  const styles: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-600',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    amber: 'border-amber-200 bg-amber-50 text-amber-600',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-600',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-600',
    red: 'border-rose-200 bg-rose-50 text-rose-600',
  };
  return <div className={`flex items-center gap-2 rounded-md border px-3 py-2 ${styles[color]}`}>
    <span className="text-xl font-bold">{icon}</span>
    <div>
      <p className="text-lg font-extrabold leading-5">{value.toLocaleString('bg-BG')}</p>
      <p className="text-[9px] font-semibold opacity-80">{label}</p>
    </div>
  </div>;
}
