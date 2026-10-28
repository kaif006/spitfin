import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../app.js";
import * as users from "../db/users.js";
import { CSRF_HEADER, csrfTokenFor } from "../security/csrf.js";
import { hashPassword } from "../security/password.js";
import { SESSION_MAX_AGE_S } from "../security/session.js";
import { consumeTicket } from "../security/ticket.js";
import { fakeRedis } from "../test-support/fakeRedis.js";

vi.mock("../db/users.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/users.js")>();
  return {
    ...actual,
    createUser: vi.fn(),
    createGuest: vi.fn(),
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
  };
});

const HOST = "localhost:8000";
const ORIGIN = "http://localhost:8000";
const EMAIL = "ada@example.com";
const PASSWORD = "correct horse battery";
const ADA: users.User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: EMAIL,
  displayName: "Ada",
  isGuest: false,
  createdAt: new Date(0),
};

let adaHash = "";
beforeAll(async () => {
  adaHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(users.findUserById).mockResolvedValue(ADA);
});


type App = ReturnType<typeof buildApp>;

function setup(cookieSecure = false) {
  const redis = fakeRedis();
  const app = buildApp({ auth: { db: {} as users.Db, redis, cookieSecure } });
  return { app, redis };
}

type PostOpts = {
  body?: unknown;
  sid?: string;
  csrf?: string;
  origin?: string | null; // null = send no Origin header
};

