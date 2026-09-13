import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Keep the UI alive long enough to show a useful configuration message when
// the hosting environment has not been configured yet.
export const supabase = createClient(
  supabaseUrl || 'https://not-configured.invalid',
  supabaseAnonKey || 'not-configured',
);
