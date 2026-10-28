import { createHash } from "node:crypto";
import { normalizeEmail } from "../db/users.js";

// The few Redis commands we use. An ioredis client fits this shape,
// and tests can pass a fake.
export type RateStore = {
  incr(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  set(key: string, value: string, mode: "PX", ms: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export type Policy = { name: string; max: number; windowMs: number };

// Per-IP limits. Every attempt counts, including bad requests.
export const LOGIN_IP: Policy = { name: "login-ip", max: 30, windowMs: 15 * 60_000 };
export const REGISTER_IP: Policy = { name: "register-ip", max: 5, windowMs: 60 * 60_000 };
export const GUEST_IP: Policy = { name: "guest-ip", max: 10, windowMs: 60 * 60_000 };

// Per-account lockout on login: after 5 failures the account is locked for
// 30 s, doubling with each further failure up to 15 minutes.
export const LOGIN_LOCK_AFTER = 5;
export const LOGIN_LOCK_BASE_MS = 30_000;
export const LOGIN_LOCK_MAX_MS = 15 * 60_000;
// The failure count lives this long after the last failure.
export const LOGIN_FAIL_WINDOW_MS = 30 * 60_000;

export type LimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

async function touch(
  store: RateStore,
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> {
  const count = await store.incr(key);
  let ttlMs = await store.pttl(key);
  // First hit, or a key that lost its expiry: (re)start the window so a key can never live forever.
  if (count === 1 || ttlMs < 0) {
    await store.pexpire(key, windowMs);
    ttlMs = windowMs;
  }
  return { count, ttlMs };
}

/** Counts one attempt for `id` (for example an IP address) and says whether it is allowed. */
export async function checkLimit(
  store: RateStore,
  policy: Policy,
  id: string,
): Promise<LimitResult> {
  const { count, ttlMs } = await touch(store, `rl:${policy.name}:${id}`, policy.windowMs);
  return count > policy.max ? { allowed: false, retryAfterMs: ttlMs } : { allowed: true };
}

// Redis only sees a hash of the email, never the address itself.
function accountId(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function lockMsFor(failures: number): number {
  if (failures < LOGIN_LOCK_AFTER) return 0;
  return Math.min(LOGIN_LOCK_BASE_MS * 2 ** (failures - LOGIN_LOCK_AFTER), LOGIN_LOCK_MAX_MS);
}

/** Milliseconds left on the account's lock, or 0 if it is not locked. */
export async function loginLockRemainingMs(store: RateStore, email: string): Promise<number> {
  const ttl = await store.pttl(`rl:lock:${accountId(email)}`);
  return ttl > 0 ? ttl : 0;
}

/** Call after a failed login. Works the same whether or not the account exists. */
export async function recordLoginFailure(
  store: RateStore,
  email: string,
): Promise<{ failures: number; lockMs: number }> {
  const id = accountId(email);
  const failKey = `rl:fail:${id}`;
  const failures = await store.incr(failKey);
  await store.pexpire(failKey, LOGIN_FAIL_WINDOW_MS);
  const lockMs = lockMsFor(failures);
  if (lockMs > 0) await store.set(`rl:lock:${id}`, "1", "PX", lockMs);
  return { failures, lockMs };
}

/** Call after a successful login. */
export async function clearLoginFailures(store: RateStore, email: string): Promise<void> {
  const id = accountId(email);
  await store.del(`rl:fail:${id}`);
  await store.del(`rl:lock:${id}`);
}
