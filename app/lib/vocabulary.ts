import fs from "fs";
import path from "path";

let cachedWords: string[] | null = null;

// Stopwords/grammar particles that don't make good challenge words
const STOPWORDS = new Set([
  "that", "with", "have", "this", "from", "they", "will", "would", "there", 
  "their", "what", "about", "which", "when", "make", "time", "just", "know", 
  "take", "people", "into", "year", "your", "good", "some", "could", "them", 
  "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", 
  "think", "also", "back", "after", "use", "two", "how", "our", "work", "first", 
  "well", "way", "even", "new", "want", "because", "any", "these", "give", "day", 
  "most", "us"
]);

export function getEnglishVocabulary(): string[] {
  if (cachedWords) {
    return cachedWords;
  }

  try {
    const filePath = path.join(process.cwd(), "public", "common-english-words.txt");
    const content = fs.readFileSync(filePath, "utf-8");
    cachedWords = content
      .split("\n")
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-z]{3,12}$/.test(w) && !STOPWORDS.has(w));
    return cachedWords;
  } catch (err) {
    console.error("Error reading vocabulary file:", err);
    return ["coffee", "sleep", "mountain", "airplane", "ocean", "desert", "telescope", "fossil"];
  }
}

export function getRandomVocabularyWord(): string {
  const words = getEnglishVocabulary();
  return words[Math.floor(Math.random() * words.length)];
}
