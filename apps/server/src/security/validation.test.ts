import { describe, expect, it } from "vitest";
import { parseLogin, parseRegister, type Result } from "./validation.js";

function errorsOf(result: Result<unknown>): string[] {
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors.map((e) => `${e.field}:${e.code}`);
}

const good = {
  email: "Ada@Example.com ",
  password: "correct horse battery",
  displayName: " Ada ",
};

describe("parseRegister", () => {
  it("returns normalized values", () => {
    expect(parseRegister(good)).toEqual({
      ok: true,
      value: {
        email: "ada@example.com",
        password: "correct horse battery",
        displayName: "Ada",
      },
    });
  });

  it("copies only the known fields", () => {
    const r = parseRegister({ ...good, isGuest: true, pwHash: "x", id: "1" });
    if (!r.ok) throw new Error("expected success");
    expect(Object.keys(r.value).sort()).toEqual(["displayName", "email", "password"]);
  });

  it("rejects bodies that are not objects", () => {
    for (const body of [null, undefined, "text", 42, [], [good]]) {
      expect(errorsOf(parseRegister(body))).toEqual(["body:invalid"]);
    }
  });

  it("reports every bad field at once", () => {
    expect(
      errorsOf(parseRegister({ email: "nope", password: "short", displayName: "x" })),
    ).toEqual(["email:invalid", "password:too_short", "displayName:too_short"]);
  });
});

describe("email", () => {
  it("rejects missing, blank and non-string values", () => {
    for (const email of [undefined, null, 42, "", "   "]) {
      expect(errorsOf(parseRegister({ ...good, email }))).toEqual(["email:required"]);
    }
  });

  it("rejects malformed addresses", () => {
    for (const email of ["plain", "a@b", "a b@c.de", "@b.co", "a@@b.co", "a\u0000@b.co"]) {
      expect(errorsOf(parseRegister({ ...good, email }))).toEqual(["email:invalid"]);
    }
  });

  it("rejects addresses over 254 characters", () => {
    const email = "a".repeat(250) + "@b.co";
    expect(errorsOf(parseRegister({ ...good, email }))).toEqual(["email:too_long"]);
  });
});

describe("password", () => {
  const pw = (password: string) => parseRegister({ ...good, password });

  it("enforces 10 to 128 characters", () => {
    expect(errorsOf(pw("a".repeat(9)))).toEqual(["password:too_short"]);
    expect(pw("a".repeat(10)).ok).toBe(true);
    expect(pw("a".repeat(128)).ok).toBe(true);
    expect(errorsOf(pw("a".repeat(129)))).toEqual(["password:too_long"]);
    expect(errorsOf(pw(""))).toEqual(["password:required"]);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(errorsOf(pw("😀".repeat(5)))).toEqual(["password:too_short"]);
    expect(pw("😀".repeat(10)).ok).toBe(true);
  });

  it("keeps spaces at the ends as typed", () => {
    const r = pw(" pass word 1 ");
    if (!r.ok) throw new Error("expected success");
    expect(r.value.password).toBe(" pass word 1 ");
  });

  it("normalizes with NFKC so lookalike forms hash the same", () => {
    const r = pw("ｐａｓｓｗｏｒｄ１２３");
    if (!r.ok) throw new Error("expected success");
    expect(r.value.password).toBe("password123");
  });
});

describe("displayName", () => {
  const name = (displayName: unknown) => parseRegister({ ...good, displayName });

  it("accepts good names", () => {
    for (const n of ["Ada", "Ada Lovelace", "Guest-1234", "Zoë_99", "احمد"]) {
      expect(name(n).ok).toBe(true);
    }
  });

  it("rejects bad names", () => {
    for (const n of ["_Ada", "Ada-", "a  b", "<script>", "Ada!", "name😀"]) {
      expect(errorsOf(name(n))).toEqual(["displayName:invalid"]);
    }
    expect(errorsOf(name("ab"))).toEqual(["displayName:too_short"]);
    expect(errorsOf(name("a".repeat(17)))).toEqual(["displayName:too_long"]);
    for (const n of ["", "   ", undefined]) {
      expect(errorsOf(name(n))).toEqual(["displayName:required"]);
    }
  });

  it("counts length the way Postgres does, after normalization", () => {
    // "e" plus a combining accent becomes one character after NFKC.
    expect(name("e\u0301".repeat(16)).ok).toBe(true);
    expect(errorsOf(name("e\u0301".repeat(17)))).toEqual(["displayName:too_long"]);
  });
});

describe("parseLogin", () => {
  it("accepts a short password, because login must not reveal the rules", () => {
    expect(parseLogin({ email: "ADA@example.com", password: "short" })).toEqual({
      ok: true,
      value: { email: "ada@example.com", password: "short" },
    });
  });

  it("rejects missing fields, oversized passwords and non-object bodies", () => {
    expect(errorsOf(parseLogin({}))).toEqual(["email:required", "password:required"]);
    expect(
      errorsOf(parseLogin({ email: "ada@example.com", password: "a".repeat(129) })),
    ).toEqual(["password:too_long"]);
    expect(errorsOf(parseLogin("x"))).toEqual(["body:invalid"]);
  });
});
