import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import Ably from "ably";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveIdentity, clientIdBelongsTo } from "@/app/lib/identity";
import { enforceRateLimit, PAIR_LIMITS } from "@/app/lib/rateLimit";
import { generateRandomPair } from "@/app/lib/pairs";
import { USERNAME_PATTERN } from "@/app/lib/player";
import type { MatchFound } from "@/app/lib/dailyRun";

export const dynamic = "force-dynamic";

const QUEUE_LIMITS = [{ name: "queue-min", limit: 40, windowSeconds: 60 }];
// Waiting clients re-check every 5s; entries older than this belong to closed tabs
const QUEUE_TTL_SECONDS = 15;

function randomRoomCode(): string {
  // 6 chars so random-match rooms never collide with 4-char friend room codes
  return randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

// Signed-in players always appear under their verified profile username
async function displayName(identity: string, requested: unknown): Promise<string> {
  const admin = getSupabaseAdmin();
  if (identity.startsWith("u-") && admin) {
    const { data } = await admin.from("profiles").select("username").eq("id", identity.slice(2)).maybeSingle();
    if (data?.username) return data.username;
  }
  return typeof requested === "string" && USERNAME_PATTERN.test(requested) ? requested : "Guest";
}

async function verifyCaller(request: NextRequest, clientId: unknown) {
  const { identity, newGuestCookie } = await resolveIdentity(request);
  // A freshly minted guest cookie means the caller never obtained a realtime token as this identity
  if (newGuestCookie || !clientIdBelongsTo(clientId, identity)) return null;
  return identity;
}

// POST { clientId, name, heartbeat? }: join the queue (or re-check while waiting)
export async function POST(request: NextRequest) {
  const admin = getSupabaseAdmin();
  const ablyKey = process.env.ABLY_API_KEY;
  if (!admin || !ablyKey) return NextResponse.json({ error: "Matchmaking is not configured on the server." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const identity = await verifyCaller(request, body.clientId);
  if (!identity) return NextResponse.json({ error: "Realtime identity mismatch. Reload the page and try again." }, { status: 403 });

  // sendBeacon on tab close can only POST, so leaving is also accepted here
  if (body.action === "leave") {
    await admin.from("match_queue").delete().eq("identity", identity);
    return NextResponse.json({ ok: true });
  }

  const limited = await enforceRateLimit(identity, QUEUE_LIMITS);
  if (limited) return limited;

  const name = await displayName(identity, body.name);
  const { data, error } = await admin.rpc("matchmake", {
    p_identity: identity,
    p_client_id: body.clientId,
    p_name: name,
    p_is_heartbeat: Boolean(body.heartbeat),
    p_ttl_seconds: QUEUE_TTL_SECONDS,
  });
  if (error) {
    console.error("matchmake rpc failed:", error.message);
    return NextResponse.json({ error: "Matchmaking is unavailable right now. Try again in a moment." }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.status !== "matched") return NextResponse.json({ status: row?.status ?? "waiting" });

  // Generating the pair costs evaluation calls, so it counts against the caller's pair limits
  const pairLimited = await enforceRateLimit(identity, PAIR_LIMITS);
  if (pairLimited) return pairLimited;
  const targetPair = await generateRandomPair();
  const roomCode = randomRoomCode();
  const matchId = randomUUID();

  // The player who waited longer hosts (owns rematch pair generation)
  const forHost: MatchFound = {
    roomCode,
    matchId,
    role: "host",
    targetPair,
    opponentClientId: body.clientId,
    opponentName: name,
  };
  const forGuest: MatchFound = {
    roomCode,
    matchId,
    role: "guest",
    targetPair,
    opponentClientId: row.opponent_client_id,
    opponentName: row.opponent_name,
  };

  try {
    const ably = new Ably.Rest(ablyKey);
    await ably.channels.get(`inbox:${row.opponent_client_id}`).publish("matched", forHost);
  } catch (err) {
    console.error("Failed to notify matched opponent:", err);
    return NextResponse.json({ error: "Could not reach your opponent. Try again." }, { status: 502 });
  }

  return NextResponse.json({ status: "matched", match: forGuest });
}

// DELETE { clientId }: leave the queue
export async function DELETE(request: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: true });
  const body = await request.json().catch(() => ({}));
  const identity = await verifyCaller(request, body.clientId);
  if (!identity) return NextResponse.json({ error: "Realtime identity mismatch." }, { status: 403 });
  await admin.from("match_queue").delete().eq("identity", identity);
  return NextResponse.json({ ok: true });
}
