"use client";

import { useEffect, useState } from "react";

function msUntilUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

function format(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// "New puzzle in 5h 12m" — the daily resets at 00:00 UTC
export default function Countdown({ prefix = "New puzzle in" }: { prefix?: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    setRemaining(msUntilUtcMidnight());
    const id = setInterval(() => setRemaining(msUntilUtcMidnight()), 30000);
    return () => clearInterval(id);
  }, []);

  if (remaining === null) return null;
  return (
    <span>
      {prefix} {format(remaining)}
    </span>
  );
}
