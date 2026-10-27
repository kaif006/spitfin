import { describe, it, expect } from "vitest";
import { buildApp } from "./app";

const ok = async () => { };
const fail = async () => { throw new Error("nope"); };
const hang = () => new Promise<void>(() => { });

describe("http app", () => {
  it("/healthz answers ok without touching dependencies", async () => {
    const app = buildApp({ checks: [{ name: "db", check: fail }] });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("/readyz is 200 when every check passes", async () => {
    const app = buildApp({ checks: [{ name: "postgres", check: ok }, { name: "redis", check: ok }] });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, checks: { postgres: "ok", redis: "ok" } });
  });

  it("/readyz is 503 and names the failing dependency", async () => {
    const app = buildApp({ checks: [{ name: "postgres", check: ok }, { name: "redis", check: fail }] });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, checks: { postgres: "ok", redis: "down" } });
  });

  it("/readyz treats a hanging check as down", async () => {
    const app = buildApp({ checks: [{ name: "redis", check: hang }], readyTimeoutMs: 50 });
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.redis).toBe("down");
  });

  it("unknown routes are 404", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
  });
});
