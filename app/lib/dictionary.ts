export interface WordDefinitionResult {
  word: string;
  partOfSpeech?: string;
  definition: string;
}

const posMap: Record<string, string> = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
};

export async function fetchWordDefinition(word: string): Promise<WordDefinitionResult | null> {
  const clean = word.trim().toLowerCase();
  if (!clean) return null;

  try {
    const res = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(clean)}&md=d&max=1`);
    if (!res.ok) return null;
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0 || !data[0].defs || data[0].defs.length === 0) {
      return null;
    }

    const rawDef: string = data[0].defs[0];
    const tabIndex = rawDef.indexOf("\t");
    if (tabIndex === -1) {
      return {
        word: clean,
        definition: rawDef.trim(),
      };
    }

    const posCode = rawDef.substring(0, tabIndex).trim();
    const definition = rawDef.substring(tabIndex + 1).trim();

    return {
      word: clean,
      partOfSpeech: posMap[posCode] || posCode,
      definition,
    };
  } catch (err) {
    console.error("Definition lookup failed:", err);
    return null;
  }
}
