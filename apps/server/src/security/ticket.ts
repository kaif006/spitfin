import { createHash, randomBytes } from "node:crypto";

// A ticket is a one-time pass for opening a WebSocket. It lives for 30 seconds.
export const TICKET_TTL_S = 30;

const KEY_PREFIX = "wst:";
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;

export type TicketStore = {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
};

// Like sessions, Redis only sees a hash of the ticket.
function keyFor(ticket: string): string {
  return KEY_PREFIX + createHash("sha256").update(ticket).digest("hex");
}

export async function issueTicket(store: TicketStore, userId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await store.set(keyFor(ticket), userId, "EX", TICKET_TTL_S);
  return ticket;
}

/** Returns the user ID the ticket was issued for, or null. A ticket works once. */
export async function consumeTicket(
  store: TicketStore,
  ticket: string,
): Promise<string | null> {
  if (!TICKET_RE.test(ticket)) return null;
  return store.getdel(keyFor(ticket));
}
