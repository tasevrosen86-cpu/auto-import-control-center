import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: string;
  sub?: string;
}

export function StatCard({ label, value, icon: Icon, accent = 'text-blue-600', sub }: StatCardProps) {
  return (
    <div className="app-card p-3.5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-[22px] font-extrabold tracking-tight text-slate-800">{value}</p>
          {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-lg bg-slate-50 p-2.5 ${accent}`}><Icon className="h-5 w-5" /></div>
      </div>
    </div>
  );
}
