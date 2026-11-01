import { describe, expect, it } from "vitest";
import { saveMatch } from "./save.js";
import type { MatchPlayerRecord, MatchRecord, StatsDb } from "./save.js";

function fakeDb(opts: { stats?: Record<string, unknown>[]; failOn?: string } = {}) {
  const log: { sql: string; params?: unknown[] }[] = [];
  let released = 0;
  const db: StatsDb = {
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        log.push({ sql, params });
        if (opts.failOn !== undefined && sql.includes(opts.failOn)) throw new Error("boom");
        if (sql.includes("INSERT INTO matches")) return { rows: [{ id: "42" }] };
        if (sql.includes("FOR UPDATE")) return { rows: opts.stats ?? [] };
        return { rows: [] };
      },
      release: () => {
        released++;
      },
    }),
  };
  return { db, log, released: () => released };
}

const pl = (userId: string, placement: number, extra: Partial<MatchPlayerRecord> = {}): MatchPlayerRecord => ({
  userId,
  bugsEaten: 5,
  finalStash: 4,
  shots: 10,
  hits: 6,
  nips: 2,
  stealsMade: 1,
  stolenFrom: 0,
  placement,
  ...extra,
});

const rec = (players: MatchPlayerRecord[]): MatchRecord => ({
  seed: 7,
  startedAt: new Date(0),
  durationS: 150,
  players,
});

describe("saveMatch", () => {
  it("wraps everything in one transaction and returns the match id", async () => {
    const f = fakeDb();
    expect(await saveMatch(f.db, rec([pl("a", 1), pl("b", 2)]))).toBe("42");
    expect(f.log[0]!.sql).toBe("BEGIN");
    expect(f.log.at(-1)!.sql).toBe("COMMIT");
    expect(f.released()).toBe(1);
  });

  it("applies rating deltas and win streaks", async () => {
    const f = fakeDb({
      stats: [
        { user_id: "a", rating: 1000, current_streak: 2, best_streak: 2 },
        { user_id: "b", rating: 1000, current_streak: 1, best_streak: 4 },
      ],
    });
    await saveMatch(f.db, rec([pl("a", 1), pl("b", 2)]));
    const inserts = f.log.filter((q) => q.sql.includes("INSERT INTO match_players"));
    expect(inserts.map((q) => q.params![10])).toEqual([12, -12]);
    const updates = f.log.filter((q) => q.sql.startsWith("UPDATE user_stats"));
    // [userId, win, eaten, shots, hits, nips, steals, stolen, streak, best, delta]
    expect(updates[0]!.params![0]).toBe("a");
    expect(updates[0]!.params!.slice(1, 2)).toEqual([1]);
    expect(updates[0]!.params!.slice(8)).toEqual([3, 3, 12]);
    expect(updates[1]!.params!.slice(8)).toEqual([0, 4, -12]);
  });

  it("treats a missing stats row as rating 1000 and streak 0", async () => {
    const f = fakeDb();
    await saveMatch(f.db, rec([pl("a", 1), pl("b", 2)]));
    const updates = f.log.filter((q) => q.sql.startsWith("UPDATE user_stats"));
    expect(updates[0]!.params!.slice(8)).toEqual([1, 1, 12]);
  });

  it("rolls back, never commits and releases the client when a query fails", async () => {
    const f = fakeDb({ failOn: "INSERT INTO match_players" });
    await expect(saveMatch(f.db, rec([pl("a", 1), pl("b", 2)]))).rejects.toThrow("boom");
    expect(f.log.some((q) => q.sql === "COMMIT")).toBe(false);
    expect(f.log.at(-1)!.sql).toBe("ROLLBACK");
    expect(f.released()).toBe(1);
  });
});
