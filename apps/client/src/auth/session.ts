import { createAuthApi, type Session } from "./api";

export const authApi = createAuthApi();

let current: Session | null = null;

export function setSession(s: Session | null): void {
  current = s;
}

export function getSession(): Session | null {
  return current;
}

/** Used by the game to open its WebSocket. Throws if not signed in or the ticket is refused. */
export async function getWsTicket(): Promise<string> {
  if (!current) throw new Error("not signed in");
  const r = await authApi.wsTicket(current.csrfToken);
  if (!r.ok) throw new Error(`ticket failed (${r.failure.kind})`);
  return r.value;
}
