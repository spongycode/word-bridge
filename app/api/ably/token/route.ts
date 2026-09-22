import { NextResponse } from "next/server";
import Ably from "ably";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ABLY_API_KEY is not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId") || `player_${Math.random().toString(36).substring(2, 8)}`;

  try {
    const client = new Ably.Rest(apiKey);
    const tokenRequestData = await client.auth.createTokenRequest({ clientId });
    return NextResponse.json(tokenRequestData);
  } catch (error: any) {
    console.error("Error creating Ably token request:", error);
    return NextResponse.json({ error: error.message || "Failed to generate token" }, { status: 500 });
  }
}
