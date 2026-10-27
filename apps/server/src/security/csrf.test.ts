import { describe, expect, it } from "vitest";
import { csrfTokenFor, csrfTokenMatches, originAllowed } from "./csrf.js";

describe("csrf token", () => {
  it("is stable for a session id and different for another", () => {
    const a = "A".repeat(43);
    const b = "B".repeat(43);
    expect(csrfTokenFor(a)).toBe(csrfTokenFor(a));
    expect(csrfTokenFor(a)).not.toBe(csrfTokenFor(b));
    expect(csrfTokenFor(a)).not.toContain(a);
  });

  it("matches only the exact token", () => {
    const id = "A".repeat(43);
    const t = csrfTokenFor(id);
    expect(csrfTokenMatches(id, t)).toBe(true);
    const bad: unknown[] = [undefined, null, 42, "", t.slice(1), t + "x", csrfTokenFor("B".repeat(43)), [t]];
    for (const b of bad) expect(csrfTokenMatches(id, b)).toBe(false);
  });
});

describe("originAllowed", () => {
  it("allows a missing Origin and a matching host", () => {
    expect(originAllowed(undefined, "localhost:8000")).toBe(true);
    expect(originAllowed("http://localhost:8000", "localhost:8000")).toBe(true);
    expect(originAllowed("https://play.example.com", "play.example.com")).toBe(true);
  });

  it("rejects other hosts, ports, null, junk and a missing Host", () => {
    expect(originAllowed("https://evil.example", "localhost:8000")).toBe(false);
    expect(originAllowed("http://localhost:9999", "localhost:8000")).toBe(false);
    expect(originAllowed("null", "localhost:8000")).toBe(false);
    expect(originAllowed("not a url", "localhost:8000")).toBe(false);
    expect(originAllowed("http://localhost:8000", undefined)).toBe(false);
  });
});
