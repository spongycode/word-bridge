import { NextResponse } from "next/server";
import { evaluateStep, validateCandidate, EvaluationError } from "@/app/lib/typesafe";
import { enforceRateLimit, getClientIp } from "@/app/lib/rateLimit";
import { getSessionUserId } from "@/app/lib/supabase/session";

export async function POST(req: Request) {
  try {
    const userId = await getSessionUserId();
    const limited = await enforceRateLimit(userId ? `user:${userId}` : `ip:${getClientIp(req)}`);
    if (limited) return limited;

    const { word1, word2, targetWord } = await req.json();
    const previous = validateCandidate(word1);
    const candidate = validateCandidate(word2);
    const target = typeof targetWord === "string" && targetWord.trim() ? targetWord.trim().toLowerCase() : undefined;

    const evaluation = await evaluateStep(previous, candidate, target);
    if (!evaluation.isRealWord) {
      return NextResponse.json({ error: `"${candidate}" is not a recognized word.` }, { status: 400 });
    }

    return NextResponse.json({
      relatedness: evaluation.relatedness,
      similarityScore: evaluation.similarityScore,
      proximity: evaluation.proximity ?? 0,
    });
  } catch (error: any) {
    const status = error instanceof EvaluationError ? error.status : 500;
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status });
  }
}
