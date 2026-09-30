import type { ScoreBreakdown } from "./scoring";
import type { StepRecord } from "./player";
import { linkTier, TIER_STYLES } from "./links";

// Day 1 of the daily puzzle; used for "WordBridge #N" numbering
const DAILY_EPOCH = Date.UTC(2026, 8, 29);

export function dailyNumber(day: string): number {
  return Math.floor((Date.parse(`${day}T00:00:00Z`) - DAILY_EPOCH) / 86400000) + 1;
}

// One square per link, colored by strength
export function linkSquares(steps: StepRecord[]): string {
  return steps
    .slice(1)
    .map((s) => TIER_STYLES[linkTier(s.relatednessToPrevious)].square)
    .join("");
}

// Daily shares are spoiler-free (no words); solo and 1v1 shares include the path
export function buildShareText(params: {
  mode: "daily" | "solo" | "peer";
  day?: string;
  source: string;
  target: string;
  steps: StepRecord[];
  score: ScoreBreakdown;
  misses: number;
  opponentPath?: string[];
}): string {
  const { mode, day, source, target, steps, score, misses, opponentPath } = params;
  const stepCount = steps.length - 1;
  const summary = `${stepCount} ${stepCount === 1 ? "step" : "steps"} · ${misses} ${misses === 1 ? "miss" : "misses"} · ${score.totalScore.toLocaleString()} pts`;

  if (mode === "daily") {
    return [`WordBridge #${day ? dailyNumber(day) : ""}`, linkSquares(steps), summary].join("\n");
  }

  return [
    `WordBridge · ${source} → ${target}`,
    `${linkSquares(steps)} ${summary}`,
    steps.map((s) => s.word).join(" → "),
    opponentPath ? `Opponent: ${opponentPath.join(" → ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
