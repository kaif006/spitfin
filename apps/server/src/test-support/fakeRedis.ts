export type Clock = { now: number };

type Entry = { value: string; expiresAt: number | null };

/** An in-memory stand-in for the Redis commands the server uses. Time only moves when a test moves `clock.now`. */
export function fakeRedis(clock: Clock = { now: 0 }) {
  const data = new Map<string, Entry>();

  // Returns the entry unless it has expired (expired entries are removed).
  const live = (key: string): Entry | undefined => {
    const e = data.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= clock.now) {
      data.delete(key);
      return undefined;
    }
    return e;
  };

  return {
    clock,
    data,
    set: async (key: string, value: string, mode: "EX" | "PX", n: number) => {
      data.set(key, { value, expiresAt: clock.now + (mode === "EX" ? n * 1000 : n) });
      return "OK";
    },
    get: async (key: string) => live(key)?.value ?? null,
    del: async (key: string) => {
      const existed = live(key) !== undefined;
      data.delete(key);
      return existed ? 1 : 0;
    },
    getdel: async (key: string) => {
      const value = live(key)?.value ?? null;
      data.delete(key);
      return value;
    },
    expire: async (key: string, seconds: number) => {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = clock.now + seconds * 1000;
      return 1;
    },
    pexpire: async (key: string, ms: number) => {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = clock.now + ms;
      return 1;
    },
    incr: async (key: string) => {
      const e = live(key);
      const n = (e ? Number(e.value) : 0) + 1;
      data.set(key, { value: String(n), expiresAt: e ? e.expiresAt : null });
      return n;
    },
    pttl: async (key: string) => {
      const e = live(key);
      if (!e) return -2;
      if (e.expiresAt === null) return -1;
      return e.expiresAt - clock.now;
    },
  };
}
