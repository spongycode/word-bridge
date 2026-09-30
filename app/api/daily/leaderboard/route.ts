import { NextResponse } from "next/server";
import { getSessionUserId } from "@/app/lib/supabase/session";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { getUtcDayString } from "@/app/lib/vocabulary";
import type { LeaderboardEntry, LeaderboardResponse } from "@/app/lib/dailyRun";
import { createTimer } from "@/app/lib/timing";

export const dynamic = "force-dynamic";

const TOP_N = 50;

export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Leaderboard is not configured on the server." }, { status: 500 });

  const timer = createTimer();
  const day = getUtcDayString();

  const [userId, { data, error }] = await timer.time("db", Promise.all([
    getSessionUserId(),
    admin
    .from("daily_runs")
    .select("user_id, score, steps, failed_attempts, path, finished_at, profiles(username)")
    .eq("day", day)
    .eq("finished", true)
    .eq("gave_up", false)
    .order("score", { ascending: false })
    .order("steps", { ascending: true })
    .order("finished_at", { ascending: true })
    .limit(1000),
  ]));

  if (error) {
    console.error("Leaderboard query failed:", error.message);
    return NextResponse.json({ error: "Couldn't load the leaderboard. Try again in a moment." }, { status: 500 });
  }

  const rows = data ?? [];
  // Paths are spoilers: only reveal them to players who already finished today
  const pathsVisible = Boolean(userId && rows.some((r) => r.user_id === userId));

  const ranked: LeaderboardEntry[] = rows.map((r: any, i) => ({
    rank: i + 1,
    username: r.profiles?.username ?? "Player",
    score: r.score,
    steps: r.steps,
    misses: r.failed_attempts,
    path: pathsVisible ? r.path : undefined,
    isMe: r.user_id === userId,
  }));

  const body: LeaderboardResponse = {
    day,
    totalFinished: ranked.length,
    entries: ranked.slice(0, TOP_N),
    me: ranked.find((e) => e.isMe) ?? null,
    pathsVisible,
  };
  return NextResponse.json(body, { headers: { "Server-Timing": timer.header() } });
}
