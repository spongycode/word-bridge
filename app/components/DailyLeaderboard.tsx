"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry, LeaderboardResponse } from "../lib/dailyRun";

interface DailyLeaderboardProps {
  compact?: boolean; // game-over card shows top 5; full view shows everything
  refreshKey?: unknown;
}

function Row({ entry, showPath }: { entry: LeaderboardEntry; showPath: boolean }) {
  return (
    <div
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono ${
        entry.isMe ? "bg-zinc-800/80 border-zinc-600" : "bg-zinc-950 border-zinc-800/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-zinc-500 w-6 shrink-0">#{entry.rank}</span>
          <span className={`truncate ${entry.isMe ? "text-white font-semibold" : "text-zinc-200"}`}>
            {entry.username}
            {entry.isMe ? " (you)" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-zinc-400">
          <span>{entry.steps} steps</span>
          <span className="text-white font-semibold">{entry.score.toLocaleString()}</span>
        </div>
      </div>
      {showPath && entry.path && (
        <div className="text-[10px] text-zinc-500 mt-1 break-words whitespace-normal">{entry.path.join(" → ")}</div>
      )}
    </div>
  );
}

export default function DailyLeaderboard({ compact = false, refreshKey }: DailyLeaderboardProps) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/daily/leaderboard")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load leaderboard");
        if (!cancelled) setData(body);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) return <p className="text-xs font-mono text-rose-400">{error}</p>;
  if (!data) {
    return (
      <div className="py-4 flex justify-center">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
      </div>
    );
  }

  const entries = compact ? data.entries.slice(0, 5) : data.entries;
  const meOutsideList = data.me && !entries.some((e) => e.isMe);

  return (
    <div className="space-y-1.5 text-left">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-400">
        <span>Daily Leaderboard • {data.day} UTC</span>
        <span>{data.totalFinished} finished</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs font-mono text-zinc-500 py-2">No one has finished today yet. Be the first!</p>
      ) : (
        <div className={`space-y-1 ${compact ? "" : "max-h-[60vh] overflow-y-auto pr-1"}`}>
          {entries.map((e) => (
            <Row key={`${e.rank}-${e.username}`} entry={e} showPath={!compact && data.pathsVisible} />
          ))}
          {meOutsideList && data.me && <Row entry={data.me} showPath={!compact && data.pathsVisible} />}
        </div>
      )}
      {!compact && !data.pathsVisible && data.entries.length > 0 && (
        <p className="text-[10px] font-mono text-zinc-600">Paths are revealed after you finish today&apos;s challenge.</p>
      )}
    </div>
  );
}
