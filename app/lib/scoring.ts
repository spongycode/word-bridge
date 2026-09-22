export interface ScoreBreakdown {
  totalScore: number;
  rank: "S+" | "A" | "B" | "C" | "D";
  title: string;
  difficultyBonus: number;
  stepEfficiency: number;
  linkQuality: number;
  missPenalty: number;
  averageSimilarity: number;
  badges: string[];
}

export function calculateGameScore(params: {
  baselineScore: number; // e.g. 10 (%)
  stepCount: number;     // e.g. 4
  stepSimilarities: number[]; // e.g. [85, 92, 78, 88]
  failedAttempts: number; // e.g. 1
}): ScoreBreakdown {
  const { baselineScore, stepCount, stepSimilarities, failedAttempts } = params;

  // 1. Difficulty bonus: Wider conceptual gulfs award more base points (up to 2,500)
  // Lower baseline similarity = harder puzzle = higher bonus
  const clampedBaseline = Math.max(0, Math.min(100, baselineScore));
  const difficultyBonus = Math.round(1500 + (100 - clampedBaseline) * 10);

  // 2. Step Efficiency: Par is 4 steps (max 4,000 pts, -500 per step over par, min 1,000)
  const par = 4;
  const overPar = Math.max(0, stepCount - par);
  const stepEfficiency = Math.max(1000, 4000 - overPar * 500);

  // 3. Link Quality: Average link cohesion percentage * 35 (max 3,500 pts)
  const avgSimilarity =
    stepSimilarities.length > 0
      ? stepSimilarities.reduce((a, b) => a + b, 0) / stepSimilarities.length
      : 70;
  const linkQuality = Math.round(avgSimilarity * 35);

  // 4. Missed Attempt Penalty: -150 pts per blunder (< 70%)
  const missPenalty = failedAttempts * 150;

  // Final Total Score (clamped between 500 and 10,000)
  const totalScore = Math.max(
    500,
    Math.min(10000, difficultyBonus + stepEfficiency + linkQuality - missPenalty)
  );

  // Rank and Title
  let rank: ScoreBreakdown["rank"] = "C";
  let title = "Wanderer";

  if (totalScore >= 9000) {
    rank = "S+";
    title = "Semantic Mastermind";
  } else if (totalScore >= 7500) {
    rank = "A";
    title = "Lexical Cartographer";
  } else if (totalScore >= 6000) {
    rank = "B";
    title = "Pathfinder";
  } else if (totalScore >= 4000) {
    rank = "C";
    title = "Wanderer";
  } else {
    rank = "D";
    title = "Explorer";
  }

  // Badges
  const badges: string[] = [];
  if (failedAttempts === 0) {
    badges.push("Flawless Navigation (0 misses)");
  }
  if (stepCount <= 4) {
    badges.push("Lightning Leap (<= 4 steps)");
  }
  if (avgSimilarity >= 85) {
    badges.push("Bulls-eye (>= 85% avg cohesion)");
  }
  if (clampedBaseline <= 12) {
    badges.push("Deep Space Bridge (<= 12% baseline)");
  }

  return {
    totalScore,
    rank,
    title,
    difficultyBonus,
    stepEfficiency,
    linkQuality,
    missPenalty,
    averageSimilarity: Math.round(avgSimilarity),
    badges,
  };
}
