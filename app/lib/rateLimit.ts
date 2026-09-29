import "server-only";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";

interface Limit {
  name: string;
  limit: number;
  windowSeconds: number;
}

// Every step costs a paid evaluation call; cap per player (or per IP for guests)
export const EVALUATION_LIMITS: Limit[] = [
  { name: "eval-min", limit: 20, windowSeconds: 60 },
  { name: "eval-day", limit: 500, windowSeconds: 86400 },
];

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Returns a 429 response when any limit is exceeded, otherwise null.
// Fails open (allows the request) if the limiter itself is unavailable so the game keeps working.
export async function enforceRateLimit(identity: string, limits: Limit[] = EVALUATION_LIMITS): Promise<NextResponse | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  try {
    const results = await Promise.all(
      limits.map((l) =>
        admin.rpc("rate_limit_hit", {
          p_key: `${l.name}:${identity}`,
          p_limit: l.limit,
          p_window_seconds: l.windowSeconds,
        })
      )
    );

    for (let i = 0; i < results.length; i++) {
      const { data, error } = results[i];
      if (error) {
        console.error("Rate limiter error:", error.message);
        return null;
      }
      if (data === false) {
        const l = limits[i];
        return NextResponse.json(
          { error: l.windowSeconds <= 60 ? "Too many attempts. Wait a minute and try again." : "Daily attempt limit reached. Come back tomorrow." },
          { status: 429, headers: { "Retry-After": String(l.windowSeconds) } }
        );
      }
    }
  } catch (err) {
    console.error("Rate limiter unavailable:", err);
  }
  return null;
}
