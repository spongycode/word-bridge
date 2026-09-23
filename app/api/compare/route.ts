import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { word1, word2, targetWord } = await req.json();

    const alphabetRegex = /^[a-zA-Z]+$/;

    if (!word1 || !word2 || word2.trim().length < 2) {
      return NextResponse.json(
        { error: "Word must be at least 2 letters long." },
        { status: 400 }
      );
    }

    if (!alphabetRegex.test(word1) || !alphabetRegex.test(word2)) {
      return NextResponse.json(
        { error: "Only alphabetic characters (A-Z, a-z) are allowed." },
        { status: 400 }
      );
    }

    const rawInput = word2.trim().toLowerCase();

    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "TYPESAFE_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    // Parallel multi-question evaluation:
    // 1. is_real_word: checks validity (blocks mashed compounds)
    // 2. are_related: checks relatedness to previous step
    // 3. similarity_score: rated degree
    // 4. proximity_to_target: measures target compass distance in the SAME request
    const questions: Record<string, any> = {
      is_real_word: {
        type: "noul",
        instructions: "Is `word_b` a standalone, standard recognized dictionary word or common term in English (as opposed to two words mashed together, an invented neologism, or compound cheat)?",
      },
      are_related: {
        type: "noul",
        instructions: "Are `word_a` and `word_b` semantically or conceptually related to each other?",
      },
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

    const statePayload: Record<string, string> = {
      word_a: word1.toLowerCase().trim(),
      word_b: rawInput,
    };

    if (targetWord && typeof targetWord === "string") {
      statePayload.target = targetWord.toLowerCase().trim();
      questions.proximity_to_target = {
        type: "noul",
        instructions: "Are `word_b` and `target` semantically or conceptually related to each other?",
      };
    }

    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: statePayload,
        questions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Evaluation Error (${response.status}): ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Check standalone English word validity
    const isRealWordProb = data?.answers?.is_real_word?.noul ?? 1.0;
    if (isRealWordProb < 0.50) {
      return NextResponse.json(
        { error: `"${rawInput}" is not recognized as a valid standalone English word.` },
        { status: 400 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
