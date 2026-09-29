import * as Ably from "ably";

export interface AblyConnection {
  ably: Ably.Realtime;
  clientId: string; // assigned by the server token route: "<identity>.<tab>"
}

let connectionPromise: Promise<AblyConnection> | null = null;

// Connects once per tab; the resolved clientId is the server-verified identity Ably stamps on every message
export function connectAbly(): Promise<AblyConnection> {
  if (connectionPromise) return connectionPromise;

  const tab = Math.random().toString(36).substring(2, 8).padEnd(4, "0");
  const ably = new Ably.Realtime({ authUrl: `/api/ably/token?tab=${tab}`, autoConnect: true });

  connectionPromise = new Promise((resolve, reject) => {
    ably.connection.once("connected", () => resolve({ ably, clientId: ably.auth.clientId }));
    ably.connection.once("failed", (change) => {
      connectionPromise = null;
      reject(new Error(change.reason?.message || "Realtime connection failed"));
    });
  });
  return connectionPromise;
}

// Identity part of a clientId (same person across tabs/devices)
export function identityOf(clientId: string | undefined | null): string {
  return (clientId ?? "").split(".")[0];
}

export function closeAblyRealtime() {
  connectionPromise?.then(({ ably }) => ably.close()).catch(() => {});
  connectionPromise = null;
}
