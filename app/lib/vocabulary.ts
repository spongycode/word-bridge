import fs from "fs";
import path from "path";

let cachedChallengeWords: string[] | null = null;

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

// Deterministic Pseudo-Random Number Generator (PRNG) seeded by YYYY-MM-DD
function getSeededRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

// Returns a single synchronized daily pair for all players globally on any given date
export function getDailyChallengePair(): { source: string; target: string; dateString: string } {
  const words = getEnglishVocabulary();
  const today = new Date();
  const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  
  // Hash the date string into a deterministic integer seed
  let seed = 0;
  for (let i = 0; i < dateString.length; i++) {
    seed = (seed << 5) - seed + dateString.charCodeAt(i);
    seed |= 0;
  }

  const idx1 = Math.floor(Math.abs(getSeededRandom(seed * 31)) * words.length);
  let idx2 = Math.floor(Math.abs(getSeededRandom(seed * 97)) * words.length);
  if (idx2 === idx1) idx2 = (idx1 + 100) % words.length;

  return {
    source: words[idx1],
    target: words[idx2],
    dateString,
  };
}
