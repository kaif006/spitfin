import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", REDIS_URL: "redis://x" };

describe("cookieSecure", () => {
  it("defaults to on only in production", () => {
    expect(loadConfig({}).cookieSecure).toBe(false);
    expect(loadConfig({ NODE_ENV: "test" }).cookieSecure).toBe(false);
    expect(loadConfig(prod).cookieSecure).toBe(true);
  });

  it("can be set explicitly", () => {
    expect(loadConfig({ ...prod, COOKIE_SECURE: "false" }).cookieSecure).toBe(false);
    expect(loadConfig({ ...prod, COOKIE_SECURE: "0" }).cookieSecure).toBe(false);
    expect(loadConfig({ COOKIE_SECURE: "true" }).cookieSecure).toBe(true);
    expect(loadConfig({ COOKIE_SECURE: "TRUE" }).cookieSecure).toBe(true);
  });

  it("refuses values it does not understand", () => {
    expect(() => loadConfig({ COOKIE_SECURE: "yes" })).toThrow(/COOKIE_SECURE/);
  });
});
