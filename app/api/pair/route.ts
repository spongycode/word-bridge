import { NextResponse } from "next/server";
import { getRandomVocabularyWord } from "@/app/lib/vocabulary";
import { getDailyPuzzle } from "@/app/lib/daily";
import { WordPair } from "@/app/domains";
import { enforceRateLimit, getClientIp } from "@/app/lib/rateLimit";
import { getSessionUserId } from "@/app/lib/supabase/session";

// Random pairs cost up to 5 evaluation calls each
const PAIR_LIMITS = [
  { name: "pair-min", limit: 10, windowSeconds: 60 },
  { name: "pair-day", limit: 150, windowSeconds: 86400 },
];

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isDaily = searchParams.get("daily") === "true";
  const apiKey = process.env.TYPESAFE_API_KEY;

  // 1. Daily Puzzle Request (same for all users globally)
  if (isDaily) {
    const { day: _day, ...pair } = await getDailyPuzzle();
    return NextResponse.json(pair satisfies WordPair);
  }

  // 2. Random Puzzle Request
  const userId = await getSessionUserId();
  const limited = await enforceRateLimit(userId ? `user:${userId}` : `ip:${getClientIp(request)}`, PAIR_LIMITS);
  if (limited) return limited;

  if (!apiKey) {
    return NextResponse.json({
      source: "coffee",
      target: "submarine",
      categoryHint: "Semantic Distance Challenge",
      difficulty: "Hard",
      baselineScore: 18,
    });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wordA = getRandomVocabularyWord();
    const wordB = getRandomVocabularyWord();

    if (!wordA || !wordB || wordA === wordB) continue;

    try {
      const evalRes = await fetch("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "jev-latest",
          state: {
            word_a: wordA,
            word_b: wordB,
          },
          questions: {
            are_related: {
              type: "noul",
              instructions: "Are `word_a` and `word_b` semantically or conceptually related to each other?",
            },
          },
        }),
      });

      if (evalRes.ok) {
        const evalData = await evalRes.json();
        const noul = evalData?.answers?.are_related?.noul ?? 0.5;
        const baselineScore = Math.round(noul * 100);

        if (baselineScore < 30) {
          const pair: WordPair = {
            source: wordA,
            target: wordB,
            categoryHint: "Semantic Distance Challenge",
            difficulty: baselineScore < 15 ? "Expert" : "Hard",
            baselineScore,
          };
          return NextResponse.json(pair);
        }
      }
    } catch (err) {
      console.error("Pair generation attempt error:", err);
    }
  }

  return NextResponse.json({
    source: "guitar",
    target: "satellite",
    categoryHint: "Semantic Distance Challenge",
    difficulty: "Expert",
    baselineScore: 12,
  });
}
