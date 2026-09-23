import { NextResponse } from "next/server";
import { getRandomVocabularyWord, getDailyChallengePair } from "@/app/lib/vocabulary";
import { WordPair } from "@/app/domains";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isDaily = searchParams.get("daily") === "true";
  const apiKey = process.env.TYPESAFE_API_KEY;

  // 1. Daily Puzzle Request (same for all users globally)
  if (isDaily) {
    const daily = getDailyChallengePair();
    let baselineScore = 15;

    if (apiKey) {
      try {
        const evalRes = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "jev-latest",
            state: { word_a: daily.source, word_b: daily.target },
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
          baselineScore = Math.round((evalData?.answers?.are_related?.noul ?? 0.15) * 100);
        }
      } catch (err) {
        console.error("Daily eval error:", err);
      }
    }

    const pair: WordPair = {
      source: daily.source,
      target: daily.target,
      categoryHint: `Daily Bridge #${daily.dateString}`,
      difficulty: baselineScore < 15 ? "Expert" : "Hard",
      baselineScore,
    };
    return NextResponse.json(pair);
  }

  // 2. Random Puzzle Request
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
