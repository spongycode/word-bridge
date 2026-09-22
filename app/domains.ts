export interface WordPair {
  source: string;
  target: string;
  categoryHint: string;
  difficulty: "Hard" | "Expert";
  baselineScore?: number;
}
