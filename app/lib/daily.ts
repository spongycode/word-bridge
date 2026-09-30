import "server-only";
import { WordPair } from "@/app/domains";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { getDailyChallengePair, getUtcDayString } from "@/app/lib/vocabulary";
import { evaluateRelatedness } from "@/app/lib/typesafe";

const MAX_BASELINE = 30; // same bar as random puzzles
const MAX_DRAWS = 6;

export interface DailyPuzzle extends WordPair {
  day: string;
}

function toPuzzle(day: string, source: string, target: string, baselineScore: number): DailyPuzzle {
  return {
    day,
    source,
    target,
    baselineScore,
    categoryHint: `Daily Bridge #${day}`,
    difficulty: baselineScore < 15 ? "Expert" : "Hard",
  };
}

// Per-instance cache of today's stored puzzle (it never changes once stored), plus in-flight dedupe
let cached: DailyPuzzle | null = null;
let inflight: { day: string; promise: Promise<DailyPuzzle> } | null = null;

// Canonical daily puzzle: stored once per UTC day so every player gets the same pair and baseline
export async function getDailyPuzzle(): Promise<DailyPuzzle> {
  const day = getUtcDayString();
  if (cached?.day === day) return cached;
  if (inflight?.day === day) return inflight.promise;

  const promise = loadDailyPuzzle(day).finally(() => {
    if (inflight?.day === day) inflight = null;
  });
  inflight = { day, promise };
  return promise;
}

async function loadDailyPuzzle(day: string): Promise<DailyPuzzle> {
  const admin = getSupabaseAdmin();

  if (admin) {
    const { data } = await admin.from("daily_puzzles").select("*").eq("day", day).maybeSingle();
    if (data) return (cached = toPuzzle(day, data.source, data.target, data.baseline_score));
  }

  // Re-draw deterministically until the pair is distant enough to be a real challenge
  let { source, target } = getDailyChallengePair(day);
  let baselineScore = 15;
  for (let attempt = 0; attempt < MAX_DRAWS; attempt++) {
    const draw = getDailyChallengePair(day, attempt);
    try {
      const score = await evaluateRelatedness(draw.source, draw.target);
      ({ source, target } = draw);
      baselineScore = score;
      if (score < MAX_BASELINE) break;
    } catch (err) {
      console.error("Daily baseline eval error:", err);
      break;
    }
  }

  if (admin) {
    await admin
      .from("daily_puzzles")
      .upsert({ day, source, target, baseline_score: baselineScore }, { onConflict: "day", ignoreDuplicates: true });
    // Re-read so concurrent first requests all agree on the stored baseline
    const { data } = await admin.from("daily_puzzles").select("*").eq("day", day).maybeSingle();
    if (data) return (cached = toPuzzle(day, data.source, data.target, data.baseline_score));
  }

  return toPuzzle(day, source, target, baselineScore);
}
