import { NextResponse, type NextRequest } from "next/server";
import Ably from "ably";
import { getSupabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveIdentity, clientIdBelongsTo } from "@/app/lib/identity";
import { enforceRateLimit } from "@/app/lib/rateLimit";
import { USERNAME_PATTERN } from "@/app/lib/player";
import type { RaceInvite } from "@/app/lib/dailyRun";

export const dynamic = "force-dynamic";

const INVITE_LIMITS = [
  { name: "invite-min", limit: 6, windowSeconds: 60 },
  { name: "invite-day", limit: 100, windowSeconds: 86400 },
];

const IDENTITY_PATTERN = /^(u-[0-9a-f-]{36}|g-[a-z0-9]{12})$/;

// POST { clientId, toIdentity, roomCode, name }: invite a past opponent to a friend room
export async function POST(request: NextRequest) {
  const ablyKey = process.env.ABLY_API_KEY;
  if (!ablyKey) return NextResponse.json({ error: "Invites are not configured on the server." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const { identity, newGuestCookie } = await resolveIdentity(request);
  if (newGuestCookie || !clientIdBelongsTo(body.clientId, identity)) {
    return NextResponse.json({ error: "Realtime identity mismatch. Reload the page and try again." }, { status: 403 });
  }

  const toIdentity = body.toIdentity;
  if (typeof toIdentity !== "string" || !IDENTITY_PATTERN.test(toIdentity) || toIdentity === identity) {
    return NextResponse.json({ error: "Can't invite that player." }, { status: 400 });
  }
  if (typeof body.roomCode !== "string" || !/^[A-Z0-9]{4,6}$/.test(body.roomCode)) {
    return NextResponse.json({ error: "Invalid room." }, { status: 400 });
  }

  const limited = await enforceRateLimit(identity, INVITE_LIMITS);
  if (limited) return limited;

  // Signed-in players are shown under their verified profile username
  let fromName = typeof body.name === "string" && USERNAME_PATTERN.test(body.name) ? body.name : "A past opponent";
  const admin = getSupabaseAdmin();
  if (identity.startsWith("u-") && admin) {
    const { data } = await admin.from("profiles").select("username").eq("id", identity.slice(2)).maybeSingle();
    if (data?.username) fromName = data.username;
  }

  const invite: RaceInvite = { roomCode: body.roomCode, fromName, fromIdentity: identity };
  try {
    await new Ably.Rest(ablyKey).channels.get(`inbox:${toIdentity}`).publish("invite", invite);
  } catch (err) {
    console.error("Invite publish failed:", err);
    return NextResponse.json({ error: "Couldn't send the invite. Share the room link instead." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
