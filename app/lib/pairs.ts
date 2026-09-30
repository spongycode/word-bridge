import "server-only";
import { WordPair } from "@/app/domains";
import { getRandomVocabularyWord } from "@/app/lib/vocabulary";
import { evaluateRelatedness } from "@/app/lib/typesafe";

const MAX_BASELINE = 30; // pairs more related than this are too easy
const MAX_DRAWS = 5;

const FALLBACK_PAIR: WordPair = {
  source: "guitar",
  target: "satellite",
  categoryHint: "Random puzzle",
  difficulty: "Expert",
  baselineScore: 12,
};

// Draws random vocabulary pairs until one is distant enough to be a real challenge
export async function generateRandomPair(): Promise<WordPair> {
  if (!process.env.TYPESAFE_API_KEY) return FALLBACK_PAIR;

  for (let attempt = 0; attempt < MAX_DRAWS; attempt++) {
    const source = getRandomVocabularyWord();
    const target = getRandomVocabularyWord();
    if (!source || !target || source === target) continue;

    try {
      const baselineScore = await evaluateRelatedness(source, target);
      if (baselineScore < MAX_BASELINE) {
        return {
          source,
          target,
          categoryHint: "Random puzzle",
          difficulty: baselineScore < 15 ? "Expert" : "Hard",
          baselineScore,
        };
      }
    } catch (err) {
      console.error("Pair generation attempt error:", err);
    }
  }

  return FALLBACK_PAIR;
}
