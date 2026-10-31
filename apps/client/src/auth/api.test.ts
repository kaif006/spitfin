import { describe, expect, it, vi } from "vitest";
import { createAuthApi, type FetchLike } from "./api";

const USER = { id: "u1", email: "a@b.co", displayName: "Gilly", isGuest: false };
const SESSION_BODY = { user: USER, csrfToken: "tok" };

function reply(status: number, body?: unknown, headers?: Record<string, string>): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function setup() {
  const fetchFn = vi.fn<FetchLike>();
  return { fetchFn, api: createAuthApi(fetchFn) };
}

describe("auth api", () => {
  it("me returns the session", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(200, SESSION_BODY));
    const r = await api.me();
    expect(r).toEqual({ ok: true, value: { user: USER, csrfToken: "tok" } });
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/auth/me");
  });

  it("me maps 401 to unauthenticated", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(401, { error: "unauthenticated" }));
    expect(await api.me()).toEqual({ ok: false, failure: { kind: "unauthenticated" } });
  });

  it("login posts JSON with a content type", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(200, SESSION_BODY));
    await api.login("a@b.co", "pw");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/login");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ email: "a@b.co", password: "pw" });
  });

  it("login maps 400 to field errors", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(
      reply(400, { error: "invalid", fields: [{ field: "email", code: "invalid" }, { nope: 1 }] }),
    );
    expect(await api.login("x", "y")).toEqual({
      ok: false,
      failure: { kind: "invalid", fields: [{ field: "email", code: "invalid" }] },
    });
  });

  it("login maps 401 invalid_credentials", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(401, { error: "invalid_credentials" }));
    expect(await api.login("a@b.co", "pw")).toEqual({ ok: false, failure: { kind: "invalid_credentials" } });
  });

  it("register posts email, password and display name", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(201, SESSION_BODY));
    const r = await api.register("a@b.co", "longenoughpw", "Gilly");
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/register");
    expect(JSON.parse(init?.body as string)).toEqual({
      email: "a@b.co",
      password: "longenoughpw",
      displayName: "Gilly",
    });
  });

  it("register maps 409 to email_taken", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(409, { error: "email_taken" }));
    expect(await api.register("a@b.co", "longenoughpw", "Gilly")).toEqual({
      ok: false,
      failure: { kind: "email_taken" },
    });
  });

  it("429 uses retryAfterS from the body", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(429, { error: "rate_limited", retryAfterS: 15 }, { "Retry-After": "99" }));
    expect(await api.login("a@b.co", "pw")).toEqual({
      ok: false,
      failure: { kind: "rate_limited", retryAfterS: 15 },
    });
  });

  it("429 falls back to the Retry-After header", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(429, { error: "rate_limited" }, { "Retry-After": "20" }));
    expect(await api.guest()).toEqual({ ok: false, failure: { kind: "rate_limited", retryAfterS: 20 } });
  });

  it("429 with neither value waits 30 seconds", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(429, {}));
    expect(await api.guest()).toEqual({ ok: false, failure: { kind: "rate_limited", retryAfterS: 30 } });
  });

  it("reports a network failure", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await api.me()).toEqual({ ok: false, failure: { kind: "network" } });
  });

  it("treats a 2xx with an unusable body as a server problem", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(200, { nope: 1 }));
    expect(await api.me()).toEqual({ ok: false, failure: { kind: "server", status: 200 } });
  });

  it("guest posts with no body", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(201, SESSION_BODY));
    const r = await api.guest();
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/guest");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("logout sends the CSRF token and succeeds on 204", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(204));
    expect(await api.logout("tok")).toEqual({ ok: true, value: null });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/logout");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
  });

  it("logout maps 403 to forbidden", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(403, { error: "bad_csrf" }));
    expect(await api.logout("bad")).toEqual({ ok: false, failure: { kind: "forbidden" } });
  });

  it("wsTicket returns the ticket and sends the token", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(200, { ticket: "abc", expiresInS: 30 }));
    expect(await api.wsTicket("tok")).toEqual({ ok: true, value: "abc" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/auth/ws-ticket");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
  });

  it("wsTicket maps 401 to unauthenticated", async () => {
    const { fetchFn, api } = setup();
    fetchFn.mockResolvedValueOnce(reply(401, { error: "unauthenticated" }));
    expect(await api.wsTicket("tok")).toEqual({ ok: false, failure: { kind: "unauthenticated" } });
  });
});
