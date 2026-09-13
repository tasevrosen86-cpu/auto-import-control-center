import { useEffect, useState } from 'react';
import { Car, CheckCircle, AlertTriangle, TrendingDown, Globe, Clock, ShoppingCart, Search, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { StatCard } from '@/components/StatCard';
import { Badge } from '@/components/Badge';
import { formatEUR, formatDate, timeAgo, STATUS_COLORS, getStatusLabel, MARKETPLACE_LABELS } from '@/lib/format';
import type { Vehicle, Job, ClientSearch, Sale } from '@/types';

interface DashboardData {
  totalVehicles: number; activeVehicles: number; reviewVehicles: number; soldVehicles: number;
  totalValue: number; recentJobs: Job[]; recentVehicles: Vehicle[];
  recentSearches: ClientSearch[]; recentSales: Sale[];
  koreaCount: number; canadaCount: number; bulgariaCount: number;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [vRes, jRes, sRes, saRes, mpRes] = await Promise.all([
        supabase.from('vehicles').select('*').order('created_at', { ascending: false }).limit(6),
        supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('client_searches').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('vehicle_marketplace').select('marketplace'),
      ]);
      const vehicles = (vRes.data || []) as Vehicle[];
      const jobs = (jRes.data || []) as Job[];
      const searches = (sRes.data || []) as ClientSearch[];
      const sales = (saRes.data || []) as Sale[];
      const allMp = (mpRes.data || []) as { marketplace: string }[];
      setData({
        totalVehicles: vehicles.length, activeVehicles: vehicles.filter(v=>v.status==='ACTIVE').length,
        reviewVehicles: vehicles.filter(v=>v.flags_needs_review).length, soldVehicles: vehicles.filter(v=>v.status==='SOLD').length,
        totalValue: vehicles.filter(v=>v.our_price_eur).reduce((s,v)=>s+(v.our_price_eur||0),0),
        recentJobs: jobs, recentVehicles: vehicles, recentSearches: searches, recentSales: sales,
        koreaCount: allMp.filter(m=>m.marketplace==='korea').length,
        canadaCount: allMp.filter(m=>m.marketplace==='canada').length,
        bulgariaCount: allMp.filter(m=>m.marketplace==='mobile_bg').length,
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading || !data) return <div className="flex h-96 items-center justify-center text-slate-400">Зареждане...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800">Табло</h2>
        <p className="text-xs text-slate-500">Общ преглед на каталога и операциите</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Общо превозни средства" value={data.totalVehicles} icon={Car} accent="text-blue-600" />
        <StatCard label="Активни" value={data.activeVehicles} icon={CheckCircle} accent="text-emerald-600" />
        <StatCard label="За преглед" value={data.reviewVehicles} icon={AlertTriangle} accent="text-amber-600" />
        <StatCard label="Стойност на каталога" value={formatEUR(data.totalValue)} icon={TrendingDown} accent="text-cyan-600" />
      </div>

      {/* Marketplace coverage */}
      <div className="app-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Globe className="h-4 w-4 text-slate-400" /> Покритие по пазари</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MarketplaceCard label={MARKETPLACE_LABELS.korea} count={data.koreaCount} color="blue" />
          <MarketplaceCard label={MARKETPLACE_LABELS.canada} count={data.canadaCount} color="amber" />
          <MarketplaceCard label={MARKETPLACE_LABELS.mobile_bg} count={data.bulgariaCount} color="emerald" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="app-card p-4">
          <h3 className="mb-3 text-xs font-bold text-slate-700">Последни превозни средства</h3>
          <div className="space-y-2">
            {data.recentVehicles.map((v) => (
              <div key={v.permanent_id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-500">{v.make.slice(0,2).toUpperCase()}</div>
                  <div><p className="text-xs font-semibold text-slate-800">{v.make} {v.model} ({v.model_year})</p><p className="text-[10px] text-slate-400">#{v.permanent_id} · {v.fuel}</p></div>
                </div>
                <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-700">{formatEUR(v.our_price_eur)}</span><Badge color={STATUS_COLORS[v.status]||'slate'}>{getStatusLabel(v.status)}</Badge></div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Activity className="h-4 w-4 text-slate-400" /> Последни задачи</h3>
          {data.recentJobs.length === 0 ? <p className="py-4 text-xs text-slate-400">Няма задачи</p> : (
            <div className="space-y-2">
              {data.recentJobs.map((j) => (
                <div key={j.job_id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-md bg-slate-50 p-1.5">
                      {j.status==='COMPLETED' ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : j.status==='FAILED' ? <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> : j.status==='RUNNING' ? <Clock className="h-3.5 w-3.5 text-blue-500" /> : <Clock className="h-3.5 w-3.5 text-slate-400" />}
                    </div>
                    <div><p className="text-xs font-semibold text-slate-800">{j.job_type}</p><p className="text-[10px] text-slate-400">{timeAgo(j.created_at)}</p></div>
                  </div>
                  <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500">{j.success_count}/{j.max_items||'?'}</span><Badge color={STATUS_COLORS[j.status]||'slate'}>{getStatusLabel(j.status)}</Badge></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Search className="h-4 w-4 text-slate-400" /> Последни клиентски търсения</h3>
          {data.recentSearches.length === 0 ? <p className="py-4 text-xs text-slate-400">Няма записани търсения</p> : (
            <div className="space-y-2">
              {data.recentSearches.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                  <div><p className="text-xs font-semibold text-slate-800">{s.make} {s.model||''} {s.year_from?`(${s.year_from}${s.year_to?`–${s.year_to}`:'+'})`:''}</p><p className="text-[10px] text-slate-400">{s.fuel||'Всички'} · {timeAgo(s.created_at)}</p></div>
                  {s.outcome && <Badge color="slate">{s.outcome}</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><ShoppingCart className="h-4 w-4 text-slate-400" /> Последни продажби</h3>
          {data.recentSales.length === 0 ? <p className="py-4 text-xs text-slate-400">Няма записани продажби</p> : (
            <div className="space-y-2">
              {data.recentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                  <div><p className="text-xs font-semibold text-slate-800">#{s.vehicle_id} · {MARKETPLACE_LABELS[s.marketplace]||s.marketplace}</p><p className="text-[10px] text-slate-400">{formatDate(s.sale_date)}</p></div>
                  <span className="text-xs font-bold text-emerald-600">{formatEUR(s.sale_price_eur)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MarketplaceCard({ label, count, color }: { label: string; count: number; color: string }) {
  const c: Record<string,string> = { blue:'bg-[#e4efff] text-[#075bc5] border-[#c6dcff]', amber:'bg-[#fff1c9] text-[#916300] border-[#f5d985]', emerald:'bg-[#dff6e7] text-[#176b38] border-[#b8e6c8]' };
  return <div className={`rounded-md border p-3 ${c[color]||c.blue}`}><p className="text-xs font-semibold">{label}</p><p className="mt-1 text-xl font-extrabold">{count}</p><p className="mt-0.5 text-[10px] opacity-70">обяви в системата</p></div>;
}
