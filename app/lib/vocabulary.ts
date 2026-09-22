import fs from "fs";
import path from "path";

let cachedChallengeWords: string[] | null = null;
let validDictionarySet: Set<string> | null = null;

const STOPWORDS = new Set([
  "that", "with", "have", "this", "from", "they", "will", "would", "there", 
  "their", "what", "about", "which", "when", "make", "time", "just", "know", 
  "take", "people", "into", "year", "your", "good", "some", "could", "them", 
  "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", 
  "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", 
  "well", "way", "even", "new", "want", "because", "any", "these", "give", "day", 
  "most", "us"
]);

// 1. Challenge Words: Clean common words for starting & target pairs
export function getEnglishVocabulary(): string[] {
  if (cachedChallengeWords) {
    return cachedChallengeWords;
  }

  try {
    const filePath = path.join(process.cwd(), "public", "common-english-words.txt");
    const content = fs.readFileSync(filePath, "utf-8");
    cachedChallengeWords = content
      .split("\n")
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-z]{3,12}$/.test(w) && !STOPWORDS.has(w));
    return cachedChallengeWords;
  } catch (err) {
    console.error("Error reading vocabulary file:", err);
    return ["coffee", "sleep", "mountain", "airplane", "ocean", "desert", "telescope", "fossil"];
  }
}

export function getRandomVocabularyWord(): string {
  const words = getEnglishVocabulary();
  return words[Math.floor(Math.random() * words.length)];
}

// 2. Comprehensive Validator: 370k English words + modern terms to block glued compound hacks
export function isValidDictionaryWord(word: string): boolean {
  if (!validDictionarySet) {
    try {
      const dictPath = path.join(process.cwd(), "public", "dictionary.txt");
      const content = fs.readFileSync(dictPath, "utf-8");
      const words = content
        .split("\n")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);

      validDictionarySet = new Set(words);

      // Also ensure common words & modern terms are included
      const common = getEnglishVocabulary();
      for (const w of common) {
        validDictionarySet.add(w);
      }
      validDictionarySet.add("wifi");
    } catch (err) {
      console.error("Error loading comprehensive dictionary:", err);
      return true; // Fallback if file read fails
    }
  }

  return validDictionarySet.has(word.toLowerCase().trim());
}
