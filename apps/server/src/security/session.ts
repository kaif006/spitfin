import { createHash, randomBytes } from "node:crypto";

// Idle sessions expire after 7 days. Each use pushes that back,
// but never past 30 days after login.
export const SESSION_IDLE_TTL_S = 7 * 24 * 60 * 60;
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const KEY_PREFIX = "sess:";
// 32 random bytes in base64url is always 43 characters.
const ID_RE = /^[A-Za-z0-9_-]{43}$/;

// The few Redis commands we use. An ioredis client fits this shape,
// and tests can pass a fake.
export type SessionStore = {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
};

export type Session = {
  userId: string;
  /** Milliseconds since the epoch, set when the session was created. */
  createdAt: number;
};

// Redis only ever sees a hash of the ID, so reading Redis does not reveal usable cookies.
function keyFor(id: string): string {
  return KEY_PREFIX + createHash("sha256").update(id).digest("hex");
}

function parseSession(raw: string): Session | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const rec = v as Record<string, unknown>;
    if (typeof rec["userId"] !== "string") return null;
    if (typeof rec["createdAt"] !== "number" || !Number.isFinite(rec["createdAt"])) {
      return null;
    }
    return { userId: rec["userId"], createdAt: rec["createdAt"] };
  } catch {
    return null;
  }
}

export async function createSession(
  store: SessionStore,
  userId: string,
  now: number = Date.now(),
): Promise<{ id: string; session: Session }> {
  const id = randomBytes(32).toString("base64url");
  const session: Session = { userId, createdAt: now };
  await store.set(keyFor(id), JSON.stringify(session), "EX", SESSION_IDLE_TTL_S);
  return { id, session };
}

/**
 * Looks up a session from the ID in the cookie. Returns null if the ID is
 * malformed, unknown, expired or corrupt. A valid session has its idle timer
 * extended, but never beyond the absolute 30 day limit.
 */
export async function getSession(
  store: SessionStore,
  id: string,
  now: number = Date.now(),
): Promise<Session | null> {
  // Reject junk before it reaches Redis.
  if (!ID_RE.test(id)) return null;
  const key = keyFor(id);
  const raw = await store.get(key);
  if (raw === null) return null;

  const session = parseSession(raw);
  const elapsed = session ? Math.floor((now - session.createdAt) / 1000) : 0;
  if (session === null || elapsed >= SESSION_MAX_AGE_S) {
    await store.del(key);
    return null;
  }

  const remaining = SESSION_MAX_AGE_S - elapsed;
  await store.expire(key, Math.min(SESSION_IDLE_TTL_S, remaining));
  return session;
}

export async function destroySession(store: SessionStore, id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  await store.del(keyFor(id));
}

/**
 * Used at login: deletes the old session (if the browser sent one) and
 * issues a brand new ID, so an ID planted before login is useless afterwards.
 */
export async function rotateSession(
  store: SessionStore,
  oldId: string | undefined,
  userId: string,
  now: number = Date.now(),
): Promise<{ id: string; session: Session }> {
  if (oldId !== undefined) await destroySession(store, oldId);
  return createSession(store, userId, now);
}
