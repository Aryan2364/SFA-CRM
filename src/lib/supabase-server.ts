import { createClient } from '@supabase/supabase-js'

// Uses SUPABASE_SERVICE_ROLE_KEY — bypasses RLS, server-only.
// Never expose this key to the browser.
export function createServerSupabase() {
  // SUPABASE_URL (no NEXT_PUBLIC_ prefix) is read at RUNTIME, so the deployed
  // container picks it up from .env.production. NEXT_PUBLIC_ vars are inlined
  // at build time and cannot be changed without a rebuild — hence the order.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key, { auth: { persistSession: false } })
}
