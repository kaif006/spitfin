import { describe, expect, it } from "vitest";
import type { AuthFailure } from "./api";
import { failureMessage, fieldErrors, formatWait } from "./messages";

describe("messages", () => {
  it("maps each known code to a message for its field", () => {
    const { byField, general } = fieldErrors([
      { field: "email", code: "invalid" },
      { field: "password", code: "too_short" },
      { field: "displayName", code: "too_long" },
    ]);
    expect(byField.email).toMatch(/valid email/);
    expect(byField.password).toMatch(/at least 10/);
    expect(byField.displayName).toMatch(/at most 16/);
    expect(general).toBeNull();
  });

  it("sends unknown fields and codes to the general message", () => {
    expect(fieldErrors([{ field: "body", code: "invalid" }]).general).not.toBeNull();
    const r = fieldErrors([{ field: "email", code: "weird" }]);
    expect(r.byField.email).toBeUndefined();
    expect(r.general).not.toBeNull();
  });

  it("has a message for every failure kind", () => {
    const all: AuthFailure[] = [
      { kind: "invalid", fields: [] },
      { kind: "invalid_credentials" },
      { kind: "email_taken" },
      { kind: "rate_limited", retryAfterS: 15 },
      { kind: "unauthenticated" },
      { kind: "forbidden" },
      { kind: "network" },
      { kind: "server", status: 500 },
    ];
    const texts = all.map(failureMessage);
    expect(texts.every((t) => t.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(all.length);
  });

  it("words the wait in seconds or minutes", () => {
    expect(formatWait(1)).toBe("1 second");
    expect(formatWait(15)).toBe("15 seconds");
    expect(formatWait(60)).toBe("1 minute");
    expect(formatWait(61)).toBe("2 minutes");
  });
});
