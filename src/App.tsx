import { useEffect, useState } from 'react';
import { Bell, ChevronDown, Search, UserCircle } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import type { Page, AppMode } from '@/components/Sidebar';
import { Dashboard } from '@/pages/Dashboard';
import { VehicleList } from '@/pages/VehicleList';
import { VehicleDetail } from '@/pages/VehicleDetail';
import { Imports } from '@/pages/Imports';
import { Jobs } from '@/pages/Jobs';
import { Conflicts } from '@/pages/Conflicts';
import { BrokerSearch } from '@/pages/BrokerSearch';
import { Statistics } from '@/pages/Statistics';
import { Sales } from '@/pages/Sales';
import { supabase } from '@/lib/supabase';
import type { DraftSeed } from '@/lib/draft_seed';
import { createDraftFromSourceUrl } from '@/lib/draft_create';

function App() {
  const [page, setPage] = useState<Page>('vehicles');
  const [mode, setMode] = useState<AppMode>('admin');
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [draftToOpen, setDraftToOpen] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState(0);

  useEffect(() => {
    async function loadCount() {
      const { count } = await supabase.from('import_conflicts').select('*', { count: 'exact', head: true }).eq('resolved', false);
      setConflictCount(count || 0);
    }
    loadCount();
  }, [page]);

  function handleNavigate(nextPage: Page) { setPage(nextPage); setSelectedVehicle(null); if (nextPage !== 'imports') setDraftToOpen(null); }
  function handleSelectVehicle(id: number) { setSelectedVehicle(id); }
  async function handleCreateDraft(seed: DraftSeed) {
    try {
      if (!seed.sourceUrl) throw new Error('За тази каталожна позиция няма source URL.');
      const queued = await createDraftFromSourceUrl(seed.sourceUrl, 'ADMIN_CATALOG', {
        permanentId: seed.catalogPermanentId,
        title: seed.title,
      });
      setDraftToOpen(queued.id);
      setSelectedVehicle(null);
      setPage('imports');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Черновата не беше създадена.');
    }
  }
  function handleModeChange(nextMode: AppMode) { setMode(nextMode); setSelectedVehicle(null); setPage(nextMode === 'broker' ? 'broker' : 'dashboard'); }

  let content;
  if (page === 'vehicles' && selectedVehicle !== null) content = <VehicleDetail vehicleId={selectedVehicle} onBack={() => setSelectedVehicle(null)} onCreateDraft={handleCreateDraft} />;
  else if (page === 'vehicles') content = <VehicleList onSelectVehicle={handleSelectVehicle} onCreateDraft={handleCreateDraft} />;
  else if (page === 'dashboard') content = <Dashboard />;
  else if (page === 'imports') content = <Imports openDraftId={draftToOpen} onDraftOpened={() => setDraftToOpen(null)} />;
  else if (page === 'jobs') content = <Jobs />;
  else if (page === 'conflicts') content = <Conflicts />;
  else if (page === 'broker') content = <BrokerSearch />;
  else if (page === 'statistics') content = <Statistics />;
  else if (page === 'sales') content = <Sales />;
  else content = <Dashboard />;

  return <div className="flex min-h-screen bg-[#f5f7fb]">
    <Sidebar current={page} onNavigate={handleNavigate} conflictCount={conflictCount} mode={mode} onModeChange={handleModeChange} />
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
          <button className="hidden items-center gap-2 text-xs font-semibold sm:flex"><UserCircle className="h-7 w-7 text-slate-300" /> Admin <ChevronDown className="h-3.5 w-3.5 text-slate-400" /></button>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] p-3 sm:p-4 lg:p-5">{content}</main>
    </div>
  </div>;
}

export default App;
