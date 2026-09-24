import { useEffect, useState } from 'react';
import { Bell, ChevronDown, Search, ShieldCheck, UserCircle } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import type { Page } from '@/components/Sidebar';
import { Dashboard } from '@/pages/Dashboard';
import { VehicleList } from '@/pages/VehicleList';
import { VehicleDetail } from '@/pages/VehicleDetail';
import { Imports } from '@/pages/Imports';
import { PublishedListings } from '@/pages/PublishedListings';
import { Jobs } from '@/pages/Jobs';
import { Conflicts } from '@/pages/Conflicts';
import { BrokerSearch } from '@/pages/BrokerSearch';
import { Statistics } from '@/pages/Statistics';
import { Sales } from '@/pages/Sales';
import { Publications } from '@/pages/Publications';
import { Extension } from '@/pages/Extension';
import { Calculators } from '@/pages/Calculators';
import { supabase } from '@/lib/supabase';
import type { DraftSeed } from '@/lib/draft_seed';
import { createDraftFromCatalog } from '@/lib/draft_create';
import { ROLE_LABELS_BG, isSystemAdmin, useSession } from '@/lib/session';

function App() {
  const { profile, loading, blockedReason } = useSession();
  const [page, setPage] = useState<Page>('imports');
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [draftToOpen, setDraftToOpen] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState(0);

  const admin = isSystemAdmin(profile);

  // The catalog belongs to the system administrator, so everyone else starts on
  // the publishing workflow. Landing a broker on a page that returns no rows
  // would look like a broken system.
  useEffect(() => {
    if (!loading && !admin) setPage('imports');
  }, [loading, admin]);

  useEffect(() => {
    async function loadCount() {
      const { count } = await supabase.from('import_conflicts').select('*', { count: 'exact', head: true }).eq('resolved', false);
      setConflictCount(count || 0);
    }
    if (profile) loadCount();
  }, [page, profile]);

  function handleNavigate(nextPage: Page) { setPage(nextPage); setSelectedVehicle(null); if (nextPage !== 'imports') setDraftToOpen(null); }
  function handleSelectVehicle(id: number) { setSelectedVehicle(id); }
  async function handleCreateDraft(seed: DraftSeed) {
    try {
      const draftId = await createDraftFromCatalog(seed);
      setDraftToOpen(draftId);
      setSelectedVehicle(null);
      setPage('imports');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Черновата от Каталога не беше създадена.');
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] text-slate-500">Зареждане…</div>;

  if (blockedReason) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4">
      <div className="max-w-md rounded-2xl bg-white p-7 text-center shadow-xl">
        <h1 className="text-lg font-bold text-slate-900">Достъпът не е настроен</h1>
        <p className="mt-2 text-sm text-slate-600">{blockedReason}</p>
      </div>
    </div>;
  }

  let content;
  if (page === 'vehicles' && selectedVehicle !== null) content = <VehicleDetail vehicleId={selectedVehicle} onBack={() => setSelectedVehicle(null)} onCreateDraft={handleCreateDraft} />;
  else if (page === 'vehicles') content = <VehicleList onSelectVehicle={handleSelectVehicle} onCreateDraft={handleCreateDraft} />;
  else if (page === 'dashboard') content = <Dashboard />;
  else if (page === 'imports') content = <Imports openDraftId={draftToOpen} onDraftOpened={() => setDraftToOpen(null)} />;
  else if (page === 'published') content = <PublishedListings />;
  else if (page === 'jobs') content = <Jobs />;
  else if (page === 'conflicts') content = <Conflicts />;
  else if (page === 'broker') content = <BrokerSearch />;
  else if (page === 'statistics') content = <Statistics />;
  else if (page === 'sales') content = <Sales />;
  else if (page === 'publications') content = <Publications />;
  else if (page === 'extension') content = <Extension />;
  else if (page === 'calculators') content = <Calculators />;
  else content = <Imports openDraftId={draftToOpen} onDraftOpened={() => setDraftToOpen(null)} />;

  return <div className="flex min-h-screen bg-[#f5f7fb]">
    <Sidebar current={page} onNavigate={handleNavigate} conflictCount={conflictCount} profile={profile} />
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-[62px] items-center gap-4 border-b border-slate-200 bg-[#142330] px-4 text-white shadow-md lg:px-5">
        <div className="flex min-w-0 flex-1 items-center justify-center lg:justify-start">
          <div className="relative w-full max-w-[605px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input placeholder="Търсене по марка, модел, година, гориво, VIN, ID..." className="h-10 w-full rounded-md border border-slate-200 bg-white px-10 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300" />
            <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-400 sm:block">⌘ K</kbd>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="relative text-slate-300 hover:text-white"><Bell className="h-5 w-5" /><span className="absolute -right-1.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold">3</span></button>
          <div className="hidden items-center gap-2 text-xs font-semibold sm:flex">
            {admin ? <ShieldCheck className="h-5 w-5 text-sky-300" /> : <UserCircle className="h-7 w-7 text-slate-300" />}
            <span className="max-w-[160px] truncate">{profile?.full_name || profile?.email || 'Профил'}</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-200">{profile ? ROLE_LABELS_BG[profile.role] : ''}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] p-3 sm:p-4 lg:p-5">{content}</main>
    </div>
  </div>;
}

export default App;
