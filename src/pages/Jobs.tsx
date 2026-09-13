import { useEffect, useState } from 'react';
import { Activity, CheckCircle, Clock, AlertTriangle, Cpu } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatDateTime, timeAgo, STATUS_COLORS, getStatusLabel } from '@/lib/format';
import type { Job } from '@/types';

export function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(50);
      setJobs((data || []) as Job[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-slate-400">Зареждане...</div>;
  }

  const running = jobs.filter((j) => j.status === 'RUNNING').length;
  const queued = jobs.filter((j) => j.status === 'QUEUED').length;
  const completed = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Задачи</h2>
        <p className="text-sm text-slate-500 mt-0.5">Мониторинг на фонови задачи</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-blue-500 mb-1"><Clock className="w-4 h-4" /><span className="text-xs font-medium text-slate-500">Изпълняват се</span></div>
          <p className="text-2xl font-bold text-slate-900">{running}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1"><Cpu className="w-4 h-4" /><span className="text-xs font-medium text-slate-500">На опашка</span></div>
          <p className="text-2xl font-bold text-slate-900">{queued}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-emerald-500 mb-1"><CheckCircle className="w-4 h-4" /><span className="text-xs font-medium text-slate-500">Завършени</span></div>
          <p className="text-2xl font-bold text-slate-900">{completed}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-rose-500 mb-1"><AlertTriangle className="w-4 h-4" /><span className="text-xs font-medium text-slate-500">Провалени</span></div>
          <p className="text-2xl font-bold text-slate-900">{failed}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-400" /> Опашка задачи
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Тип</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Статус</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Напредък</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Успешни</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Провалени</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Създадена</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Завършена</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Няма задачи</td></tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.job_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-900">{j.job_type}</p>
                      <p className="text-xs text-slate-400">от {j.created_by}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={STATUS_COLORS[j.status] || 'slate'}>{getStatusLabel(j.status)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {j.max_items ? (
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${j.status === 'COMPLETED' ? 'bg-emerald-400' : j.status === 'FAILED' ? 'bg-rose-400' : j.status === 'RUNNING' ? 'bg-blue-400' : 'bg-slate-300'}`}
                              style={{ width: `${(j.progress / j.max_items) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">{j.progress}/{j.max_items}</span>
                        </div>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-emerald-600 font-medium">{j.success_count}</td>
                    <td className="px-4 py-3 text-sm text-rose-600 font-medium">{j.failed_count || <span className="text-slate-300">0</span>}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{timeAgo(j.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{j.finished_at ? formatDateTime(j.finished_at) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
