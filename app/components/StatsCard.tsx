"use client";

import { useEffect, useState } from "react";
import type { PlayerStats } from "../lib/dailyRun";

// Streak + totals for signed-in players
export default function StatsCard({ refreshKey }: { refreshKey?: unknown }) {
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setStats(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!stats) return null;

  const items = [
    { label: "Streak", value: `${stats.currentStreak}${stats.currentStreak > 0 ? " 🔥" : ""}` },
    { label: "Best streak", value: stats.maxStreak },
    { label: "Dailies solved", value: stats.dailySolved },
    { label: "Avg. steps", value: stats.averageSteps ?? "–" },
  ];

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map((it) => (
        <div key={it.label} className="bg-zinc-950 border border-zinc-800 rounded-xl py-2 text-center">
          <div className="text-base font-semibold text-white">{it.value}</div>
          <div className="text-xs text-zinc-400">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
