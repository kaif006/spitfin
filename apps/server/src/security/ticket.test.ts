import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { consumeTicket, issueTicket, TICKET_TTL_S, type TicketStore } from "./ticket.js";

function fakeStore() {
  const data = new Map<string, { value: string; ttl: number }>();
  const store = {
    set: vi.fn(async (key: string, value: string, _mode: "EX", seconds: number) => {
      data.set(key, { value, ttl: seconds });
      return "OK";
    }),
    getdel: vi.fn(async (key: string) => {
      const value = data.get(key)?.value ?? null;
      data.delete(key);
      return value;
    }),
  };
  return { store: store satisfies TicketStore, data };
}

describe("tickets", () => {
  it("issues unique 43 character ids, stored hashed for 30 seconds", async () => {
    const { store, data } = fakeStore();
    const a = await issueTicket(store, "user-1");
    const b = await issueTicket(store, "user-1");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    for (const [key, entry] of data) {
      expect(key.startsWith("wst:")).toBe(true);
      expect(key).not.toContain(a);
      expect(entry.ttl).toBe(TICKET_TTL_S);
    }
  });

  it("works exactly once", async () => {
    const { store } = fakeStore();
    const t = await issueTicket(store, "user-1");
    expect(await consumeTicket(store, t)).toBe("user-1");
    expect(await consumeTicket(store, t)).toBeNull();
  });

  it("rejects malformed tickets without touching the store", async () => {
    const { store } = fakeStore();
    for (const t of ["", "short", "A".repeat(44), "!".repeat(43)]) {
      expect(await consumeTicket(store, t)).toBeNull();
    }
    expect(store.getdel).not.toHaveBeenCalled();
  });

  it("an ioredis client satisfies TicketStore (compile-time check)", () => {
    const accepts = (redis: Redis): TicketStore => redis;
    expect(typeof accepts).toBe("function");
  });
});
