import { describe, expect, it } from "vitest";
import { createStatsApi } from "./api";

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

const STATS = {
  matches: 2, wins: 1, bugsEatenTotal: 20, shotsTotal: 30, hitsTotal: 20, nipsTotal: 3,
  stealsTotal: 1, stolenTotal: 0, currentStreak: 1, bestStreak: 1, rating: 1012,
};
const OK_STATS = {
  stats: STATS,
  derived: { winRate: 0.5, avgBugsEaten: 10, spitAccuracy: 0.6667, nipAccuracy: null },
  placements: [1, 1, 0, 0],
  form: [{ matchId: "2", finalStash: 14, placement: 1, ratingDelta: 12 }],
};

describe("stats api", () => {
  it("parses a valid stats response", async () => {
    expect(await createStatsApi(json(OK_STATS)).stats()).toEqual({ ok: true, value: OK_STATS });
  });

  it("reports 401 as unauthenticated", async () => {
    const r = await createStatsApi(json({ error: "unauthenticated" }, 401)).stats();
    expect(r).toEqual({ ok: false, failure: { kind: "unauthenticated" } });
  });

  it("reports a thrown fetch as a network failure", async () => {
    const r = await createStatsApi(async () => {
      throw new Error("offline");
    }).stats();
    expect(r).toEqual({ ok: false, failure: { kind: "network" } });
  });

  it("rejects a body with a wrong field type", async () => {
    const bad = { ...OK_STATS, stats: { ...STATS, rating: "high" } };
    const r = await createStatsApi(json(bad)).stats();
    expect(r).toEqual({ ok: false, failure: { kind: "server", status: 200 } });
  });

  it("sends the cursor for the next page of matches", async () => {
    let seen = "";
    const api = createStatsApi(async (url) => {
      seen = url;
      return new Response(JSON.stringify({ matches: [], nextCursor: null }));
    });
    expect((await api.matches("12")).ok).toBe(true);
    expect(seen).toBe("/api/me/matches?cursor=12");
    await api.matches(null);
    expect(seen).toBe("/api/me/matches");
  });

  it("accepts a valid leaderboard and rejects a row without isYou", async () => {
    const row = { rank: 1, displayName: "Ann", rating: 1100, wins: 3, matches: 5, isYou: false };
    expect((await createStatsApi(json({ leaderboard: [row] })).leaderboard()).ok).toBe(true);
    const { isYou: _omit, ...broken } = row;
    const r = await createStatsApi(json({ leaderboard: [broken] })).leaderboard();
    expect(r).toEqual({ ok: false, failure: { kind: "server", status: 200 } });
  });
});
