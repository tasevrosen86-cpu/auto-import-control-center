import { useEffect, useState } from 'react';
import { Flag, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatDateTime } from '@/lib/format';
import type { ImportConflict, Vehicle } from '@/types';

export function Conflicts() {
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [vehicles, setVehicles] = useState<Record<number, Vehicle>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const cRes = await supabase.from('import_conflicts').select('*').order('created_at', { ascending: false });
      const conflicts = (cRes.data || []) as ImportConflict[];
      setConflicts(conflicts);

      const ids = [...new Set(conflicts.map((c) => c.permanent_id).filter(Boolean))] as number[];
      if (ids.length > 0) {
        const vRes = await supabase.from('vehicles').select('*').in('permanent_id', ids);
        const vMap: Record<number, Vehicle> = {};
        (vRes.data || []).forEach((v: Vehicle) => { vMap[v.permanent_id] = v; });
        setVehicles(vMap);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-slate-400">Зареждане...</div>;
  }

  const unresolved = conflicts.filter((c) => !c.resolved);
  const resolved = conflicts.filter((c) => c.resolved);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Конфликти</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {unresolved.length} неразрешени · {resolved.length} разрешени
        </p>
      </div>

      {unresolved.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-rose-600 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Неразрешени
          </h3>
          {unresolved.map((c) => {
            const v = c.permanent_id ? vehicles[c.permanent_id] : null;
            return (
              <div key={c.id} className="bg-white rounded-xl border border-rose-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="p-2 rounded-lg bg-rose-50">
                      <AlertTriangle className="w-4 h-4 text-rose-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{c.conflict_type}</p>
                        <Badge color="rose">Неразрешен</Badge>
                      </div>
                      {v && <p className="text-sm text-slate-600 mt-1">{v.make} {v.model} ({v.model_year}) · #{v.permanent_id}</p>}
                      {c.stable_key && <p className="text-xs text-slate-400 mt-0.5 font-mono">{c.stable_key}</p>}
                      <pre className="text-xs text-slate-500 mt-2 bg-slate-50 rounded p-2 font-mono overflow-x-auto">{JSON.stringify(c.details, null, 2)}</pre>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{formatDateTime(c.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-emerald-600 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Разрешени
          </h3>
          {resolved.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4 opacity-70">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">{c.conflict_type}</p>
                    <p className="text-xs text-slate-400">{c.permanent_id ? `#${c.permanent_id}` : ''} · Разрешен от {c.resolved_by || 'система'}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{formatDateTime(c.resolved_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {conflicts.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Flag className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm text-slate-400 mt-2">Няма конфликти</p>
        </div>
      )}
    </div>
  );
}
