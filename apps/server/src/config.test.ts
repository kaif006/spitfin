import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("uses dev defaults outside production", () => {
    const c = loadConfig({});
    expect(c.nodeEnv).toBe("development");
    expect(c.port).toBe(8080);
    expect(c.databaseUrl).toContain("localhost:5432");
    expect(c.redisUrl).toContain("localhost:6379");
  });

  it("requires DATABASE_URL and REDIS_URL in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", REDIS_URL: "redis://r" })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://d" })).toThrow(/REDIS_URL/);
  });

  it("accepts a full production environment", () => {
    const c = loadConfig({
      NODE_ENV: "production", PORT: "9000",
      DATABASE_URL: "postgres://d", REDIS_URL: "redis://r",
    });
    expect(c).toEqual({
      nodeEnv: "production", port: 9000,
      databaseUrl: "postgres://d", redisUrl: "redis://r",
      cookieSecure: true,
      trustProxy: false,
    });
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
  });
});
