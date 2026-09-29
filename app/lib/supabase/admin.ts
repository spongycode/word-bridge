import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

// Service-role client for server-authoritative writes (bypasses RLS). Never import from client code.
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  if (adminClient) return adminClient;

  adminClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
