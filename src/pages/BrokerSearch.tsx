import { useState } from 'react';
import { Search, Car, ArrowRight, ExternalLink, TrendingDown, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatEUR, formatNumber, STATUS_COLORS, MARKETPLACE_LABELS, getStatusLabel, getBestPrice } from '@/lib/format';
import type { VehicleWithMarketplace } from '@/types';

export function BrokerSearch() {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [fuel, setFuel] = useState('');
  const [brokerName, setBrokerName] = useState('');
  const [clientName, setClientName] = useState('');
  const [results, setResults] = useState<VehicleWithMarketplace[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedSearchId, setSavedSearchId] = useState<number | null>(null);

  async function handleSearch() {
    setLoading(true);
    setSearched(true);
    let query = supabase
      .from('vehicles')
      .select('*, vehicle_marketplace(*)')
      .is('deleted_at', null)
      .neq('status', 'SOLD');

    if (make.trim()) query = query.ilike('make', `%${make}%`);
    if (model.trim()) query = query.ilike('model', `%${model}%`);
    if (yearFrom) query = query.gte('model_year', parseInt(yearFrom));
    if (yearTo) query = query.lte('model_year', parseInt(yearTo));
    if (fuel) query = query.eq('fuel', fuel);

    query = query.order('our_price_eur', { ascending: true }).limit(20);

    const { data } = await query;
    setResults((data || []) as VehicleWithMarketplace[]);
    setLoading(false);

    // Save search
    const { data: saved } = await supabase
      .from('client_searches')
      .insert({
        broker_name: brokerName || null,
        client_name: clientName || null,
        make: make || 'Всички',
        model: model || null,
        year_from: yearFrom ? parseInt(yearFrom) : null,
        year_to: yearTo ? parseInt(yearTo) : null,
        fuel: fuel || null,
        outcome: (data || []).length > 0 ? `${(data || []).length} резултата` : 'Няма резултати',
      })
      .select('id')
      .single();

    if (saved) setSavedSearchId(saved.id);
  }

  async function updateOutcome(outcome: string, vehicleId: number | null) {
    if (savedSearchId) {
      await supabase
        .from('client_searches')
        .update({ outcome, found_vehicle_id: vehicleId })
        .eq('id', savedSearchId);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Клиентско търсене</h2>
        <p className="text-sm text-slate-500 mt-0.5">Търсене в MASTER каталога за клиентска оферта</p>
      </div>

      {/* Search form */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Брокер</label>
            <input
              type="text"
              value={brokerName}
              onChange={(e) => setBrokerName(e.target.value)}
              placeholder="Име на брокер"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Клиент</label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Име на клиент"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Марка</label>
            <input
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="напр. Hyundai"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Модел</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="напр. Sonata"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Година от</label>
            <input
              type="number"
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
              placeholder="2019"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Година до</label>
            <input
              type="number"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
              placeholder="2023"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Гориво</label>
            <select
              value={fuel}
              onChange={(e) => setFuel(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
            >
              <option value="">Всички</option>
              <option value="Diesel">Дизел</option>
              <option value="Gasoline">Бензин</option>
              <option value="Hybrid">Хибрид</option>
              <option value="Electric">Електрически</option>
            </select>
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {loading ? 'Търсене...' : 'Търси в каталога'}
        </button>
      </div>

      {/* Results */}
      {searched && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {loading ? 'Търсене...' : `${results.length} резултата`}
            </h3>
            {savedSearchId && (
              <Badge color="emerald">Търсенето е записано</Badge>
            )}
          </div>

          {!loading && results.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <Car className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm text-slate-400 mt-2">Няма намерени превозни средства</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((v) => {
                const marketplaces = v.vehicle_marketplace || [];
                const prices = getBestPrice(marketplaces as { marketplace?: string; final_eur: number | null; our_price_eur: number | null }[]);
                const koreaMp = marketplaces.find((m) => m.marketplace === 'korea');
                const canadaMp = marketplaces.find((m) => m.marketplace === 'canada');
                const bulgariaMp = marketplaces.find((m) => m.marketplace === 'mobile_bg');

                return (
                  <div key={v.permanent_id} className="bg-white rounded-xl border border-slate-200 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-slate-500">
                            {v.make.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {v.make} {v.model}
                          </p>
                          <p className="text-xs text-slate-400">
                            {v.model_year} · {v.fuel} · #{v.permanent_id}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Наша цена</p>
                        <p className="text-lg font-bold text-slate-900">{formatEUR(v.our_price_eur)}</p>
                      </div>
                    </div>

                    {/* Price comparison */}
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className={`rounded-lg p-3 border ${prices.bestSource === 'korea' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                        <p className="text-xs text-slate-500">Корея</p>
                        <p className={`text-sm font-bold ${prices.bestSource === 'korea' ? 'text-emerald-600' : 'text-slate-700'}`}>
                          {formatEUR(prices.korea)}
                        </p>
                        {koreaMp?.listing_url && (
                          <a href={koreaMp.listing_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-0.5 mt-1">
                            Обява <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      <div className={`rounded-lg p-3 border ${prices.bestSource === 'canada' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                        <p className="text-xs text-slate-500">Канада</p>
                        <p className={`text-sm font-bold ${prices.bestSource === 'canada' ? 'text-emerald-600' : 'text-slate-700'}`}>
                          {formatEUR(prices.canada)}
                        </p>
                        {canadaMp?.listing_url && (
                          <a href={canadaMp.listing_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-0.5 mt-1">
                            Обява <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                      <div className="rounded-lg p-3 border border-slate-200 bg-slate-50">
                        <p className="text-xs text-slate-500">България</p>
                        <p className="text-sm font-bold text-slate-700">{formatEUR(prices.bulgaria)}</p>
                        {bulgariaMp?.listing_url && (
                          <a href={bulgariaMp.listing_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-0.5 mt-1">
                            Обява <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {prices.bestSource && (
                      <div className="mt-3 flex items-center gap-2 text-sm">
                        <TrendingDown className="w-4 h-4 text-emerald-500" />
                        <span className="text-slate-600">
                          Най-изгоден източник: <span className="font-semibold text-emerald-600">
                            {prices.bestSource === 'korea' ? 'Корея' : 'Канада'}
                          </span>
                        </span>
                      </div>
                    )}

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => updateOutcome('Предложение изпратено', v.permanent_id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Отбелижи като предложение
                      </button>
                      <button
                        onClick={() => updateOutcome('Не е интересно', null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        Не е интересно
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
