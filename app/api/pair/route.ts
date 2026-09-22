import { NextResponse } from "next/server";
import { getRandomVocabularyWord } from "@/app/lib/vocabulary";
import { WordPair } from "@/app/domains";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      source: "coffee",
      target: "submarine",
      categoryHint: "Vocabulary Challenge",
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
