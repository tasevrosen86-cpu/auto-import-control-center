import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * The gate no longer decides who is allowed in. It used to compare the signed-in
 * email with a single address compiled into the bundle, which could not express
 * a second company and put the answer in the browser. Now any account can sign
 * in; what that account may see is read from `profiles` by `SessionProvider`, and
 * what it may read is decided by row-level security in the database.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
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
    setSubmitting(true);
    setMessage('');

    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    setSubmitting(false);
    if (result.error) {
      setMessage(
        result.error.message === 'Invalid login credentials'
          ? 'Грешен email или парола.'
          : result.error.message,
      );
      return;
    }
  }

  if (!isSupabaseConfigured) {
    return <Screen><h1>Нужна е настройка</h1><p>Липсват данните за връзка със Supabase на сървъра.</p></Screen>;
  }

  if (loading) return <Screen><p>Зареждане…</p></Screen>;

  if (session) return <>{children}</>;

  return <Screen>
    <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-xl">
      <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-blue-600">Auto Import Control Center</p>
      <h1 className="text-2xl font-bold text-slate-900">Вход</h1>
      <p className="mt-2 text-sm text-slate-600">Влез с предоставения ти акаунт.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium text-slate-700">Email
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">Парола
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {message && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
        <button
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {submitting ? 'Изчакване…' : 'Вход'}
        </button>
      </form>
    </div>
  </Screen>;
}

function Screen({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-center text-slate-700">{children}</main>;
}
