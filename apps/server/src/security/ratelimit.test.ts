import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { fakeRedis } from "../test-support/fakeRedis.js";
import {
  checkLimit,
  clearLoginFailures,
  LOGIN_IP,
  loginLockRemainingMs,
  lockMsFor,
  recordLoginFailure,
  type RateStore,
} from "./ratelimit.js";

const policy = { name: "t", max: 3, windowMs: 10_000 };

describe("checkLimit", () => {
  it("allows up to the maximum, then blocks until the window ends", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 3; i++) expect(await checkLimit(r, policy, "a")).toEqual({ allowed: true });
    expect(await checkLimit(r, policy, "a")).toEqual({ allowed: false, retryAfterMs: 10_000 });
  });

  it("starts a fresh window once the old one has expired", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 4; i++) await checkLimit(r, policy, "a");
    r.clock.now = 10_000;
    expect(await checkLimit(r, policy, "a")).toEqual({ allowed: true });
  });

  it("keeps a separate count for each id", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 4; i++) await checkLimit(r, policy, "a");
    expect(await checkLimit(r, policy, "b")).toEqual({ allowed: true });
  });

  it("does not extend the window when blocked attempts keep coming", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 4; i++) await checkLimit(r, policy, "a");
    r.clock.now = 4_000;
    expect(await checkLimit(r, policy, "a")).toEqual({ allowed: false, retryAfterMs: 6_000 });
  });

  it("gives an expiry to a key that somehow has none", async () => {
    const r = fakeRedis();
    r.data.set("rl:login-ip:1.2.3.4", { value: "5", expiresAt: null });
    await checkLimit(r, LOGIN_IP, "1.2.3.4");
    expect(await r.pttl("rl:login-ip:1.2.3.4")).toBe(LOGIN_IP.windowMs);
  });
});

describe("login lockout", () => {
  it("doubles the lock from 30 seconds up to a 15 minute cap", () => {
    expect(lockMsFor(4)).toBe(0);
    expect(lockMsFor(5)).toBe(30_000);
    expect(lockMsFor(6)).toBe(60_000);
    expect(lockMsFor(7)).toBe(120_000);
    expect(lockMsFor(9)).toBe(480_000);
    expect(lockMsFor(10)).toBe(900_000);
    expect(lockMsFor(100)).toBe(900_000);
  });

  it("locks from the fifth failure and unlocks as time passes", async () => {
    const r = fakeRedis();
    for (let i = 1; i <= 4; i++) {
      expect(await recordLoginFailure(r, "a@b.co")).toEqual({ failures: i, lockMs: 0 });
      expect(await loginLockRemainingMs(r, "a@b.co")).toBe(0);
    }
    expect(await recordLoginFailure(r, "a@b.co")).toEqual({ failures: 5, lockMs: 30_000 });
    expect(await loginLockRemainingMs(r, "a@b.co")).toBe(30_000);
    r.clock.now = 10_000;
    expect(await loginLockRemainingMs(r, "a@b.co")).toBe(20_000);
    r.clock.now = 30_000;
    expect(await loginLockRemainingMs(r, "a@b.co")).toBe(0);
  });

  it("keeps counting after a lock ends, so the next lock is longer", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 5; i++) await recordLoginFailure(r, "a@b.co");
    r.clock.now = 30_000;
    expect(await recordLoginFailure(r, "a@b.co")).toEqual({ failures: 6, lockMs: 60_000 });
  });

  it("treats emails case-insensitively and stores only a hash", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 5; i++) await recordLoginFailure(r, "ADA@Example.com ");
    expect(await loginLockRemainingMs(r, "ada@example.com")).toBe(30_000);
    for (const key of r.data.keys()) {
      expect(key.startsWith("rl:")).toBe(true);
      expect(key).not.toContain("@");
      expect(key.toLowerCase()).not.toContain("example");
    }
  });

  it("clearLoginFailures removes both the count and the lock", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 5; i++) await recordLoginFailure(r, "a@b.co");
    await clearLoginFailures(r, "a@b.co");
    expect(await loginLockRemainingMs(r, "a@b.co")).toBe(0);
    expect(await recordLoginFailure(r, "a@b.co")).toEqual({ failures: 1, lockMs: 0 });
  });
});

describe("types", () => {
  it("an ioredis client satisfies RateStore (compile-time check)", () => {
    const accepts = (redis: Redis): RateStore => redis;
    expect(typeof accepts).toBe("function");
  });
});
