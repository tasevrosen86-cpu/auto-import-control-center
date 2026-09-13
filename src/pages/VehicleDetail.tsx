import { useEffect, useState } from 'react';
import { ArrowLeft, Globe, History, Image as ImageIcon, FileText, ExternalLink, Hash, Gauge, Calendar, Calculator, Activity, Tag, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/Badge';
import { formatEUR, formatNumber, formatDate, formatDateTime, timeAgo, STATUS_COLORS, MARKETPLACE_LABELS, PRIORITY_LABELS, getStatusLabel, getBestPrice } from '@/lib/format';
import type { Vehicle, VehicleMarketplace, PriceHistory, ImageRecord, ListingHistory, VehicleStatusLog, Sale } from '@/types';
import { createDraftSeed, type DraftSeed } from '@/lib/draft_seed';

interface VehicleDetailProps { vehicleId: number; onBack: () => void; onCreateDraft: (seed: DraftSeed) => void; }

export function VehicleDetail({ vehicleId, onBack, onCreateDraft }: VehicleDetailProps) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [marketplace, setMarketplace] = useState<VehicleMarketplace[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [listingHistory, setListingHistory] = useState<ListingHistory[]>([]);
  const [statusLog, setStatusLog] = useState<VehicleStatusLog[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [vRes, mRes, pRes, iRes, lhRes, slRes, saRes] = await Promise.all([
        supabase.from('vehicles').select('*').eq('permanent_id', vehicleId).maybeSingle(),
        supabase.from('vehicle_marketplace').select('*').eq('vehicle_id', vehicleId).order('marketplace'),
        supabase.from('price_history').select('*').eq('vehicle_id', vehicleId).order('changed_at', { ascending: false }).limit(20),
        supabase.from('images').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }),
        supabase.from('listing_history').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(20),
        supabase.from('vehicle_status_log').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(20),
        supabase.from('sales').select('*').eq('vehicle_id', vehicleId).order('sale_date', { ascending: false }),
      ]);
      setVehicle(vRes.data as Vehicle | null);
      setMarketplace((mRes.data || []) as VehicleMarketplace[]);
      setPriceHistory((pRes.data || []) as PriceHistory[]);
      setImages((iRes.data || []) as ImageRecord[]);
      setListingHistory((lhRes.data || []) as ListingHistory[]);
      setStatusLog((slRes.data || []) as VehicleStatusLog[]);
      setSales((saRes.data || []) as Sale[]);
      setLoading(false);
    }
    load();
  }, [vehicleId]);

  if (loading) return <div className="flex h-96 items-center justify-center text-slate-400">Зареждане...</div>;
  if (!vehicle) return <div className="py-20 text-center"><p className="text-slate-400">Превозното средство не е намерено</p><button onClick={onBack} className="mt-4 text-xs text-blue-600 hover:underline">Обратно към каталога</button></div>;

  const raw = vehicle.raw_json as Record<string, unknown>;
  const prices = getBestPrice(marketplace as { marketplace?: string; final_eur: number | null; our_price_eur: number | null }[]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /> Обратно към каталога</button>

      {/* Header */}
      <div className="app-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 text-base font-bold text-slate-500">{vehicle.make.slice(0,2).toUpperCase()}</div>
            <div>
              <div className="flex items-center gap-2"><h2 className="text-lg font-extrabold tracking-tight text-slate-800">#{vehicle.permanent_id} – {vehicle.make} {vehicle.model}</h2><Badge color={STATUS_COLORS[vehicle.status]||'slate'}>{getStatusLabel(vehicle.status)}</Badge></div>
              <p className="text-xs text-slate-400">#{vehicle.permanent_id} · {vehicle.model_year} · {vehicle.fuel}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge color="blue">{PRIORITY_LABELS[vehicle.priority]}</Badge>
                {vehicle.flags_needs_review && <Badge color="rose">За преглед</Badge>}
                {vehicle.status === 'SOLD' && <Badge color="violet">Продаден</Badge>}
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Наша цена</p>
            <p className="text-xl font-extrabold text-slate-800">{formatEUR(vehicle.our_price_eur)}</p>
            {vehicle.notes && <p className="mt-1 max-w-xs text-[10px] text-slate-400">{vehicle.notes}</p>}
          </div>
        </div>
      </div>

      {/* Price comparison */}
      <div className="app-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Globe className="h-4 w-4 text-slate-400" /> Сравнение на цените по пазари</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PriceCard label={MARKETPLACE_LABELS.korea} price={prices.korea} isBest={prices.bestSource==='korea'} accent="blue" />
          <PriceCard label={MARKETPLACE_LABELS.canada} price={prices.canada} isBest={prices.bestSource==='canada'} accent="amber" />
          <PriceCard label={MARKETPLACE_LABELS.mobile_bg} price={prices.bulgaria} isBest={false} accent="emerald" isBulgaria />
        </div>
        {prices.bestSource && <div className="mt-3 text-xs text-slate-500">Най-изгоден източник: <span className="font-bold text-emerald-600">{prices.bestSource==='korea'?MARKETPLACE_LABELS.korea:MARKETPLACE_LABELS.canada}</span></div>}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoCard icon={Hash} label="Permanent ID" value={String(vehicle.permanent_id)} />
        <InfoCard icon={Calendar} label="Импортиран" value={formatDate(vehicle.last_import_at)} />
        <InfoCard icon={Gauge} label="Пробег" value={raw.mileage_km?`${formatNumber(Number(raw.mileage_km))} км`:'—'} />
        <InfoCard icon={FileText} label="Източник" value={vehicle.import_source||'—'} />
      </div>

      {/* Marketplace sections */}
      <div className="app-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Globe className="h-4 w-4 text-slate-400" /> Данни по пазари</h3>
        {marketplace.length === 0 ? <p className="py-4 text-xs text-slate-400">Няма пазарна информация</p> : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {marketplace.map((m) => {
              const marketImage = images.find((image) => image.marketplace === m.marketplace)?.source_url;
              const marketMeta = m.marketplace === 'korea' ? { flag: '🇰🇷', source: 'Encar', border: 'border-rose-200', tint: 'bg-rose-50/50', button: 'bg-red-600 hover:bg-red-700' } : m.marketplace === 'canada' ? { flag: '🇨🇦', source: 'AutoTrader', border: 'border-blue-200', tint: 'bg-blue-50/50', button: 'bg-blue-600 hover:bg-blue-700' } : { flag: '🇧🇬', source: 'mobile.bg', border: 'border-emerald-200', tint: 'bg-emerald-50/50', button: 'bg-emerald-700 hover:bg-emerald-800' };
              return <div key={m.id} className={`overflow-hidden rounded-md border ${marketMeta.border} bg-white`}>
                <div className={`flex items-center justify-between border-b px-3 py-2 ${marketMeta.tint}`}><h4 className="text-sm font-extrabold text-slate-800">{marketMeta.flag} {MARKETPLACE_LABELS[m.marketplace]||m.marketplace}</h4><span className="text-base font-extrabold text-slate-800">{marketMeta.source}</span></div>
                <div className="p-3"><div className="relative mb-3 h-36 overflow-hidden rounded-md bg-slate-100">{marketImage ? <img src={marketImage} alt={`${vehicle.make} ${vehicle.model}`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">{vehicle.make} {vehicle.model}</div>}<span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-[10px] font-bold text-white">1 / {images.filter((image) => image.marketplace === m.marketplace).length || 1}</span></div><h5 className="text-sm font-extrabold text-slate-800">{vehicle.make} {vehicle.model} {m.configuration || ''}</h5><p className="mb-2 text-xs text-slate-500">{vehicle.model_year} / {m.mileage_km ? `${formatNumber(m.mileage_km)} km` : 'Пробег —'}</p>
                <div className="space-y-1.5 text-xs">
                  <Row label="Цена източник" value={m.price_native?`${formatNumber(m.price_native)} ${m.price_currency||''}`:'—'} />
                  <Row label="EUR цена" value={formatEUR(m.final_eur)} />
                  <Row label="Наша цена" value={formatEUR(m.our_price_eur)} />
                  <Row label="Пробег" value={m.mileage_km?`${formatNumber(m.mileage_km)} км`:'—'} />
                  <Row label="VIN" value={m.vin||'—'} />
                  <Row label="Конфигурация" value={m.configuration||'—'} />
                  <Row label="Listing ID" value={m.listing_id||'—'} />
                  <Row label="Проверка" value={timeAgo(m.last_check)} />
                  {m.publication_status && <Row label="Публикуване" value={getStatusLabel(m.publication_status)} />}
                  {m.market_status && <Row label="Статус пазар" value={getStatusLabel(m.market_status)} />}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {m.filter_url && <a href={m.filter_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"><Search className="h-3 w-3" /> Филтър <ExternalLink className="h-3 w-3" /></a>}
                    {m.listing_url && <a href={m.listing_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline"><Tag className="h-3 w-3" /> Обява <ExternalLink className="h-3 w-3" /></a>}
                    {m.our_listing_url && <a href={m.our_listing_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-emerald-600 hover:underline"><Tag className="h-3 w-3" /> Наша обява <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <a href={m.listing_url || '#'} target="_blank" rel="noopener noreferrer" className={`flex h-9 items-center justify-center gap-2 rounded text-xs font-bold text-white ${marketMeta.button}`}>Отвори обявата в {marketMeta.source} <ExternalLink className="h-3.5 w-3.5" /></a>
                  <button className="h-8 w-full rounded bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200">Копирай линк</button>
                  {(m.marketplace === 'korea' || m.marketplace === 'canada') && m.listing_url && (
                    <button onClick={() => onCreateDraft(createDraftSeed(vehicle, marketplace, m.marketplace === 'korea' ? 'korea' : 'canada'))} className="h-8 w-full rounded bg-blue-600 text-xs font-bold text-white hover:bg-blue-700">
                      {m.marketplace === 'korea' ? 'Публикувай корейската' : 'Публикувай канадската'}
                    </button>
                  )}
                </div>
                </div>
              </div>;
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><History className="h-4 w-4 text-slate-400" /> История на цените</h3>
          {priceHistory.length===0 ? <p className="py-4 text-xs text-slate-400">Няма записани промени в цените</p> : (
            <div className="space-y-1.5">
              {priceHistory.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                  <div><p className="text-xs text-slate-700">{formatNumber(p.old_price)} → {formatNumber(p.new_price)} {p.currency}</p><p className="text-[10px] text-slate-400">{p.reason||p.change_type} · {MARKETPLACE_LABELS[p.marketplace]||p.marketplace}</p></div>
                  <span className="text-[10px] text-slate-400">{formatDateTime(p.changed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Activity className="h-4 w-4 text-slate-400" /> История на обявите</h3>
          {listingHistory.length===0 ? <p className="py-4 text-xs text-slate-400">Няма записана история на обявите</p> : (
            <div className="space-y-1.5">
              {listingHistory.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                  <div><p className="text-xs text-slate-700">{l.event_type}</p><p className="text-[10px] text-slate-400">{l.listing_id?`Listing: ${l.listing_id}`:''} · {MARKETPLACE_LABELS[l.marketplace]||l.marketplace}</p></div>
                  <span className="text-[10px] text-slate-400">{formatDateTime(l.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Activity className="h-4 w-4 text-slate-400" /> Статус история</h3>
          {statusLog.length===0 ? <p className="py-4 text-xs text-slate-400">Няма промени на статуса</p> : (
            <div className="space-y-1.5">
              {statusLog.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                  <div className="flex items-center gap-1.5">
                    {s.old_status && <Badge color={STATUS_COLORS[s.old_status]||'slate'}>{getStatusLabel(s.old_status)}</Badge>}
                    <span className="text-slate-300">→</span>
                    <Badge color={STATUS_COLORS[s.new_status]||'slate'}>{getStatusLabel(s.new_status)}</Badge>
                  </div>
                  <div className="text-right"><p className="text-[10px] text-slate-400">{s.actor}</p><p className="text-[10px] text-slate-400">{formatDateTime(s.created_at)}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="app-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><Tag className="h-4 w-4 text-slate-400" /> Продажби</h3>
          {sales.length===0 ? <p className="py-4 text-xs text-slate-400">Няма записани продажби</p> : (
            <div className="space-y-1.5">
              {sales.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
                  <div><p className="text-xs font-bold text-emerald-600">{formatEUR(s.sale_price_eur)}</p><p className="text-[10px] text-slate-400">{MARKETPLACE_LABELS[s.marketplace]||s.marketplace} · {formatDate(s.sale_date)}</p></div>
                  {s.buyer_name && <span className="text-[10px] text-slate-500">{s.buyer_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="app-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-700"><ImageIcon className="h-4 w-4 text-slate-400" /> Снимки</h3>
        {images.length===0 ? <p className="py-4 text-xs text-slate-400">Няма снимки</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {images.map((img) => (
              <div key={img.id} className="flex aspect-square items-center justify-center rounded-md border border-slate-200 bg-slate-100">
                <div className="text-center"><ImageIcon className="mx-auto h-5 w-5 text-slate-300" /><p className="mt-1 text-[10px] text-slate-400">{getStatusLabel(img.status)}</p></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="app-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-700"><Calculator className="h-4 w-4 text-slate-400" /> Калкулации / сурови данни</h3>
        <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 font-mono text-[10px] text-slate-600">{JSON.stringify(vehicle.raw_json, null, 2)}</pre>
      </div>

      {vehicle.flags_reasons.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
          <h3 className="mb-2 text-xs font-bold text-rose-700">Флагове за преглед</h3>
          <div className="flex flex-wrap gap-1.5">{vehicle.flags_reasons.map((r) => <Badge key={r} color="rose">{r}</Badge>)}</div>
        </div>
      )}
    </div>
  );
}

function PriceCard({ label, price, isBest, accent, isBulgaria }: { label: string; price: number | null; isBest: boolean; accent: string; isBulgaria?: boolean }) {
  const c: Record<string,string> = { blue:'border-blue-200 bg-blue-50/50', amber:'border-amber-200 bg-amber-50/50', emerald:'border-emerald-200 bg-emerald-50/50' };
  return (
    <div className={`rounded-md border-2 p-3 ${c[accent]} ${isBest?'ring-2 ring-emerald-400':''}`}>
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-extrabold ${price===null?'text-slate-300':isBest?'text-emerald-600':'text-slate-800'}`}>{formatEUR(price)}</p>
      {isBest && <p className="mt-1 text-[10px] text-emerald-600">Най-изгоден източник</p>}
      {isBulgaria && <p className="mt-1 text-[10px] text-slate-400">Съпоставима цена в България</p>}
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: string }) {
  return (
    <div className="app-card p-3">
      <div className="mb-1 flex items-center gap-1.5 text-slate-400"><Icon className="h-3 w-3" /><span className="text-[10px] font-medium">{label}</span></div>
      <p className="text-xs font-bold text-slate-800">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-slate-400">{label}</span><span className="text-right font-medium text-slate-700">{value}</span></div>;
}
