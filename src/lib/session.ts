import { createContext, createElement, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type UserRole = 'SYSTEM_ADMIN' | 'COMPANY_ADMIN' | 'BROKER';

export interface Profile {
  user_id: string;
  company_id: string | null;
  role: UserRole;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
}

export interface SessionState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Set when the user is signed in but cannot be placed in the system. */
  blockedReason: string | null;
}

/**
 * What each role may see. The menu is built from this, but it is not the
 * security boundary — every table is scoped by row-level security in the
 * database, so a role that reached a page by typing a URL would still be given
 * no rows. This only decides what is worth showing.
 */
export const ROLE_LABELS_BG: Record<UserRole, string> = {
  SYSTEM_ADMIN: 'Системен администратор',
  COMPANY_ADMIN: 'Управител',
  BROKER: 'Брокер',
};

export function isSystemAdmin(profile: Profile | null): boolean {
  return profile?.role === 'SYSTEM_ADMIN';
}

/**
 * The master catalog is the internal Cars Catalog and belongs to the system
 * administrator alone. A company admin and a broker must not reach it; this is
 * the same rule the `master_catalog` policy enforces in the database.
 */
export function canReadMasterCatalog(profile: Profile | null): boolean {
  return isSystemAdmin(profile);
}

export function canManageUsers(profile: Profile | null): boolean {
  return profile?.role === 'SYSTEM_ADMIN' || profile?.role === 'COMPANY_ADMIN';
}

export function canSeeSales(profile: Profile | null): boolean {
  return profile !== null && profile.status === 'ACTIVE';
}

const SessionContext = createContext<SessionState>({
  session: null,
  profile: null,
  loading: true,
  blockedReason: null,
});

export function useSession(): SessionState {
  return useContext(SessionContext);
}

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, company_id, role, full_name, email, phone, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return (data as Profile) || null;
}

/**
 * Reads the signed-in user's profile and keeps it in step with the auth session.
 *
 * The profile is what decides access now. The old gate compared the signed-in
 * email with one address written into the bundle, so the answer was the same for
 * every deployment of that build and could not express a second company. Here
 * the answer comes from `profiles`, which an administrator maintains.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({
    session: null,
    profile: null,
    loading: true,
    blockedReason: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function apply(session: Session | null) {
      if (!session?.user) {
        if (!cancelled) setState({ session: null, profile: null, loading: false, blockedReason: null });
        return;
      }

      const profile = await loadProfile(session.user.id);
      if (cancelled) return;

      // A signed-in user with no profile has not been placed in a company yet.
      // Saying so is friendlier than an empty application, and it is the state a
      // brand-new sign-up is in until an administrator assigns them.
      const blockedReason = !profile
        ? 'Профилът не е настроен. Помоли администратор да те добави към фирма.'
        : profile.status !== 'ACTIVE'
          ? 'Профилът е спрян. Свържи се с администратор.'
          : null;

      setState({ session, profile, loading: false, blockedReason });
    }

    supabase.auth.getSession().then(({ data }) => apply(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      apply(nextSession);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return createElement(SessionContext.Provider, { value: state }, children);
}

export async function signOut() {
  await supabase.auth.signOut();
}
