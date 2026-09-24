import { useState } from 'react';
import { Car, Search, Download, FileEdit, ShoppingCart, BarChart3, Activity, Users, Settings, Shield, User, LogOut, X, Menu, Rocket, Puzzle, Calculator, CheckCircle2 } from 'lucide-react';
import { ROLE_LABELS_BG, isSystemAdmin, signOut, type Profile } from '@/lib/session';

export type Page = 'vehicles' | 'broker' | 'imports' | 'published' | 'publications' | 'extension' | 'conflicts' | 'sales' | 'statistics' | 'jobs' | 'dashboard' | 'calculators';

interface SidebarProps {
  current: Page;
  onNavigate: (page: Page) => void;
  conflictCount: number;
  profile: Profile | null;
}

interface NavItem { id: Page; label: string; icon: typeof Car }

/**
 * «Публикуване» is the main workflow for Royal Cars BG: a link is imported, a
 * draft is filled in, photos are chosen, and the official Mobile.bg Import API
 * publishes it. «Публикувани обяви» is the result of that workflow — the list
 * the broker reads with a client waiting. «Browser Use» is the separate browser
 * automation path and is deliberately not the publisher for Royal Cars BG.
 */
const publishNav: NavItem[] = [
  { id: 'imports', label: 'Публикуване', icon: Download },
  { id: 'published', label: 'Публикувани обяви', icon: CheckCircle2 },
];

/**
 * The internal Cars Catalog belongs to the system administrator alone. It is not
 * merely hidden for anyone else: the `master_catalog` table returns no rows to a
 * broker or a company admin, so an entry in their menu would lead to an empty
 * page.
 */
const catalogNav: NavItem[] = [
  { id: 'vehicles', label: 'Каталог', icon: Car },
];

const restOfAdminNav: NavItem[] = [
  { id: 'broker', label: 'Търсене за клиент', icon: Search },
  { id: 'publications', label: 'Browser Use', icon: Rocket },
  { id: 'extension', label: 'Екстеншън', icon: Puzzle },
  { id: 'calculators', label: 'Калкулатори', icon: Calculator },
  { id: 'conflicts', label: 'Промени', icon: FileEdit },
  { id: 'sales', label: 'Продажби', icon: ShoppingCart },
  { id: 'statistics', label: 'Статистика', icon: BarChart3 },
  { id: 'jobs', label: 'AI / Автоматизация', icon: Activity },
];

const brokerNav: NavItem[] = [
  { id: 'broker', label: 'Търсене за клиент', icon: Search },
];

const systemNav: NavItem[] = [
  { id: 'dashboard', label: 'Потребители', icon: Users },
  { id: 'dashboard', label: 'Настройки', icon: Settings },
];

/**
 * What a role is shown. The menu is not the security boundary — every table is
 * scoped by row-level security, so a page reached by typing its URL still
 * returns no rows — but it should not offer a page that cannot show anything.
 */
function navFor(profile: Profile | null): NavItem[] {
  if (!profile) return [];

  if (isSystemAdmin(profile)) {
    // The owner keeps the whole application and works in Royal Cars BG through
    // the same publishing workflow as a company user.
    return [...catalogNav, ...publishNav, ...restOfAdminNav];
  }

  // A company admin and a broker see the publishing workflow and the published
  // list, and nothing that belongs to the system as a whole.
  return [...publishNav, ...brokerNav];
}

function NavContent({ current, onNavigate, conflictCount, profile }: SidebarProps) {
  const navItems = navFor(profile);
  const admin = isSystemAdmin(profile);

  return <>
    <div className="border-b border-white/10 px-3 py-2.5">
      <p className="truncate text-[11px] font-bold text-white">{profile?.full_name || 'Профил'}</p>
      <p className="mt-0.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
        {admin ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
        {profile ? ROLE_LABELS_BG[profile.role] : '—'}
      </p>
    </div>
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = current === item.id;
        return <button key={`${item.id}-${item.label}`} onClick={() => onNavigate(item.id)} className={`group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold transition ${active ? 'bg-[#087df5] text-white shadow-lg shadow-blue-950/30' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
          <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
          <span className="flex-1 truncate">{item.label}</span>
          {item.id === 'conflicts' && conflictCount > 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{conflictCount}</span>}
        </button>;
      })}
      {admin && <>
        <div className="px-2.5 pb-1 pt-5 text-[9px] font-bold uppercase tracking-wider text-slate-600">Система</div>
        {systemNav.map((item) => {
          const Icon = item.icon;
          return <button key={item.label} onClick={() => onNavigate(item.id)} className="group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold text-slate-400 transition hover:bg-white/10 hover:text-white">
            <Icon className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-white" />
            <span className="flex-1 truncate">{item.label}</span>
          </button>;
        })}
      </>}
    </nav>
    <div className="border-t border-white/10 px-3 py-3">
      <button onClick={() => void signOut()} className="flex items-center gap-2 text-[10px] text-slate-500 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Изход</button>
    </div>
  </>;
}

function SidebarLogo() {
  return <div className="flex h-[62px] items-center gap-2 border-b border-white/10 px-3">
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 shadow-lg shadow-blue-950/30">
      <Car className="h-5 w-5 text-white" />
    </div>
    <div className="min-w-0">
      <h1 className="truncate text-[13px] font-extrabold leading-4 text-white">Auto Import</h1>
      <p className="truncate text-[10px] font-semibold text-sky-300">Control Center</p>
    </div>
  </div>;
}

export function Sidebar(props: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleNavigate(page: Page) {
    props.onNavigate(page);
    setMobileOpen(false);
  }

  return <>
    {/* Desktop sidebar */}
    <aside className="hidden h-screen w-[182px] shrink-0 flex-col bg-[#111e2a] text-slate-300 shadow-xl lg:flex">
      <SidebarLogo />
      <NavContent {...props} />
    </aside>

    {/* Mobile hamburger trigger */}
    <button
      onClick={() => setMobileOpen(true)}
      className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-md bg-[#111e2a] text-white shadow-lg lg:hidden"
      aria-label="Отвори меню"
    >
      <Menu className="h-5 w-5" />
    </button>

    {/* Mobile overlay + drawer */}
    {mobileOpen && (
      <div className="fixed inset-0 z-50 lg:hidden">
        <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
        <aside className="absolute left-0 top-0 flex h-full w-[240px] flex-col bg-[#111e2a] text-slate-300 shadow-2xl">
          <div className="relative">
            <SidebarLogo />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-4 flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:text-white"
              aria-label="Затвори меню"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <NavContent {...props} onNavigate={handleNavigate} />
        </aside>
      </div>
    )}
  </>;
}
