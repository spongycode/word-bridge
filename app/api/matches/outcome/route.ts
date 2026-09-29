import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { getSessionUserId } from "@/app/lib/supabase/session";

export const dynamic = "force-dynamic";

// Lets a reconnecting player learn whether their opponent already won a round while they were away.
// Only works when the winner was signed in (their result is stored); match keys contain a random match id.
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^[0-9a-f-]{36}#\d{1,4}$/.test(key)) return NextResponse.json({ error: "Invalid match key" }, { status: 400 });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ winner: null });

  const userId = await getSessionUserId();
  let query = admin
    .from("match_results")
    .select("user_id, my_username, my_path")
    .eq("match_key", key)
    .eq("result", "won")
    .limit(1);
  if (userId) query = query.neq("user_id", userId);

  const { data } = await query;
  const row = data?.[0];
  return NextResponse.json({
    winner: row ? { name: row.my_username, path: row.my_path as string[] } : null,
  });
}
