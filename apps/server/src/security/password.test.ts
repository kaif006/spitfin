import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("produces an argon2id hash", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("correct horse battery");
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "correct horse batterY")).toBe(false);
  });

  it("gives a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password here");
    const b = await hashPassword("same password here");
    expect(a).not.toBe(b);
  });

  it("returns false, without throwing, for a corrupt stored hash", async () => {
    expect(await verifyPassword("not-a-real-hash", "whatever12345")).toBe(false);
    expect(await verifyPassword("", "whatever12345")).toBe(false);
  });

  it("returns false, without throwing, when the account does not exist", async () => {
    expect(await verifyPassword(null, "whatever12345")).toBe(false);
  });
});
