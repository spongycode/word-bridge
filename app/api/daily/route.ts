import { NextResponse } from "next/server";
import { getSessionUserId } from "@/app/lib/supabase/session";
import { enforceRateLimit } from "@/app/lib/rateLimit";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { getDailyPuzzle } from "@/app/lib/daily";
import { evaluateStep, validateCandidate, EvaluationError, STEP_THRESHOLD } from "@/app/lib/typesafe";
import { calculateGameScore } from "@/app/lib/scoring";
import type { DailyRunState } from "@/app/lib/dailyRun";

export const dynamic = "force-dynamic";

function toRunState(row: any): DailyRunState {
  return {
    path: row.path,
    stepScores: row.step_scores,
    failedAttempts: row.failed_attempts,
    lastProximity: row.last_proximity,
    finished: row.finished,
  };
}

// GET: today's puzzle plus the signed-in player's ranked run (if any)
export async function GET() {
  const puzzle = await getDailyPuzzle();
  const userId = await getSessionUserId();
  const admin = getSupabaseAdmin();

  let run: DailyRunState | null = null;
  if (userId && admin) {
    const { data } = await admin
      .from("daily_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("day", puzzle.day)
      .maybeSingle();
    if (data) run = toRunState(data);
  }

  return NextResponse.json({ puzzle, run, ranked: Boolean(userId && admin) });
}

// POST { word }: server-authoritative step for the ranked daily run
export async function POST(req: Request) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return NextResponse.json({ error: "Sign in to play the ranked daily." }, { status: 401 });

    const limited = await enforceRateLimit(`user:${userId}`);
    if (limited) return limited;

    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: "Leaderboard is not configured on the server." }, { status: 500 });

    const { word } = await req.json();
    const candidate = validateCandidate(word);
    const puzzle = await getDailyPuzzle();

    // Load or create today's run (one attempt per player per day)
    let { data: row } = await admin
      .from("daily_runs")
      .select("*")
      .eq("user_id", userId)
      .eq("day", puzzle.day)
      .maybeSingle();

    if (!row) {
      const { error: insertError } = await admin
        .from("daily_runs")
        .upsert(
          { user_id: userId, day: puzzle.day, path: [puzzle.source], last_proximity: puzzle.baselineScore ?? 0 },
          { onConflict: "user_id,day", ignoreDuplicates: true }
        );
      if (insertError) throw new EvaluationError(`Could not start daily run: ${insertError.message}`, 500);
      ({ data: row } = await admin
        .from("daily_runs")
        .select("*")
        .eq("user_id", userId)
        .eq("day", puzzle.day)
        .single());
    }

    if (row.finished) {
      return NextResponse.json({ error: "You already completed today's challenge." }, { status: 409 });
    }
    if (row.path.includes(candidate)) {
      return NextResponse.json({ error: `"${candidate}" is already in your path.` }, { status: 400 });
    }

    const previous: string = row.path[row.path.length - 1];
    const evaluation = await evaluateStep(previous, candidate, puzzle.target);
    if (!evaluation.isRealWord) {
      return NextResponse.json({ error: `"${candidate}" is not a recognized word.` }, { status: 400 });
    }

    const proximity = evaluation.proximity ?? 0;
    const path: string[] = [...row.path];
    const stepScores: number[] = [...row.step_scores];
    let failedAttempts: number = row.failed_attempts;
    let lastProximity: number = row.last_proximity;
    let finished = false;
    const accepted = evaluation.relatedness >= STEP_THRESHOLD;

    if (!accepted) {
      failedAttempts += 1;
    } else {
      path.push(candidate);
      stepScores.push(evaluation.relatedness);
      lastProximity = proximity;
      if (candidate === puzzle.target) {
        finished = true;
      } else if (proximity >= STEP_THRESHOLD) {
        // Auto-connect to the target when close enough
        path.push(puzzle.target);
        stepScores.push(proximity);
        finished = true;
      }
    }

    const breakdown = finished
      ? calculateGameScore({
          baselineScore: puzzle.baselineScore ?? 15,
          stepCount: path.length - 1,
          stepSimilarities: stepScores,
          failedAttempts,
        })
      : null;

    // Optimistic concurrency: reject if another request updated the run first
    const { data: updated, error: updateError } = await admin
      .from("daily_runs")
      .update({
        path,
        step_scores: stepScores,
        failed_attempts: failedAttempts,
        last_proximity: lastProximity,
        finished,
        steps: finished ? path.length - 1 : null,
        score: breakdown?.totalScore ?? null,
        rank: breakdown?.rank ?? null,
        finished_at: finished ? new Date().toISOString() : null,
        version: row.version + 1,
      })
      .eq("user_id", userId)
      .eq("day", puzzle.day)
      .eq("version", row.version)
      .select("*")
      .maybeSingle();

    if (updateError) throw new EvaluationError(updateError.message, 500);
    if (!updated) {
      return NextResponse.json({ error: "Another move was submitted at the same time. Try again." }, { status: 409 });
    }

    return NextResponse.json({
      accepted,
      relatedness: evaluation.relatedness,
      proximity,
      run: toRunState(updated),
    });
  } catch (error: any) {
    const status = error instanceof EvaluationError ? error.status : 500;
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status });
  }
}
