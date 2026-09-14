import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://cgftjqwebvddtsbcbeml.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZnRqcXdlYnZkZHRzYmNiZW1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTkyMDMsImV4cCI6MjEwNDg5NTIwM30.JjW374ZSLxoSWQ7786aZlCbNyk9u2gKRdlb-dED-m0A';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Keep the UI alive long enough to show a useful configuration message when
// the hosting environment has not been configured yet.
export const supabase = createClient(
  supabaseUrl || 'https://not-configured.invalid',
  supabaseAnonKey || 'not-configured',
);
