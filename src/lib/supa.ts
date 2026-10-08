/**
 * Supabase client — edge-function invokes (launch build/record, creator search)
 * + anon storage uploads (token images). The anon key is public by design (RLS
 * governs access) — same model as trends.fm web.
 */
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://xtkacuezimrxdgjpxujk.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0a2FjdWV6aW1yeGRnanB4dWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTkyMjEsImV4cCI6MjA4ODY5NTIyMX0.Df0gLhpCe_zuKZz3ynDquyXCG6qSvZv3DJDIglwLdkw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
