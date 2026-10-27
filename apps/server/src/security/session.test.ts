import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  createSession,
  destroySession,
  getSession,
  rotateSession,
  SESSION_IDLE_TTL_S,
  SESSION_MAX_AGE_S,
  type SessionStore,
} from "./session.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

function fakeStore() {
  const data = new Map<string, { value: string; ttl: number }>();
  const store = {
    set: vi.fn(async (key: string, value: string, _mode: "EX", seconds: number) => {
      data.set(key, { value, ttl: seconds });
      return "OK";
    }),
    get: vi.fn(async (key: string) => data.get(key)?.value ?? null),
    del: vi.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = data.get(key);
      if (!entry) return 0;
      entry.ttl = seconds;
      return 1;
    }),
  };
  return { store: store satisfies SessionStore, data };
}

describe("createSession", () => {
  it("makes unique 43 character URL-safe ids and stores only a hashed key", async () => {
    const { store, data } = fakeStore();
    const a = await createSession(store, "user-1", T0);
    const b = await createSession(store, "user-1", T0);
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.id).not.toBe(b.id);
    for (const key of data.keys()) {
      expect(key.startsWith("sess:")).toBe(true);
      expect(key).not.toContain(a.id);
      expect(key).not.toContain(b.id);
    }
  });

  it("stores the user and creation time with the idle timeout", async () => {
    const { store, data } = fakeStore();
    await createSession(store, "user-1", T0);
    const [entry] = [...data.values()];
    expect(JSON.parse(entry!.value)).toEqual({ userId: "user-1", createdAt: T0 });
    expect(entry!.ttl).toBe(SESSION_IDLE_TTL_S);
  });
});

describe("getSession", () => {
  it("returns the session for a valid id", async () => {
    const { store } = fakeStore();
    const { id } = await createSession(store, "user-1", T0);
    expect(await getSession(store, id, T0 + 1000)).toEqual({
      userId: "user-1",
      createdAt: T0,
    });
  });

  it("returns null for an unknown id", async () => {
    const { store } = fakeStore();
    expect(await getSession(store, "A".repeat(43), T0)).toBeNull();
  });

  it("returns null for malformed ids without touching the store", async () => {
    const { store } = fakeStore();
    for (const id of ["", "short", "A".repeat(42), "A".repeat(44), "!".repeat(43), "A".repeat(42) + "\n"]) {
      expect(await getSession(store, id, T0)).toBeNull();
    }
    expect(store.get).not.toHaveBeenCalled();
  });

  it("pushes the idle timeout back to 7 days on use", async () => {
    const { store, data } = fakeStore();
    const { id } = await createSession(store, "user-1", T0);
    await getSession(store, id, T0 + DAY_MS);
    expect([...data.values()][0]!.ttl).toBe(SESSION_IDLE_TTL_S);
  });

  it("never extends past the 30 day limit", async () => {
    const { store, data } = fakeStore();
    const { id } = await createSession(store, "user-1", T0);
    await getSession(store, id, T0 + 29 * DAY_MS);
    expect([...data.values()][0]!.ttl).toBe(SESSION_MAX_AGE_S - 29 * 24 * 60 * 60);
  });

  it("returns null and deletes the record once 30 days have passed", async () => {
    const { store, data } = fakeStore();
    const { id } = await createSession(store, "user-1", T0);
    expect(await getSession(store, id, T0 + 31 * DAY_MS)).toBeNull();
    expect(data.size).toBe(0);
  });

  it("returns null and deletes a corrupt record", async () => {
    const { store, data } = fakeStore();
    const { id } = await createSession(store, "user-1", T0);
    const key = [...data.keys()][0]!;
    data.set(key, { value: "{not json", ttl: 100 });
    expect(await getSession(store, id, T0)).toBeNull();
    expect(data.size).toBe(0);
  });
});

describe("destroySession and rotateSession", () => {
  it("destroySession makes the id stop working", async () => {
    const { store } = fakeStore();
    const { id } = await createSession(store, "user-1", T0);
    await destroySession(store, id);
    expect(await getSession(store, id, T0)).toBeNull();
  });

  it("rotateSession invalidates the old id and issues a working new one", async () => {
    const { store } = fakeStore();
    const old = await createSession(store, "user-1", T0);
    const fresh = await rotateSession(store, old.id, "user-1", T0 + 1000);
    expect(fresh.id).not.toBe(old.id);
    expect(await getSession(store, old.id, T0 + 2000)).toBeNull();
    expect((await getSession(store, fresh.id, T0 + 2000))?.userId).toBe("user-1");
  });

  it("rotateSession works when there was no old session", async () => {
    const { store } = fakeStore();
    const fresh = await rotateSession(store, undefined, "user-2", T0);
    expect((await getSession(store, fresh.id, T0))?.userId).toBe("user-2");
  });
});

describe("types", () => {
  it("an ioredis client satisfies SessionStore (compile-time check)", () => {
    const accepts = (redis: Redis): SessionStore => redis;
    expect(typeof accepts).toBe("function");
  });
});
