import type { Db } from "../db/users.js";
import { RATING_START } from "./rating.js";

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

export const EMPTY_STATS: UserStats = {
  matches: 0,
  wins: 0,
  bugsEatenTotal: 0,
  shotsTotal: 0,
  hitsTotal: 0,
  nipsTotal: 0,
  stealsTotal: 0,
  stolenTotal: 0,
  currentStreak: 0,
  bestStreak: 0,
  rating: RATING_START,
};

type StatsRow = {
  matches: number;
  wins: number;
  bugs_eaten_total: number;
  shots_total: number;
  hits_total: number;
  nips_total: number;
  steals_total: number;
  stolen_total: number;
  current_streak: number;
  best_streak: number;
  rating: number;
};

export async function getUserStats(db: Db, userId: string): Promise<UserStats> {
  const res = await db.query<StatsRow>(
    `SELECT matches, wins, bugs_eaten_total, shots_total, hits_total, nips_total,
            steals_total, stolen_total, current_streak, best_streak, rating
     FROM user_stats WHERE user_id = $1`,
    [userId],
  );
  const r = res.rows[0];
  if (r === undefined) return { ...EMPTY_STATS };
  return {
    matches: r.matches,
    wins: r.wins,
    bugsEatenTotal: r.bugs_eaten_total,
    shotsTotal: r.shots_total,
    hitsTotal: r.hits_total,
    nipsTotal: r.nips_total,
    stealsTotal: r.steals_total,
    stolenTotal: r.stolen_total,
    currentStreak: r.current_streak,
    bestStreak: r.best_streak,
    rating: r.rating,
  };
}

/** How many times the user finished 1st, 2nd, 3rd and 4th (index 0 is 1st). */
export async function getPlacements(db: Db, userId: string): Promise<number[]> {
  const res = await db.query<{ placement: number; n: number }>(
    "SELECT placement, count(*)::int AS n FROM match_players WHERE user_id = $1 GROUP BY placement",
    [userId],
  );
  const counts = [0, 0, 0, 0];
  for (const r of res.rows) {
    if (r.placement >= 1 && r.placement <= 4) counts[r.placement - 1] = r.n;
  }
  return counts;
}

export type FormPoint = { matchId: string; finalStash: number; placement: number; ratingDelta: number };

/** The user's last `limit` matches, oldest first (for a chart). */
export async function getForm(db: Db, userId: string, limit = 30): Promise<FormPoint[]> {
  const res = await db.query<{ match_id: string; final_stash: number; placement: number; rating_delta: number }>(
    `SELECT match_id::text AS match_id, final_stash, placement, rating_delta
     FROM match_players WHERE user_id = $1 ORDER BY match_id DESC LIMIT $2`,
    [userId, limit],
  );
  return res.rows
    .map((r) => ({ matchId: r.match_id, finalStash: r.final_stash, placement: r.placement, ratingDelta: r.rating_delta }))
    .reverse();
}

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

type MatchDbRow = {
  match_id: string;
  started_at: Date;
  player_count: number;
  placement: number;
  final_stash: number;
  bugs_eaten: number;
  shots: number;
  hits: number;
  nips: number;
  steals_made: number;
  stolen_from: number;
  rating_delta: number;
};

/** One page of the user's matches, newest first. `cursor` is the last match id of the previous page. */
export async function listMatches(
  db: Db,
  userId: string,
  cursor: string | null,
  limit: number,
): Promise<{ matches: MatchRow[]; nextCursor: string | null }> {
  const res = await db.query<MatchDbRow>(
    `SELECT mp.match_id::text AS match_id, m.started_at, m.player_count, mp.placement, mp.final_stash,
            mp.bugs_eaten, mp.shots, mp.hits, mp.nips, mp.steals_made, mp.stolen_from, mp.rating_delta
     FROM match_players mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.user_id = $1 AND ($2::bigint IS NULL OR mp.match_id < $2::bigint)
     ORDER BY mp.match_id DESC LIMIT $3`,
    [userId, cursor, limit + 1],
  );
  const more = res.rows.length > limit;
  const rows = more ? res.rows.slice(0, limit) : res.rows;
  const matches = rows.map((r) => ({
    matchId: r.match_id,
    startedAt: r.started_at.toISOString(),
    playerCount: r.player_count,
    placement: r.placement,
    finalStash: r.final_stash,
    bugsEaten: r.bugs_eaten,
    shots: r.shots,
    hits: r.hits,
    nips: r.nips,
    stealsMade: r.steals_made,
    stolenFrom: r.stolen_from,
    ratingDelta: r.rating_delta,
  }));
  return { matches, nextCursor: more ? (matches.at(-1)?.matchId ?? null) : null };
}

export type LeaderboardRow = { userId: string; displayName: string; rating: number; wins: number; matches: number };

/** Top players by rating. Guests and players with no matches are left out. */
export async function getLeaderboard(db: Db, limit: number): Promise<LeaderboardRow[]> {
  const res = await db.query<{ id: string; display_name: string; rating: number; wins: number; matches: number }>(
    `SELECT u.id, u.display_name, s.rating, s.wins, s.matches
     FROM user_stats s JOIN users u ON u.id = s.user_id
     WHERE NOT u.is_guest AND s.matches > 0
     ORDER BY s.rating DESC, s.wins DESC, s.matches DESC, u.id
     LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    userId: r.id,
    displayName: r.display_name,
    rating: r.rating,
    wins: r.wins,
    matches: r.matches,
  }));
}
