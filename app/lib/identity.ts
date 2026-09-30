import "server-only";
import type { NextRequest } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getSessionUserId } from "@/app/lib/supabase/session";

export const GUEST_COOKIE = "wb_guest";

function secret(): string {
  const key = process.env.ABLY_API_KEY;
  if (!key) throw new Error("ABLY_API_KEY is not configured");
  return key;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 32);
}

// Guest ids live in an HMAC-signed httpOnly cookie so they are stable and can't be forged
function readGuestId(request: NextRequest): string | null {
  const raw = request.cookies.get(GUEST_COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig || !/^[a-z0-9]{12}$/.test(id)) return null;
  const expected = Buffer.from(sign(id));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}

export interface PlayerIdentity {
  identity: string; // "u-<uuid>" or "g-<guest id>"
  newGuestCookie: string | null; // set when a guest id was just minted
}

// Resolves who is calling: signed-in user id, or a signed guest cookie (minted if missing)
export async function resolveIdentity(request: NextRequest): Promise<PlayerIdentity> {
  const userId = await getSessionUserId();
  if (userId) return { identity: `u-${userId}`, newGuestCookie: null };

  const existing = readGuestId(request);
  if (existing) return { identity: `g-${existing}`, newGuestCookie: null };

  const guestId = randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 12).padEnd(12, "0");
  return { identity: `g-${guestId}`, newGuestCookie: `${guestId}.${sign(guestId)}` };
}

// Realtime clientIds are "<identity>.<tab>"; true when the clientId belongs to this identity
export function clientIdBelongsTo(clientId: unknown, identity: string): clientId is string {
  return typeof clientId === "string" && clientId.startsWith(`${identity}.`) && /^[a-z0-9]{4,12}$/.test(clientId.slice(identity.length + 1));
}

export const guestCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};
