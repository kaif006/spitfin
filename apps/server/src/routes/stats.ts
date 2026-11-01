import type { FastifyInstance } from "fastify";
import { authenticate, type AuthDeps } from "./auth.js";
import {
  getForm,
  getLeaderboard,
  getPlacements,
  getUserStats,
  listMatches,
  type LeaderboardRow,
  type UserStats,
} from "../stats/queries.js";

/** The small part of Redis the leaderboard cache needs. An ioredis client fits. */
export type CacheStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
};

export type StatsDeps = { auth: AuthDeps; cache: CacheStore };

export const LEADERBOARD_SIZE = 50;
export const LEADERBOARD_TTL_S = 60;
export const MATCHES_PAGE_SIZE = 20;
const LEADERBOARD_KEY = "stats:leaderboard:v1";
const CURSOR_RE = /^\d{1,18}$/;

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

function derive(s: UserStats) {
  return {
    winRate: ratio(s.wins, s.matches),
    avgBugsEaten: ratio(s.bugsEatenTotal, s.matches),
    spitAccuracy: ratio(s.hitsTotal, s.shotsTotal),
    nipAccuracy: ratio(s.stealsTotal, s.nipsTotal), // a landed nip is a steal
  };
}

async function cachedLeaderboard(deps: StatsDeps): Promise<LeaderboardRow[]> {
  try {
    const hit = await deps.cache.get(LEADERBOARD_KEY);
    if (hit !== null) {
      const parsed: unknown = JSON.parse(hit);
      if (Array.isArray(parsed)) return parsed as LeaderboardRow[];
    }
  } catch {
    // a broken cache must never break the page
  }
  const rows = await getLeaderboard(deps.auth.db, LEADERBOARD_SIZE);
  try {
    await deps.cache.set(LEADERBOARD_KEY, JSON.stringify(rows), "EX", LEADERBOARD_TTL_S);
  } catch {
    // ignore
  }
  return rows;
}

export function registerStatsRoutes(app: FastifyInstance, deps: StatsDeps): void {
  void app.register(
    async (api) => {
      api.addHook("onRequest", (_req, reply, done) => {
        reply.header("Cache-Control", "no-store");
        done();
      });

      api.get("/me/stats", async (req, reply) => {
        const a = await authenticate(deps.auth, req);
        if (a === null) return reply.code(401).send({ error: "unauthenticated" });
        const id = a.user.id;
        const [stats, placements, form] = await Promise.all([
          getUserStats(deps.auth.db, id),
          getPlacements(deps.auth.db, id),
          getForm(deps.auth.db, id),
        ]);
        return { stats, derived: derive(stats), placements, form };
      });

      api.get("/me/matches", async (req, reply) => {
        const a = await authenticate(deps.auth, req);
        if (a === null) return reply.code(401).send({ error: "unauthenticated" });
        const raw = (req.query as { cursor?: unknown }).cursor;
        let cursor: string | null = null;
        if (raw !== undefined) {
          if (typeof raw !== "string" || !CURSOR_RE.test(raw)) {
            return reply.code(400).send({ error: "invalid_cursor" });
          }
          cursor = raw;
        }
        return listMatches(deps.auth.db, a.user.id, cursor, MATCHES_PAGE_SIZE);
      });

      api.get("/leaderboard", async (req, reply) => {
        const a = await authenticate(deps.auth, req);
        if (a === null) return reply.code(401).send({ error: "unauthenticated" });
        const rows = await cachedLeaderboard(deps);
        return {
          leaderboard: rows.map((r, i) => ({
            rank: i + 1,
            displayName: r.displayName,
            rating: r.rating,
            wins: r.wins,
            matches: r.matches,
            isYou: r.userId === a.user.id,
          })),
        };
      });
    },
    { prefix: "/api" },
  );
}
