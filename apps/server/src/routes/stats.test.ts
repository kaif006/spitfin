import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "./auth.js";
import * as q from "../stats/queries.js";
import { registerStatsRoutes } from "./stats.js";

vi.mock("./auth.js", () => ({ authenticate: vi.fn() }));
vi.mock("../stats/queries.js", () => ({
  getUserStats: vi.fn(),
  getPlacements: vi.fn(),
  getForm: vi.fn(),
  listMatches: vi.fn(),
  getLeaderboard: vi.fn(),
}));

const signedIn = () =>
  vi.mocked(authenticate).mockResolvedValue({ sid: "s", user: { id: "u1" } as never });

function build(cacheGetFails = false) {
  const store = new Map<string, string>();
  const cache = {
    get: async (k: string) => {
      if (cacheGetFails) throw new Error("redis down");
      return store.get(k) ?? null;
    },
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
  };
  const app = Fastify();
  registerStatsRoutes(app, { auth: { db: {} as never, redis: {} as never, cookieSecure: false }, cache });
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("stats routes", () => {
  it("answers 401 to everyone who is not signed in", async () => {
    vi.mocked(authenticate).mockResolvedValue(null);
    const app = build();
    for (const url of ["/api/me/stats", "/api/me/matches", "/api/leaderboard"]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
    }
  });

  it("returns stats with derived ratios", async () => {
    signedIn();
    vi.mocked(q.getUserStats).mockResolvedValue({
      matches: 4, wins: 1, bugsEatenTotal: 40, shotsTotal: 20, hitsTotal: 10,
      nipsTotal: 0, stealsTotal: 0, stolenTotal: 2, currentStreak: 0, bestStreak: 1, rating: 1012,
    });
    vi.mocked(q.getPlacements).mockResolvedValue([1, 2, 1, 0]);
    vi.mocked(q.getForm).mockResolvedValue([]);
    const res = await build().inject({ url: "/api/me/stats" });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.derived).toEqual({ winRate: 0.25, avgBugsEaten: 10, spitAccuracy: 0.5, nipAccuracy: null });
    expect(body.placements).toEqual([1, 2, 1, 0]);
  });

  it("rejects a bad cursor and passes a good one on", async () => {
    signedIn();
    vi.mocked(q.listMatches).mockResolvedValue({ matches: [], nextCursor: null });
    const app = build();
    expect((await app.inject({ url: "/api/me/matches?cursor=abc" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/me/matches?cursor=12" })).statusCode).toBe(200);
    expect(q.listMatches).toHaveBeenCalledWith({}, "u1", "12", 20);
  });

  it("starts from the newest match when there is no cursor", async () => {
    signedIn();
    vi.mocked(q.listMatches).mockResolvedValue({ matches: [], nextCursor: null });
    await build().inject({ url: "/api/me/matches" });
    expect(q.listMatches).toHaveBeenCalledWith({}, "u1", null, 20);
  });

  it("ranks the leaderboard, marks you, hides ids and caches for later requests", async () => {
    signedIn();
    vi.mocked(q.getLeaderboard).mockResolvedValue([
      { userId: "u2", displayName: "Ann", rating: 1100, wins: 3, matches: 5 },
      { userId: "u1", displayName: "Me", rating: 1050, wins: 2, matches: 5 },
    ]);
    const app = build();
    const first = (await app.inject({ url: "/api/leaderboard" })).json();
    expect(first.leaderboard).toEqual([
      { rank: 1, displayName: "Ann", rating: 1100, wins: 3, matches: 5, isYou: false },
      { rank: 2, displayName: "Me", rating: 1050, wins: 2, matches: 5, isYou: true },
    ]);
    await app.inject({ url: "/api/leaderboard" });
    expect(q.getLeaderboard).toHaveBeenCalledTimes(1);
  });

  it("still answers when the cache is down", async () => {
    signedIn();
    vi.mocked(q.getLeaderboard).mockResolvedValue([]);
    const res = await build(true).inject({ url: "/api/leaderboard" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ leaderboard: [] });
  });
});
