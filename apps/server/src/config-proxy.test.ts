import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", REDIS_URL: "redis://x" };

describe("trustProxy", () => {
  it("is off by default, even in production", () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig(prod).trustProxy).toBe(false);
  });

  it("can be switched on", () => {
    expect(loadConfig({ ...prod, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(true);
  });

  it("refuses values it does not understand", () => {
    expect(() => loadConfig({ TRUST_PROXY: "maybe" })).toThrow(/TRUST_PROXY/);
  });
});
