// Link strength tiers shared by the path, opponent chips, and share squares (every accepted link is >= 70%)
export type LinkTier = "strong" | "good" | "ok";

export function linkTier(pct: number): LinkTier {
  return pct >= 90 ? "strong" : pct >= 80 ? "good" : "ok";
}

export const TIER_STYLES: Record<LinkTier, { text: string; line: string; dot: string; chip: string; square: string }> = {
  strong: { text: "text-emerald-400", line: "bg-emerald-500/70", dot: "bg-emerald-400", chip: "border-emerald-800/70 text-emerald-300", square: "🟩" },
  good: { text: "text-amber-300", line: "bg-amber-400/70", dot: "bg-amber-300", chip: "border-amber-800/70 text-amber-200", square: "🟨" },
  ok: { text: "text-orange-400", line: "bg-orange-500/70", dot: "bg-orange-400", chip: "border-orange-800/70 text-orange-300", square: "🟧" },
};
