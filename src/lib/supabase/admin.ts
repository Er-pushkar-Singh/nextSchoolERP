import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Server-only client with the secret key. Bypasses RLS — use ONLY in API routes. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
