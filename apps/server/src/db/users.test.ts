import { describe, expect, it, vi } from "vitest";
import {
  createGuest,
  createUser,
  EmailTakenError,
  findUserByEmail,
  findUserById,
  type Db,
  type User,
} from "./users.js";

const USER: User = {
  id: "0b7b5a1e-5d5e-4c1c-9f55-1d6a0c9e1a11",
  email: "ada@example.com",
  displayName: "Ada",
  isGuest: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function fakeDb(impl: (text: string, params?: unknown[]) => unknown) {
  const query = vi.fn(async (text: string, params?: unknown[]) => impl(text, params));
  return { db: { query } as unknown as Db, query };
}

describe("users queries", () => {
  it("createUser lowercases the email and returns the new row", async () => {
    const { db, query } = fakeDb(() => ({ rows: [USER] }));
    const user = await createUser(db, {
      email: "  Ada@Example.COM ",
      pwHash: "hash",
      displayName: "Ada",
    });
    expect(user).toEqual(USER);
    expect(query.mock.calls[0]![1]).toEqual(["ada@example.com", "hash", "Ada"]);
  });

  it("createUser throws EmailTakenError on a unique violation of the email index", async () => {
    const { db } = fakeDb(() => {
      throw Object.assign(new Error("dup"), {
        code: "23505",
        constraint: "users_email_lower_idx",
      });
    });
    await expect(
      createUser(db, { email: "a@b.co", pwHash: "h", displayName: "Ada" }),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("createUser rethrows other database errors unchanged", async () => {
    const { db } = fakeDb(() => {
      throw new Error("connection lost");
    });
    await expect(
      createUser(db, { email: "a@b.co", pwHash: "h", displayName: "Ada" }),
    ).rejects.toThrow("connection lost");
  });

  it("createGuest inserts a guest with only a display name", async () => {
    const guest = { ...USER, email: null, isGuest: true, displayName: "Guest-1234" };
    const { db, query } = fakeDb(() => ({ rows: [guest] }));
    const user = await createGuest(db, "Guest-1234");
    expect(user.isGuest).toBe(true);
    expect(query.mock.calls[0]![0]).toContain("TRUE");
    expect(query.mock.calls[0]![1]).toEqual(["Guest-1234"]);
  });

  it("findUserByEmail normalizes the email and returns the row with its hash", async () => {
    const { db, query } = fakeDb(() => ({ rows: [{ ...USER, pwHash: "hash" }] }));
    const user = await findUserByEmail(db, "ADA@example.com");
    expect(user?.pwHash).toBe("hash");
    expect(query.mock.calls[0]![1]).toEqual(["ada@example.com"]);
  });

  it("findUserByEmail returns null when nobody matches", async () => {
    const { db } = fakeDb(() => ({ rows: [] }));
    expect(await findUserByEmail(db, "nobody@example.com")).toBeNull();
  });

  it("findUserById returns null for a malformed id without querying", async () => {
    const { db, query } = fakeDb(() => ({ rows: [USER] }));
    expect(await findUserById(db, "not-a-uuid")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
