import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { word1, word2 } = await req.json();

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

    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          word_a: word1.toLowerCase().trim(),
          word_b: rawInput,
        },
        questions: {
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
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `TypeSafe API Error (${response.status}): ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
