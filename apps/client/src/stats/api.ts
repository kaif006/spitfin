import type { FetchLike } from "../auth/api";

export type UserStats = {
  matches: number;
  wins: number;
  bugsEatenTotal: number;
  shotsTotal: number;
  hitsTotal: number;
  nipsTotal: number;
  stealsTotal: number;
  stolenTotal: number;
  currentStreak: number;
  bestStreak: number;
  rating: number;
};
export type Derived = {
  winRate: number | null;
  avgBugsEaten: number | null;
  spitAccuracy: number | null;
  nipAccuracy: number | null;
};
export type FormPoint = { matchId: string; finalStash: number; placement: number; ratingDelta: number };
export type StatsResponse = { stats: UserStats; derived: Derived; placements: number[]; form: FormPoint[] };
export type MatchRow = {
  matchId: string;
  startedAt: string;
  playerCount: number;
  placement: number;
  finalStash: number;
  bugsEaten: number;
  shots: number;
  hits: number;
  nips: number;
  stealsMade: number;
  stolenFrom: number;
  ratingDelta: number;
};
export type MatchesPage = { matches: MatchRow[]; nextCursor: string | null };
export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  rating: number;
  wins: number;
  matches: number;
  isYou: boolean;
};

export type StatsFailure = { kind: "unauthenticated" } | { kind: "network" } | { kind: "server"; status: number };
export type StatsResult<T> = { ok: true; value: T } | { ok: false; failure: StatsFailure };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown): boolean => v === null || isNum(v);
const hasNums = (o: Record<string, unknown>, keys: readonly string[]): boolean => keys.every((k) => isNum(o[k]));

const STAT_KEYS = [
  "matches", "wins", "bugsEatenTotal", "shotsTotal", "hitsTotal", "nipsTotal",
  "stealsTotal", "stolenTotal", "currentStreak", "bestStreak", "rating",
] as const;
const DERIVED_KEYS = ["winRate", "avgBugsEaten", "spitAccuracy", "nipAccuracy"] as const;
const MATCH_NUM_KEYS = [
  "playerCount", "placement", "finalStash", "bugsEaten", "shots", "hits", "nips",
  "stealsMade", "stolenFrom", "ratingDelta",
] as const;

function parseStats(body: unknown): StatsResponse | null {
  if (!isRec(body) || !isRec(body.stats) || !isRec(body.derived)) return null;
  if (!hasNums(body.stats, STAT_KEYS)) return null;
  if (!DERIVED_KEYS.every((k) => isNumOrNull((body.derived as Record<string, unknown>)[k]))) return null;
  const p = body.placements;
  if (!Array.isArray(p) || p.length !== 4 || !p.every(isNum)) return null;
  const f = body.form;
  if (
    !Array.isArray(f) ||
    !f.every(
      (x) =>
        isRec(x) && typeof x.matchId === "string" && hasNums(x, ["finalStash", "placement", "ratingDelta"]),
    )
  ) {
    return null;
  }
  return body as StatsResponse;
}

function parseMatches(body: unknown): MatchesPage | null {
  if (!isRec(body) || !Array.isArray(body.matches)) return null;
  if (!(body.nextCursor === null || typeof body.nextCursor === "string")) return null;
  const ok = body.matches.every(
    (m) =>
      isRec(m) && typeof m.matchId === "string" && typeof m.startedAt === "string" && hasNums(m, MATCH_NUM_KEYS),
  );
  return ok ? (body as MatchesPage) : null;
}

function parseLeaderboard(body: unknown): LeaderboardEntry[] | null {
  if (!isRec(body) || !Array.isArray(body.leaderboard)) return null;
  const ok = body.leaderboard.every(
    (r) =>
      isRec(r) &&
      typeof r.displayName === "string" &&
      typeof r.isYou === "boolean" &&
      hasNums(r, ["rank", "rating", "wins", "matches"]),
  );
  return ok ? (body.leaderboard as LeaderboardEntry[]) : null;
}

export function createStatsApi(fetchFn?: FetchLike) {
  const doFetch: FetchLike = fetchFn ?? ((input, init) => fetch(input, init));

  async function get<T>(path: string, parse: (b: unknown) => T | null): Promise<StatsResult<T>> {
    let res: Response;
    try {
      res = await doFetch(path, { method: "GET" });
    } catch {
      return { ok: false, failure: { kind: "network" } };
    }
    if (res.status === 401) return { ok: false, failure: { kind: "unauthenticated" } };
    if (!res.ok) return { ok: false, failure: { kind: "server", status: res.status } };
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // handled below as a bad body
    }
    const value = parse(body);
    return value === null
      ? { ok: false, failure: { kind: "server", status: res.status } }
      : { ok: true, value };
  }

  return {
    stats: () => get("/api/me/stats", parseStats),
    matches: (cursor?: string | null) =>
      get(
        cursor ? `/api/me/matches?cursor=${encodeURIComponent(cursor)}` : "/api/me/matches",
        parseMatches,
      ),
    leaderboard: () => get("/api/leaderboard", parseLeaderboard),
  };
}

export const statsApi = createStatsApi();
