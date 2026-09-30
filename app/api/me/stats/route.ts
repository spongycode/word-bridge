import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/app/lib/supabase/server";
import { getSessionUserId } from "@/app/lib/supabase/session";
import { getUtcDayString } from "@/app/lib/vocabulary";
import type { PlayerStats } from "@/app/lib/dailyRun";

export const dynamic = "force-dynamic";

const DAY_MS = 86400000;

function dayOffset(day: string, offset: number): string {
  return getUtcDayString(new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS));
}

// Signed-in player's daily streak and totals (reads only their own rows via RLS)
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to see your stats." }, { status: 401 });

  const supabase = await createSupabaseServerClient();
  const [{ data: runs }, { data: matches }] = await Promise.all([
    supabase.from("daily_runs").select("day, finished, gave_up, steps, score").eq("user_id", userId),
    supabase.from("match_results").select("result").eq("user_id", userId),
  ]);

  const played = (runs ?? []).filter((r) => r.finished);
  const solved = played.filter((r) => !r.gave_up);
  const solvedDays = new Set(solved.map((r) => r.day as string));
  const today = getUtcDayString();

  // Current streak may end today or yesterday (today not played yet keeps it alive)
  let currentStreak = 0;
  let cursor = solvedDays.has(today) ? today : dayOffset(today, -1);
  while (solvedDays.has(cursor)) {
    currentStreak++;
    cursor = dayOffset(cursor, -1);
  }

  let maxStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of [...solvedDays].sort()) {
    run = prev && dayOffset(prev, 1) === day ? run + 1 : 1;
    maxStreak = Math.max(maxStreak, run);
    prev = day;
  }

  const stats: PlayerStats = {
    currentStreak,
    maxStreak,
    dailyPlayed: played.length,
    dailySolved: solved.length,
    averageSteps: solved.length ? Math.round((solved.reduce((a, r) => a + (r.steps ?? 0), 0) / solved.length) * 10) / 10 : null,
    bestScore: solved.length ? Math.max(...solved.map((r) => r.score ?? 0)) : null,
    solvedToday: solvedDays.has(today),
    matchWins: (matches ?? []).filter((m) => m.result === "won").length,
    matchLosses: (matches ?? []).filter((m) => m.result === "lost").length,
  };
  return NextResponse.json(stats);
}
