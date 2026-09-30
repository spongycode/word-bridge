import { NextResponse } from "next/server";
import { getSessionUserId } from "@/app/lib/supabase/session";
import { enforceRateLimit } from "@/app/lib/rateLimit";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { getDailyPuzzle } from "@/app/lib/daily";
import { evaluateStep, validateCandidate, EvaluationError, STEP_THRESHOLD } from "@/app/lib/typesafe";
import { calculateGameScore } from "@/app/lib/scoring";
import type { DailyRunState } from "@/app/lib/dailyRun";
import { getUtcDayString } from "@/app/lib/vocabulary";
import { createTimer } from "@/app/lib/timing";

export const dynamic = "force-dynamic";

function toRunState(row: any): DailyRunState {
  return {
    path: row.path,
    stepScores: row.step_scores,
    failedAttempts: row.failed_attempts,
    lastProximity: row.last_proximity,
    finished: row.finished,
    gaveUp: row.gave_up ?? false,
  };
}

// Best finished path today, shown to a player who gives up
async function bestPathToday(admin: any, day: string): Promise<string[] | null> {
  const { data } = await admin
    .from("daily_runs")
    .select("path")
    .eq("day", day)
    .eq("finished", true)
    .eq("gave_up", false)
    .order("score", { ascending: false })
    .limit(1);
  return data?.[0]?.path ?? null;
}

// GET: today's puzzle plus the signed-in player's ranked run (if any)
export async function GET() {
  const timer = createTimer();
  const userId = await timer.time("auth", getSessionUserId());
  const admin = getSupabaseAdmin();

  // Puzzle (usually cached in memory) and the player's run are fetched in parallel
  const [puzzle, runRow] = await timer.time(
    "db",
    Promise.all([
      getDailyPuzzle(),
      userId && admin
        ? admin.from("daily_runs").select("*").eq("user_id", userId).eq("day", getUtcDayString()).maybeSingle().then((r) => r.data)
        : Promise.resolve(null),
    ])
  );

  const run: DailyRunState | null = runRow ? toRunState(runRow) : null;
  return NextResponse.json({ puzzle, run, ranked: Boolean(userId && admin) }, { headers: { "Server-Timing": timer.header() } });
}

// POST { word }: server-authoritative step for the ranked daily run
export async function POST(req: Request) {
  const timer = createTimer();
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Server-Timing": timer.header() } });

  try {
    const userId = await timer.time("auth", getSessionUserId());
    if (!userId) return respond({ error: "Sign in to play the ranked daily." }, 401);

    const admin = getSupabaseAdmin();
    if (!admin) return respond({ error: "Leaderboard is not configured on the server." }, 500);

    const body = await req.json();
    const day = getUtcDayString();

    // One parallel round: rate limit, today's puzzle (usually cached), and the player's run
    const [limited, puzzle, existingRun] = await timer.time(
      "db",
      Promise.all([
        enforceRateLimit(`user:${userId}`),
        getDailyPuzzle(),
        admin.from("daily_runs").select("*").eq("user_id", userId).eq("day", day).maybeSingle(),
      ])
    );
    if (limited) {
      limited.headers.set("Server-Timing", timer.header());
      return limited;
    }

    // Give up: ends today's ranked run without a score (breaks the streak)
    if (body.action === "give_up") {
      const { data: gaveUp, error } = await admin
        .from("daily_runs")
        .upsert(
          {
            user_id: userId,
            day: puzzle.day,
            path: [puzzle.source],
            finished: true,
            gave_up: true,
            finished_at: new Date().toISOString(),
          },
          { onConflict: "user_id,day", ignoreDuplicates: true }
        )
        .select("*");
      if (error) throw new EvaluationError(error.message, 500);

      // Existing unfinished run: mark it given up (finished runs are left untouched)
      if (!gaveUp || gaveUp.length === 0) {
        await admin
          .from("daily_runs")
          .update({ finished: true, gave_up: true, finished_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("day", puzzle.day)
          .eq("finished", false);
      }
      const { data: row } = await admin.from("daily_runs").select("*").eq("user_id", userId).eq("day", puzzle.day).single();
      return respond({ run: toRunState(row), bestPath: await bestPathToday(admin, puzzle.day) });
    }

    const candidate = validateCandidate(body.word);

    // Use the prefetched run, or create today's run (one attempt per player per day)
    let row = existingRun.data;
    if (!row) {
      const { data: created, error: insertError } = await timer.time(
        "db-create",
        admin
          .from("daily_runs")
          .upsert(
            { user_id: userId, day: puzzle.day, path: [puzzle.source], last_proximity: puzzle.baselineScore ?? 0 },
            { onConflict: "user_id,day", ignoreDuplicates: true }
          )
          .select("*")
      );
      if (insertError) throw new EvaluationError(`Could not start daily run: ${insertError.message}`, 500);
      row = created?.[0];
      // A concurrent request created it first
      if (!row) ({ data: row } = await admin.from("daily_runs").select("*").eq("user_id", userId).eq("day", puzzle.day).single());
    }

    if (row.finished) {
      return respond({ error: "You already completed today's challenge." }, 409);
    }
    if (row.path.includes(candidate)) {
      return respond({ error: `"${candidate}" is already in your path.` }, 400);
    }

    const previous: string = row.path[row.path.length - 1];
    const evaluation = await timer.time("eval", evaluateStep(previous, candidate, puzzle.target));
    if (!evaluation.isRealWord) {
      return respond({ error: `"${candidate}" is not a recognized word.` }, 400);
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
    const { data: updated, error: updateError } = await timer.time("db-save", admin
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
      .maybeSingle());

    if (updateError) throw new EvaluationError(updateError.message, 500);
    if (!updated) {
      return respond({ error: "Another move was submitted at the same time. Try again." }, 409);
    }

    return respond({
      accepted,
      relatedness: evaluation.relatedness,
      proximity,
      run: toRunState(updated),
    });
  } catch (error: any) {
    const status = error instanceof EvaluationError ? error.status : 500;
    return respond({ error: error?.message || "Internal server error" }, status);
  }
}
