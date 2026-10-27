import { describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  getSessionId,
  parseCookies,
  sessionCookie,
} from "./cookies.js";

describe("parseCookies", () => {
  it("reads several cookies", () => {
    const c = parseCookies("a=1; b=2;c=3");
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBe("2");
    expect(c.get("c")).toBe("3");
  });

  it("lets the first cookie win when a name repeats", () => {
    expect(parseCookies("sid=first; sid=second").get("sid")).toBe("first");
  });

  it("copes with a missing header and with junk", () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies("").size).toBe(0);
    const c = parseCookies("; ; =x; novalue; k=v");
    expect(c.size).toBe(1);
    expect(c.get("k")).toBe("v");
  });

  it("strips quotes, decodes percent-encoding and keeps invalid encoding as is", () => {
    const c = parseCookies('a="hello"; b=a%20b; c=%E0%A4%A');
    expect(c.get("a")).toBe("hello");
    expect(c.get("b")).toBe("a b");
    expect(c.get("c")).toBe("%E0%A4%A");
  });
});

describe("getSessionId", () => {
  it("finds the sid cookie among others", () => {
    expect(getSessionId("theme=dark; sid=abc123; x=y")).toBe("abc123");
    expect(getSessionId("theme=dark")).toBeUndefined();
    expect(getSessionId(undefined)).toBeUndefined();
  });
});

describe("sessionCookie", () => {
  it("sets the security flags and the lifetime", () => {
    const c = sessionCookie("abc_DEF-123", { secure: true, maxAgeS: 604800 });
    expect(c).toBe("sid=abc_DEF-123; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure");
  });

  it("leaves out Secure when asked", () => {
    const c = sessionCookie("abc", { secure: false, maxAgeS: 60 });
    expect(c).not.toContain("Secure");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
  });

  it("builds a cookie that deletes itself", () => {
    const c = clearSessionCookie(true);
    expect(c).toContain("sid=;");
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("1970");
    expect(c).toContain("Secure");
  });

  it("refuses an id that could break the header", () => {
    for (const id of ["a;b", "a b", "a\r\nSet-Cookie: x=1", "", "a=b"]) {
      expect(() => sessionCookie(id, { secure: true, maxAgeS: 60 })).toThrow();
    }
  });
});
