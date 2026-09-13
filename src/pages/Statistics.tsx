import { useEffect, useState } from 'react';
import { Search, ShoppingCart, TrendingUp, BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatEUR, formatDate, MARKETPLACE_LABELS } from '@/lib/format';
import type { ClientSearch, Sale, Vehicle } from '@/types';

interface StatsData {
  searchesByMake: { make: string; count: number }[];
  salesByMake: { make: string; count: number; totalEur: number }[];
  totalSearches: number;
  totalSales: number;
  totalSalesEur: number;
  recentSearches: ClientSearch[];
  recentSales: (Sale & { vehicle?: Vehicle })[];
}

export function Statistics() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [sRes, saRes] = await Promise.all([
        supabase.from('client_searches').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('sales').select('*, vehicle:vehicle_id(*)').order('sale_date', { ascending: false }).limit(50),
      ]);

      const searches = (sRes.data || []) as ClientSearch[];
      const sales = (saRes.data || []) as (Sale & { vehicle?: Vehicle })[];

      // Searches by make
      const makeCounts: Record<string, number> = {};
      searches.forEach((s) => {
        makeCounts[s.make] = (makeCounts[s.make] || 0) + 1;
      });
      const searchesByMake = Object.entries(makeCounts)
        .map(([make, count]) => ({ make, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Sales by make
      const salesMakeMap: Record<string, { count: number; totalEur: number }> = {};
      sales.forEach((s) => {
        const make = s.vehicle?.make || 'Неизвестен';
        if (!salesMakeMap[make]) salesMakeMap[make] = { count: 0, totalEur: 0 };
        salesMakeMap[make].count++;
        salesMakeMap[make].totalEur += s.sale_price_eur;
      });
      const salesByMake = Object.entries(salesMakeMap)
        .map(([make, v]) => ({ make, count: v.count, totalEur: v.totalEur }))
        .sort((a, b) => b.count - a.count);

      const totalSalesEur = sales.reduce((sum, s) => sum + s.sale_price_eur, 0);

      setData({
        searchesByMake,
        salesByMake,
        totalSearches: searches.length,
        totalSales: sales.length,
        totalSalesEur,
        recentSearches: searches.slice(0, 10),
        recentSales: sales.slice(0, 10),
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading || !data) {
    return <div className="flex items-center justify-center h-96 text-slate-400">Зареждане...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Статистика</h2>
        <p className="text-sm text-slate-500 mt-0.5">Клиентско търсене, продажби и оборот</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-blue-500 mb-2">
            <Search className="w-5 h-5" />
            <span className="text-sm font-medium text-slate-500">Клиентски търсения</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.totalSearches}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-emerald-500 mb-2">
            <ShoppingCart className="w-5 h-5" />
            <span className="text-sm font-medium text-slate-500">Продажби</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{data.totalSales}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 text-cyan-500 mb-2">
            <TrendingUp className="w-5 h-5" />
            <span className="text-sm font-medium text-slate-500">Общ оборот</span>
          </div>
          <p className="text-2xl font-bold text-slate-900">{formatEUR(data.totalSalesEur)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Searches by make */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-slate-400" /> Търсения по марка
          </h3>
          {data.searchesByMake.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">Няма данни</p>
          ) : (
            <div className="space-y-2">
              {data.searchesByMake.map((s) => {
                const maxCount = data.searchesByMake[0]?.count || 1;
                return (
                  <div key={s.make} className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 w-24 truncate">{s.make}</span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full transition-all"
                        style={{ width: `${(s.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-600 w-8 text-right">{s.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sales by make */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-slate-400" /> Продажби по марка
          </h3>
          {data.salesByMake.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">Няма данни</p>
          ) : (
            <div className="space-y-2">
              {data.salesByMake.map((s) => {
                const maxCount = data.salesByMake[0]?.count || 1;
                return (
                  <div key={s.make} className="flex items-center gap-3">
                    <span className="text-sm text-slate-700 w-24 truncate">{s.make}</span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 rounded-full transition-all"
                        style={{ width: `${(s.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-600 w-8 text-right">{s.count}</span>
                    <span className="text-xs text-slate-400 w-20 text-right">{formatEUR(s.totalEur)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent searches */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Последни търсения</h3>
          {data.recentSearches.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">Няма записани търсения</p>
          ) : (
            <div className="space-y-2">
              {data.recentSearches.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {s.make} {s.model || ''} {s.year_from ? `(${s.year_from}${s.year_to ? `–${s.year_to}` : '+'})` : ''}
                    </p>
                    <p className="text-xs text-slate-400">{s.fuel || 'Всички'} · {formatDate(s.created_at)}</p>
                  </div>
                  {s.outcome && <Badge color="slate">{s.outcome}</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sales */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Последни продажби</h3>
          {data.recentSales.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">Няма записани продажби</p>
          ) : (
            <div className="space-y-2">
              {data.recentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {s.vehicle?.make || ''} {s.vehicle?.model || ''} ({s.vehicle?.model_year || ''})
                    </p>
                    <p className="text-xs text-slate-400">
                      {MARKETPLACE_LABELS[s.marketplace] || s.marketplace} · {formatDate(s.sale_date)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">{formatEUR(s.sale_price_eur)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
