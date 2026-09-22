import * as Ably from "ably";

let ablyClient: Ably.Realtime | null = null;

export function getAblyRealtime(clientId?: string): Ably.Realtime {
  if (ablyClient) return ablyClient;

  ablyClient = new Ably.Realtime({
    authUrl: `/api/ably/token${clientId ? `?clientId=${clientId}` : ""}`,
    autoConnect: true,
  });

  return ablyClient;
}

export function closeAblyRealtime() {
  if (ablyClient) {
    ablyClient.close();
    ablyClient = null;
  }
}
