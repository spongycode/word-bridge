import { NextResponse } from "next/server";
import { getDailyPuzzle } from "@/app/lib/daily";
import { generateRandomPair } from "@/app/lib/pairs";
import { WordPair } from "@/app/domains";
import { enforceRateLimit, getClientIp, PAIR_LIMITS } from "@/app/lib/rateLimit";
import { getSessionUserId } from "@/app/lib/supabase/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 1. Daily Puzzle Request (same for all users globally)
  if (searchParams.get("daily") === "true") {
    const { day: _day, ...pair } = await getDailyPuzzle();
    return NextResponse.json(pair satisfies WordPair);
  }

  // 2. Random Puzzle Request
  const userId = await getSessionUserId();
  const limited = await enforceRateLimit(userId ? `user:${userId}` : `ip:${getClientIp(request)}`, PAIR_LIMITS);
  if (limited) return limited;

  return NextResponse.json(await generateRandomPair());
}
