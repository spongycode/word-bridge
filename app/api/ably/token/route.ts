import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import Ably from "ably";
import { resolveIdentity, GUEST_COOKIE, guestCookieOptions } from "@/app/lib/identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ABLY_API_KEY is not configured" }, { status: 500 });
  }

  // The server decides identity; the client only picks a per-tab suffix
  const tabParam = request.nextUrl.searchParams.get("tab") ?? "";
  const tab = /^[a-z0-9]{4,12}$/.test(tabParam) ? tabParam : randomBytes(4).toString("hex");

  try {
    const { identity, newGuestCookie } = await resolveIdentity(request);
    const clientId = `${identity}.${tab}`;
    const client = new Ably.Rest(apiKey);
    const tokenRequestData = await client.auth.createTokenRequest({
      clientId,
      // Game rooms, plus a private inbox only this tab can read (matchmaking notifications).
      // Ably wildcards only match a whole namespace ("room:*"), so rooms and inboxes are separate namespaces.
      capability: JSON.stringify({
        "room:*": ["publish", "subscribe", "history"],
        [`inbox:${clientId}`]: ["subscribe"],
      }),
    });

    const response = NextResponse.json(tokenRequestData);
    if (newGuestCookie) response.cookies.set(GUEST_COOKIE, newGuestCookie, guestCookieOptions);
    return response;
  } catch (error: any) {
    console.error("Error creating Ably token request:", error);
    return NextResponse.json({ error: error.message || "Failed to generate token" }, { status: 500 });
  }
}
