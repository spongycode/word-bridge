import { NextResponse } from "next/server";
import { evaluateStep, validateCandidate, EvaluationError } from "@/app/lib/typesafe";
import { enforceRateLimit, getClientIp } from "@/app/lib/rateLimit";
import { getSessionUserId } from "@/app/lib/supabase/session";
import { createTimer } from "@/app/lib/timing";

export async function POST(req: Request) {
  const timer = createTimer();
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Server-Timing": timer.header() } });

  try {
    const { word1, word2, targetWord } = await req.json();
    const previous = validateCandidate(word1);
    const candidate = validateCandidate(word2);
    const target = typeof targetWord === "string" && targetWord.trim() ? targetWord.trim().toLowerCase() : undefined;

    const userId = await timer.time("auth", getSessionUserId());

    // Rate limit and evaluation run in parallel to save a round trip; an over-limit request
    // still gets rejected, at the cost of the one evaluation that ran alongside the check.
    const [limitResult, evalResult] = await Promise.allSettled([
      timer.time("ratelimit", enforceRateLimit(userId ? `user:${userId}` : `ip:${getClientIp(req)}`)),
      timer.time("eval", evaluateStep(previous, candidate, target)),
    ]);

    if (limitResult.status === "fulfilled" && limitResult.value) {
      const limited = limitResult.value;
      limited.headers.set("Server-Timing", timer.header());
      return limited;
    }
    if (evalResult.status === "rejected") throw evalResult.reason;

    const evaluation = evalResult.value;
    if (!evaluation.isRealWord) {
      return respond({ error: `"${candidate}" is not a recognized word.` }, 400);
    }

    return respond({
      relatedness: evaluation.relatedness,
      similarityScore: evaluation.similarityScore,
      proximity: evaluation.proximity ?? 0,
    });
  } catch (error: any) {
    const status = error instanceof EvaluationError ? error.status : 500;
    return respond({ error: error?.message || "Internal server error" }, status);
  }
}
