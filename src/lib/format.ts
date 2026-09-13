export function formatEUR(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('bg-BG', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('bg-BG').format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('bg-BG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString('bg-BG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `преди ${days}д`;
  if (hours > 0) return `преди ${hours}ч`;
  if (minutes > 0) return `преди ${minutes}м`;
  return 'сега';
}

export const MARKETPLACE_LABELS: Record<string, string> = {
  korea: 'Корея / Encar',
  canada: 'Канада / AutoTrader',
  mobile_bg: 'България / Mobile.bg',
};

export const MARKETPLACE_SHORT: Record<string, string> = {
  korea: 'KR',
  canada: 'CA',
  mobile_bg: 'BG',
};

export const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'emerald',
  UNCHANGED: 'slate',
  CHANGED: 'amber',
  NEEDS_RECALCULATION: 'amber',
  NEEDS_PUBLISHING: 'blue',
  NO_VALID_REPLACEMENT: 'rose',
  SOLD: 'violet',
  PAUSED: 'slate',
  NEEDS_HUMAN_REVIEW: 'rose',
  INACTIVE: 'slate',
  REVIEW: 'amber',
  QUEUED: 'slate',
  RUNNING: 'blue',
  COMPLETED: 'emerald',
  FAILED: 'rose',
  PENDING: 'amber',
  DONE: 'emerald',
  PUBLISHED: 'emerald',
  LISTED: 'blue',
  AVAILABLE: 'emerald',
};

export const STATUS_LABELS_BG: Record<string, string> = {
  ACTIVE: 'Активен',
  UNCHANGED: 'Без промяна',
  CHANGED: 'Променен',
  NEEDS_RECALCULATION: 'Преизчисление',
  NEEDS_PUBLISHING: 'За публикуване',
  NO_VALID_REPLACEMENT: 'Без валидна обява',
  SOLD: 'Продаден',
  PAUSED: 'Паузиран',
  NEEDS_HUMAN_REVIEW: 'За преглед',
  INACTIVE: 'Неактивен',
  REVIEW: 'За преглед',
  QUEUED: 'На опашка',
  RUNNING: 'Изпълнява се',
  COMPLETED: 'Завършен',
  FAILED: 'Провален',
  PENDING: 'Чака',
  DONE: 'Готов',
  PUBLISHED: 'Публикуван',
  LISTED: 'Обявен',
  AVAILABLE: 'Наличен',
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Критичен',
  2: 'Висок',
  3: 'Нормален',
  4: 'Нисък',
  5: 'Минимален',
};

export function getStatusLabel(status: string): string {
  return STATUS_LABELS_BG[status] || status;
}

export function getBestPrice(marketplace: { final_eur: number | null; our_price_eur: number | null }[]): {
  korea: number | null;
  canada: number | null;
  bulgaria: number | null;
  bestSource: 'korea' | 'canada' | null;
} {
  const korea = marketplace.find((m) => (m as { marketplace?: string }).marketplace === 'korea');
  const canada = marketplace.find((m) => (m as { marketplace?: string }).marketplace === 'canada');
  const bulgaria = marketplace.find((m) => (m as { marketplace?: string }).marketplace === 'mobile_bg');

  const koreaPrice = korea?.final_eur ?? null;
  const canadaPrice = canada?.final_eur ?? null;
  const bulgariaPrice = bulgaria?.final_eur ?? null;

  let bestSource: 'korea' | 'canada' | null = null;
  if (koreaPrice !== null && canadaPrice !== null) {
    bestSource = koreaPrice <= canadaPrice ? 'korea' : 'canada';
  } else if (koreaPrice !== null) {
    bestSource = 'korea';
  } else if (canadaPrice !== null) {
    bestSource = 'canada';
  }

  return { korea: koreaPrice, canada: canadaPrice, bulgaria: bulgariaPrice, bestSource };
}

const CLOSE_THRESHOLD_PCT = 0.05;

export type PriceColor = 'green' | 'amber' | 'red' | 'neutral';

export function getPriceColor(sourcePrice: number | null, bgPrice: number | null): PriceColor {
  if (sourcePrice == null) return 'neutral';
  if (bgPrice == null || bgPrice === 0) return 'neutral';
  const diff = bgPrice - sourcePrice;
  const pct = Math.abs(diff) / bgPrice;
  if (diff > 0 && pct > CLOSE_THRESHOLD_PCT) return 'green';
  if (diff < 0 && pct > CLOSE_THRESHOLD_PCT) return 'red';
  return 'amber';
}

export function priceColorClass(color: PriceColor): string {
  switch (color) {
    case 'green': return 'bg-emerald-50 text-emerald-800';
    case 'amber': return 'bg-amber-50 text-amber-800';
    case 'red': return 'bg-rose-50 text-rose-800';
    default: return 'bg-slate-50 text-slate-500';
  }
}

export function calcDiff(sourcePrice: number | null | undefined, bgPrice: number | null | undefined): string {
  if (sourcePrice == null || bgPrice == null) return '—';
  const diff = bgPrice - sourcePrice;
  const sign = diff >= 0 ? '+ ' : '- ';
  return `${sign}${formatEUR(Math.abs(diff))}`;
}

export function diffColor(sourcePrice: number | null | undefined, bgPrice: number | null | undefined): string {
  if (sourcePrice == null || bgPrice == null) return 'text-slate-400';
  const diff = bgPrice - sourcePrice;
  if (diff > 0) return 'text-emerald-700';
  if (diff < 0) return 'text-rose-700';
  return 'text-amber-700';
}
