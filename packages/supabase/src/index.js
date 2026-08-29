import { createClient } from '@supabase/supabase-js';

export function createSupabaseClient({ url, key, secret } = {}) {
  const supabaseUrl = String(url || process.env.SUPABASE_URL || '');
  const supabaseKey = String(key || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '');
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

export function createSupabaseAdminClient({ url, key } = {}) {
  const supabaseUrl = String(url || process.env.SUPABASE_URL || '');
  const supabaseKey = String(key || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

export function getSupabaseStatus(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const anon = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  const service = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return Object.freeze({
    configured: Boolean(url && anon),
    hasServiceRole: Boolean(service),
    url: url || null,
    missing: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'].filter((k) => !String(env[k] || '').trim())
  });
}
