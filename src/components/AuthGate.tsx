import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const ADMIN_EMAIL = 'tasevrosen86@gmail.com';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 10) {
      setMessage('Избери парола с поне 10 символа.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    const options = { email: ADMIN_EMAIL, password };
    const result = registering
      ? await supabase.auth.signUp({ ...options, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword(options);

    setSubmitting(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (registering && !result.data.session) {
      setMessage('Провери email-а си и потвърди регистрацията, след което влез оттук.');
    }
  }

  if (!isSupabaseConfigured) {
    return <Screen><h1>Нужна е настройка</h1><p>Липсват данните за връзка със Supabase на сървъра.</p></Screen>;
  }

  if (loading) return <Screen><p>Зареждане…</p></Screen>;

  if (session?.user.email?.toLowerCase() === ADMIN_EMAIL) return <>{children}</>;

  if (session) {
    void supabase.auth.signOut();
    return <Screen><h1>Нямаш достъп</h1><p>Този сайт е достъпен само за администратора.</p></Screen>;
  }

  return <Screen>
    <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-xl">
      <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-blue-600">Auto Import Control Center</p>
      <h1 className="text-2xl font-bold text-slate-900">{registering ? 'Създай вход' : 'Вход'}</h1>
      <p className="mt-2 text-sm text-slate-600">{ADMIN_EMAIL}</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium text-slate-700">Парола
          <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" type="password" autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {message && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
        <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60" disabled={submitting} type="submit">{submitting ? 'Изчакване…' : registering ? 'Регистрация' : 'Вход'}</button>
      </form>
      <button className="mt-5 text-sm font-medium text-blue-700 hover:underline" onClick={() => { setRegistering((value) => !value); setMessage(''); setPassword(''); }} type="button">{registering ? 'Вече имаш вход? Влез' : 'Първо влизане? Създай вход'}</button>
    </div>
  </Screen>;
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-center text-slate-700">{children}</main>;
}
