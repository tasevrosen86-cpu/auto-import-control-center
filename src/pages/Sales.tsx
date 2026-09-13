import { useEffect, useState } from 'react';
import { ShoppingCart, Plus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatEUR, formatDate, MARKETPLACE_LABELS } from '@/lib/format';
import type { Sale, Vehicle } from '@/types';

export function Sales() {
  const [sales, setSales] = useState<(Sale & { vehicle?: Vehicle })[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    vehicle_id: '',
    marketplace: 'korea',
    sale_price_eur: '',
    buyer_name: '',
    sale_date: new Date().toISOString().split('T')[0],
    source: '',
    notes: '',
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [saRes, vRes] = await Promise.all([
      supabase.from('sales').select('*, vehicle:vehicle_id(*)').order('sale_date', { ascending: false }),
      supabase.from('vehicles').select('*').neq('status', 'SOLD').is('deleted_at', null).order('make'),
    ]);
    setSales((saRes.data || []) as (Sale & { vehicle?: Vehicle })[]);
    setVehicles((vRes.data || []) as Vehicle[]);
    setLoading(false);
  }

  async function handleSubmit() {
    if (!formData.vehicle_id || !formData.sale_price_eur) return;

    const vehicleId = parseInt(formData.vehicle_id);
    await supabase.from('sales').insert({
      vehicle_id: vehicleId,
      marketplace: formData.marketplace,
      sale_price_eur: parseFloat(formData.sale_price_eur),
      buyer_name: formData.buyer_name || null,
      sale_date: formData.sale_date,
      source: formData.source || null,
      notes: formData.notes || null,
    });

    // Mark vehicle as SOLD
    await supabase
      .from('vehicles')
      .update({ status: 'SOLD' })
      .eq('permanent_id', vehicleId);

    // Log status change
    await supabase.from('vehicle_status_log').insert({
      vehicle_id: vehicleId,
      old_status: 'ACTIVE',
      new_status: 'SOLD',
      reason: 'Продаден',
      actor: 'admin',
    });

    setFormData({
      vehicle_id: '',
      marketplace: 'korea',
      sale_price_eur: '',
      buyer_name: '',
      sale_date: new Date().toISOString().split('T')[0],
      source: '',
      notes: '',
    });
    setShowForm(false);
    load();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96 text-slate-400">Зареждане...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Продажби</h2>
          <p className="text-sm text-slate-500 mt-0.5">{sales.length} записани продажби</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showForm ? <><X className="w-4 h-4" /> Отказ</> : <><Plus className="w-4 h-4" /> Нова продажба</>}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Запиши продажба</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Превозно средство *</label>
              <select
                value={formData.vehicle_id}
                onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
              >
                <option value="">Избери...</option>
                {vehicles.map((v) => (
                  <option key={v.permanent_id} value={v.permanent_id}>
                    #{v.permanent_id} {v.make} {v.model} ({v.model_year}) — {formatEUR(v.our_price_eur)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Пазар *</label>
              <select
                value={formData.marketplace}
                onChange={(e) => setFormData({ ...formData, marketplace: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
              >
                <option value="korea">Корея / Encar</option>
                <option value="canada">Канада / AutoTrader</option>
                <option value="mobile_bg">България / Mobile.bg</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Цена (EUR) *</label>
              <input
                type="number"
                value={formData.sale_price_eur}
                onChange={(e) => setFormData({ ...formData, sale_price_eur: e.target.value })}
                placeholder="25000"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Купувач</label>
              <input
                type="text"
                value={formData.buyer_name}
                onChange={(e) => setFormData({ ...formData, buyer_name: e.target.value })}
                placeholder="Име на купувач"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Дата на продажба</label>
              <input
                type="date"
                value={formData.sale_date}
                onChange={(e) => setFormData({ ...formData, sale_date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Източник</label>
              <input
                type="text"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder="напр. mobile.bg"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-slate-500 mb-1 block">Бележки</label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Допълнителна информация"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <button
            onClick={handleSubmit}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            Запиши продажба (маркира като SOLD)
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Превозно средство</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Пазар</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Цена</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Купувач</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Дата</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Източник</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-400">Няма записани продажби</td>
                </tr>
              ) : (
                sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-900">
                        {s.vehicle?.make || '—'} {s.vehicle?.model || ''} ({s.vehicle?.model_year || ''})
                      </p>
                      <p className="text-xs text-slate-400">#{s.vehicle_id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color="slate">{MARKETPLACE_LABELS[s.marketplace] || s.marketplace}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-emerald-600">{formatEUR(s.sale_price_eur)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{s.buyer_name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatDate(s.sale_date)}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{s.source || '—'}</td>
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
