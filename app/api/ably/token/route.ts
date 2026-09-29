import { NextResponse, type NextRequest } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import Ably from "ably";
import { getSessionUserId } from "@/app/lib/supabase/session";

export const dynamic = "force-dynamic";

const GUEST_COOKIE = "wb_guest";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url").slice(0, 32);
}

// Guest ids live in an HMAC-signed httpOnly cookie so they are stable across token renewals and can't be forged
function readGuestId(request: NextRequest, secret: string): string | null {
  const raw = request.cookies.get(GUEST_COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig || !/^[a-z0-9]{12}$/.test(id)) return null;
  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ABLY_API_KEY is not configured" }, { status: 500 });
  }

  // The server decides identity; the client only picks a per-tab suffix
  const tabParam = request.nextUrl.searchParams.get("tab") ?? "";
  const tab = /^[a-z0-9]{4,12}$/.test(tabParam) ? tabParam : randomBytes(4).toString("hex");

  const userId = await getSessionUserId();
  let newGuestCookie: string | null = null;
  let base: string;

  if (userId) {
    base = `u-${userId}`;
  } else {
    let guestId = readGuestId(request, apiKey);
    if (!guestId) {
      guestId = randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 12).padEnd(12, "0");
      newGuestCookie = `${guestId}.${sign(guestId, apiKey)}`;
    }
    base = `g-${guestId}`;
  }

  try {
    const client = new Ably.Rest(apiKey);
    const tokenRequestData = await client.auth.createTokenRequest({
      clientId: `${base}.${tab}`,
      // Game rooms only; no access to other channels on the Ably app
      capability: JSON.stringify({ "game:*": ["publish", "subscribe", "history"] }),
    });

    const response = NextResponse.json(tokenRequestData);
    if (newGuestCookie) {
      response.cookies.set(GUEST_COOKIE, newGuestCookie, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  } catch (error: any) {
    console.error("Error creating Ably token request:", error);
    return NextResponse.json({ error: error.message || "Failed to generate token" }, { status: 500 });
  }
}
