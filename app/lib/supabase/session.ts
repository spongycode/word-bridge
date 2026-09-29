import "server-only";
import { createSupabaseServerClient } from "./server";
import { isSupabaseConfigured } from "./client";

// Verified user id from the auth cookie (null for guests or when Supabase isn't configured)
export async function getSessionUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}
