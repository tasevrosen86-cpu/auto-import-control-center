import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  color?: string;
  size?: 'sm' | 'md';
}

const colorClasses: Record<string, string> = {
  emerald: 'bg-[#dff6e7] text-[#176b38] border-[#b8e6c8]',
  amber: 'bg-[#fff1c9] text-[#916300] border-[#f5d985]',
  blue: 'bg-[#e4efff] text-[#075bc5] border-[#c6dcff]',
  rose: 'bg-[#ffe4e5] text-[#b72b35] border-[#ffc6ca]',
  slate: 'bg-[#eef2f7] text-[#56657b] border-[#dde4ed]',
  violet: 'bg-[#eee7ff] text-[#7141be] border-[#d9c8ff]',
  cyan: 'bg-[#dcf7fb] text-[#08768a] border-[#b8eaf1]',
};

export function Badge({ children, color = 'slate', size = 'sm' }: BadgeProps) {
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const colorClass = colorClasses[color] || colorClasses.slate;
  return <span className={`inline-flex items-center gap-1 rounded border font-semibold ${colorClass} ${sizeClass}`}>{children}</span>;
}