function post(app: App, url: string, opts: PostOpts = {}) {
  const headers: Record<string, string> = { host: HOST };
  if (opts.origin !== null) headers["origin"] = opts.origin ?? ORIGIN;
  if (opts.sid) headers["cookie"] = `sid=${opts.sid}`;
  if (opts.csrf) headers[CSRF_HEADER] = opts.csrf;
  return app.inject({
    method: "POST",
    url,
    headers,
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
}

function get(app: App, url: string, sid?: string) {
  const headers: Record<string, string> = { host: HOST };
  if (sid) headers["cookie"] = `sid=${sid}`;
  return app.inject({ method: "GET", url, headers });
}

function setCookieOf(res: LightMyRequestResponse): string {
  const h = res.headers["set-cookie"];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) throw new Error("no Set-Cookie header");
  return v;
}

function sidOf(res: LightMyRequestResponse): string {
  const m = /^sid=([^;]+)/.exec(setCookieOf(res));
  if (!m?.[1]) throw new Error("no session id in cookie");
  return m[1];
}

async function loginAs(app: App) {
  vi.mocked(users.findUserByEmail).mockResolvedValue({ ...ADA, pwHash: adaHash });
  const res = await post(app, "/api/auth/login", { body: { email: EMAIL, password: PASSWORD } });
  const sid = sidOf(res);
  return { sid, csrf: csrfTokenFor(sid) };
}

describe("register", () => {
  it("creates the user, starts a session and returns a csrf token", async () => {
    const { app } = setup();
    vi.mocked(users.createUser).mockResolvedValue(ADA);
    const res = await post(app, "/api/auth/register", {
      body: { email: "Ada@Example.com", password: PASSWORD, displayName: "Ada" },
    });
    expect(res.statusCode).toBe(201);
    const sid = sidOf(res);
    expect(res.json()).toEqual({
      user: { id: ADA.id, email: EMAIL, displayName: "Ada", isGuest: false },
      csrfToken: csrfTokenFor(sid),
    });
    const cookie = setCookieOf(res);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
    expect(cookie).not.toContain("Secure");
    expect((await get(app, "/api/auth/me", sid)).statusCode).toBe(200);
  });

  it("stores an argon2id hash and never echoes the password", async () => {
    const { app } = setup();
    vi.mocked(users.createUser).mockResolvedValue(ADA);
    const res = await post(app, "/api/auth/register", {
      body: { email: EMAIL, password: PASSWORD, displayName: "Ada" },
    });
    const input = vi.mocked(users.createUser).mock.calls[0]?.[1];
    expect(input?.pwHash.startsWith("$argon2id$")).toBe(true);
    expect(input?.email).toBe(EMAIL);
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toContain("argon2");
  });

  it("returns 400 with field errors and creates nothing", async () => {
    const { app } = setup();
    const res = await post(app, "/api/auth/register", {
      body: { email: "nope", password: "short", displayName: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid",
      fields: [
        { field: "email", code: "invalid" },
        { field: "password", code: "too_short" },
        { field: "displayName", code: "too_short" },
      ],
    });
    expect(users.createUser).not.toHaveBeenCalled();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 409 for a taken email, without a cookie", async () => {
    const { app } = setup();
    vi.mocked(users.createUser).mockRejectedValue(new users.EmailTakenError());
    const res = await post(app, "/api/auth/register", {
      body: { email: EMAIL, password: PASSWORD, displayName: "Ada" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "email_taken" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("adds Secure to the cookie when configured", async () => {
    const { app } = setup(true);
    vi.mocked(users.createUser).mockResolvedValue(ADA);
    const res = await post(app, "/api/auth/register", {
      body: { email: EMAIL, password: PASSWORD, displayName: "Ada" },
    });
    expect(setCookieOf(res)).toMatch(/; Secure$/);
  });
});

describe("login", () => {
  it("accepts the right password and sets a session cookie", async () => {
    const { app } = setup();
    vi.mocked(users.findUserByEmail).mockResolvedValue({ ...ADA, pwHash: adaHash });
    const res = await post(app, "/api/auth/login", {
      body: { email: "ADA@example.com", password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const sid = sidOf(res);
    expect(res.json()).toEqual({
      user: { id: ADA.id, email: EMAIL, displayName: "Ada", isGuest: false },
      csrfToken: csrfTokenFor(sid),
    });
    expect(res.body).not.toContain("argon2");
  });

  it("replaces the old session with a new one (rotation)", async () => {
    const { app } = setup();
    const first = await loginAs(app);
    const res = await post(app, "/api/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
      sid: first.sid,
    });
    const second = sidOf(res);
    expect(second).not.toBe(first.sid);
    expect((await get(app, "/api/auth/me", first.sid)).statusCode).toBe(401);
    expect((await get(app, "/api/auth/me", second)).statusCode).toBe(200);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const { app } = setup();
    vi.mocked(users.findUserByEmail).mockResolvedValue({ ...ADA, pwHash: adaHash });
    const wrong = await post(app, "/api/auth/login", {
      body: { email: EMAIL, password: "not the password" },
    });
    vi.mocked(users.findUserByEmail).mockResolvedValue(null);
    const unknown = await post(app, "/api/auth/login", {
      body: { email: "nobody@example.com", password: PASSWORD },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "invalid_credentials" });
    expect(unknown.json()).toEqual(wrong.json());
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    expect(unknown.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 400 for a malformed body", async () => {
    const { app } = setup();
    const res = await post(app, "/api/auth/login", { body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid",
      fields: [
        { field: "email", code: "required" },
        { field: "password", code: "required" },
      ],
    });
  });
});

describe("guest", () => {
  it("creates a guest named Guest-NNNN and starts a session", async () => {
    const { app } = setup();
    vi.mocked(users.createGuest).mockImplementation(async (_db, displayName) => ({
      id: "22222222-2222-4222-8222-222222222222",
      email: null,
      displayName,
      isGuest: true,
      createdAt: new Date(0),
    }));
    const res = await post(app, "/api/auth/guest");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.isGuest).toBe(true);
    expect(body.user.displayName).toMatch(/^Guest-\d{4}$/);
    expect(body.csrfToken).toBe(csrfTokenFor(sidOf(res)));
  });
});

describe("me", () => {
  it("returns 401 without a usable session", async () => {
    const { app } = setup();
    for (const sid of [undefined, "garbage", "A".repeat(43)]) {
      const res = await get(app, "/api/auth/me", sid);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "unauthenticated" });
    }
  });

  it("returns the user and csrf token for a valid session", async () => {
    const { app } = setup();
    const { sid, csrf } = await loginAs(app);
    const res = await get(app, "/api/auth/me", sid);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: { id: ADA.id, email: EMAIL, displayName: "Ada", isGuest: false },
      csrfToken: csrf,
    });
  });

  it("ends the session when the user no longer exists", async () => {
    const { app } = setup();
    const { sid } = await loginAs(app);
    vi.mocked(users.findUserById).mockResolvedValue(null);
    expect((await get(app, "/api/auth/me", sid)).statusCode).toBe(401);
    vi.mocked(users.findUserById).mockResolvedValue(ADA);
    expect((await get(app, "/api/auth/me", sid)).statusCode).toBe(401);
  });
});

describe("logout", () => {
  it("destroys the session and clears the cookie", async () => {
    const { app } = setup();
    const { sid, csrf } = await loginAs(app);
    const res = await post(app, "/api/auth/logout", { sid, csrf });
    expect(res.statusCode).toBe(204);
    expect(setCookieOf(res)).toContain("Max-Age=0");
    expect((await get(app, "/api/auth/me", sid)).statusCode).toBe(401);
  });

  it("refuses a missing or wrong csrf token and keeps the session", async () => {
    const { app } = setup();
    const { sid } = await loginAs(app);
    for (const csrf of [undefined, "wrong"]) {
      const res = await post(app, "/api/auth/logout", {
        sid,
        ...(csrf !== undefined ? { csrf } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "bad_csrf" });
    }
    expect((await get(app, "/api/auth/me", sid)).statusCode).toBe(200);
  });

  it("succeeds quietly when there is no session cookie", async () => {
    const { app } = setup();
    const res = await post(app, "/api/auth/logout");
    expect(res.statusCode).toBe(204);
    expect(setCookieOf(res)).toContain("Max-Age=0");
  });
});

describe("ws-ticket", () => {
  it("issues a single-use ticket for the logged-in user", async () => {
    const { app, redis } = setup();
    const { sid, csrf } = await loginAs(app);
    const res = await post(app, "/api/auth/ws-ticket", { sid, csrf });
    expect(res.statusCode).toBe(200);
    const { ticket, expiresInS } = res.json();
    expect(expiresInS).toBe(30);
    expect(await consumeTicket(redis, ticket)).toBe(ADA.id);
    expect(await consumeTicket(redis, ticket)).toBeNull();
  });

  it("needs a session and a csrf token", async () => {
    const { app } = setup();
    expect((await post(app, "/api/auth/ws-ticket")).statusCode).toBe(401);
    const { sid } = await loginAs(app);
    expect((await post(app, "/api/auth/ws-ticket", { sid })).statusCode).toBe(403);
  });
});

describe("request checks", () => {
  it("rejects a foreign Origin before doing any work", async () => {
    const { app } = setup();
    for (const origin of ["https://evil.example", "null"]) {
      const res = await post(app, "/api/auth/login", {
        body: { email: EMAIL, password: PASSWORD },
        origin,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "forbidden_origin" });
    }
    expect(users.findUserByEmail).not.toHaveBeenCalled();
    // No Origin at all (curl and similar) gets past this check.
    vi.mocked(users.findUserByEmail).mockResolvedValue(null);
    const res = await post(app, "/api/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
      origin: null,
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not treat a text/plain body as JSON", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { host: HOST, origin: ORIGIN, "content-type": "text/plain" },
      payload: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid", fields: [{ field: "body", code: "invalid" }] });
  });

  it("marks responses as not cacheable", async () => {
    const { app } = setup();
    const res = await get(app, "/api/auth/me");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("registers no auth routes when no auth dependencies are given", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(404);
  });
});

describe("rate limits", () => {
  const wrongLogin = (app: App, email = EMAIL) =>
    post(app, "/api/auth/login", { body: { email, password: "not the password" } });

  beforeEach(() => {
    vi.mocked(users.findUserByEmail).mockResolvedValue({ ...ADA, pwHash: adaHash });
  });

  it("locks an account after 5 wrong passwords, even for the right password", async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) expect((await wrongLogin(app)).statusCode).toBe(401);
    const callsBefore = vi.mocked(users.findUserByEmail).mock.calls.length;
    const res = await post(app, "/api/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "rate_limited", retryAfterS: 30 });
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Refused before any lookup or hashing.
    expect(vi.mocked(users.findUserByEmail).mock.calls.length).toBe(callsBefore);
  });

  it("locks unknown emails the same way, so lockout does not reveal accounts", async () => {
    const { app } = setup();
    vi.mocked(users.findUserByEmail).mockResolvedValue(null);
    for (let i = 0; i < 5; i++) expect((await wrongLogin(app, "nobody@example.com")).statusCode).toBe(401);
    expect((await wrongLogin(app, "nobody@example.com")).statusCode).toBe(429);
  });

  it("locks per email, ignoring letter case, and leaves other emails alone", async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) await wrongLogin(app);
    expect((await wrongLogin(app, "ADA@Example.com")).statusCode).toBe(429);
    expect((await wrongLogin(app, "grace@example.com")).statusCode).toBe(401);
  });

  it("a successful login resets the failure count", async () => {
    const { app } = setup();
    for (let i = 0; i < 4; i++) expect((await wrongLogin(app)).statusCode).toBe(401);
    const ok = await post(app, "/api/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    for (let i = 0; i < 4; i++) expect((await wrongLogin(app)).statusCode).toBe(401);
  });

  it("limits login attempts per IP, counting bad requests too", async () => {
    const { app } = setup();
    for (let i = 0; i < 30; i++) {
      expect((await post(app, "/api/auth/login", { body: {} })).statusCode).toBe(400);
    }
    const res = await post(app, "/api/auth/login", { body: {} });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("900");
  });

  it("limits registrations to 5 per hour per IP", async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      expect((await post(app, "/api/auth/register", { body: {} })).statusCode).toBe(400);
    }
    const res = await post(app, "/api/auth/register", { body: {} });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("3600");
  });

  it("limits guest accounts to 10 per hour per IP", async () => {
    const { app } = setup();
    vi.mocked(users.createGuest).mockImplementation(async (_db, displayName) => ({
      id: "22222222-2222-4222-8222-222222222222",
      email: null,
      displayName,
      isGuest: true,
      createdAt: new Date(0),
    }));
    for (let i = 0; i < 10; i++) expect((await post(app, "/api/auth/guest")).statusCode).toBe(201);
    expect((await post(app, "/api/auth/guest")).statusCode).toBe(429);
  });

  it("only believes X-Forwarded-For when trustProxy is on", async () => {
    const attempt = (app: App, ip: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { host: HOST, origin: ORIGIN, "x-forwarded-for": ip },
        payload: {},
      });

    // Off: a forged header does not give a fresh allowance.
    const plain = setup().app;
    for (let i = 0; i < 30; i++) await attempt(plain, "1.1.1.1");
    expect((await attempt(plain, "2.2.2.2")).statusCode).toBe(429);

    // On: each forwarded address gets its own count.
    const proxied = buildApp({
      trustProxy: true,
      auth: { db: {} as users.Db, redis: fakeRedis(), cookieSecure: false },
    });
    for (let i = 0; i < 30; i++) await attempt(proxied, "1.1.1.1");
    expect((await attempt(proxied, "1.1.1.1")).statusCode).toBe(429);
    expect((await attempt(proxied, "2.2.2.2")).statusCode).toBe(400);
  });
});
