import "server-only";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const STEP_THRESHOLD = 70;

export class EvaluationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface StepEvaluation {
  isRealWord: boolean;
  relatedness: number; // 0-100, candidate vs previous word
  similarityScore: number;
  proximity: number | null; // 0-100, candidate vs target (null when no target given)
}

async function callTypesafe(state: Record<string, string>, questions: Record<string, unknown>) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new EvaluationError("TYPESAFE_API_KEY is not configured on the server.", 500);

  const response = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new EvaluationError(`Evaluation Error (${response.status}): ${errorText}`, response.status);
  }
  return response.json();
}

const RELATED_QUESTION = {
  type: "noul",
  instructions: "Are `word_a` and `word_b` semantically or conceptually related to each other?",
};

// Parallel multi-question evaluation in a single request
export async function evaluateStep(previous: string, candidate: string, target?: string): Promise<StepEvaluation> {
  const questions: Record<string, unknown> = {
    is_real_word: {
      type: "noul",
      instructions: "Is `word_b` a standalone, standard recognized dictionary word or common term in English (as opposed to two words mashed together, an invented neologism, or compound cheat)?",
    },
    are_related: RELATED_QUESTION,
    similarity_score: {
      type: "score",
      instructions: "How strongly related are `word_a` and `word_b`?",
      criteria: [
        "Unrelated: No conceptual connection",
        "Weakly related: Distant, tangential, or coincidental connection",
        "Moderately related: Same domain, category, or context",
        "Strongly related: Direct association, component, synonym, or functional pair",
      ],
    },
  };

  const state: Record<string, string> = { word_a: previous, word_b: candidate };
  if (target) {
    state.target = target;
    questions.proximity_to_target = {
      type: "noul",
      instructions: "Are `word_b` and `target` semantically or conceptually related to each other?",
    };
  }

  const data = await callTypesafe(state, questions);
  const answers = data?.answers ?? {};

  return {
    isRealWord: (answers.is_real_word?.noul ?? 1.0) >= 0.5,
    relatedness: Math.round((answers.are_related?.noul ?? 0) * 100),
    similarityScore: answers.similarity_score?.score ?? 0,
    proximity: target ? Math.round((answers.proximity_to_target?.noul ?? 0) * 100) : null,
  };
}

// Returns 0-100 relatedness between two words
export async function evaluateRelatedness(wordA: string, wordB: string): Promise<number> {
  const data = await callTypesafe({ word_a: wordA, word_b: wordB }, { are_related: RELATED_QUESTION });
  return Math.round((data?.answers?.are_related?.noul ?? 0) * 100);
}

// Shared word validation for every step endpoint
export function validateCandidate(word: unknown): string {
  if (typeof word !== "string") throw new EvaluationError("Word is required.", 400);
  const clean = word.trim().toLowerCase();
  if (clean.length < 2) throw new EvaluationError("Word must be at least 2 letters long.", 400);
  if (clean.length > 24) throw new EvaluationError("Word is too long.", 400);
  if (!/^[a-z]+$/.test(clean)) throw new EvaluationError("Only alphabetic characters (A-Z, a-z) are allowed.", 400);
  return clean;
}
