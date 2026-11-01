import { RATING_START, ratingDeltas } from "./rating.js";

export interface MatchPlayerRecord {
  userId: string;
  bugsEaten: number;
  finalStash: number;
  shots: number;
  hits: number;
  nips: number;
  stealsMade: number;
  stolenFrom: number;
  placement: number;
}

export interface MatchRecord {
  seed: number;
  startedAt: Date;
  durationS: number;
  players: MatchPlayerRecord[];
}

export interface StatsClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: { [k: string]: unknown }[] }>;
  release(): void;
}
/** A pg Pool fits this. */
export interface StatsDb {
  connect(): Promise<StatsClient>;
}

/** Saves one finished match and updates every player's aggregates, in one transaction. Returns the match id. */
export async function saveMatch(db: StatsDb, rec: MatchRecord): Promise<string> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const m = await client.query(
      "INSERT INTO matches (seed, started_at, duration_s, player_count) VALUES ($1, $2, $3, $4) RETURNING id",
      [rec.seed, rec.startedAt, rec.durationS, rec.players.length],
    );
    const matchId = String(m.rows[0]!.id);

    // Lock rows in a fixed order so two matches ending together cannot deadlock.
    const ids = rec.players.map((p) => p.userId).sort();
    for (const id of ids) {
      await client.query("INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    }
    const cur = await client.query(
      "SELECT user_id, rating, current_streak, best_streak FROM user_stats WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE",
      [ids],
    );
    const before = new Map(cur.rows.map((r) => [String(r.user_id), r]));
    const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

    const deltas = ratingDeltas(
      rec.players.map((p) => ({ rating: num(before.get(p.userId)?.rating, RATING_START), rank: p.placement })),
    );

    for (let i = 0; i < rec.players.length; i++) {
      const p = rec.players[i]!;
      const delta = deltas[i]!;
      const row = before.get(p.userId);
      const won = p.placement === 1;
      const streak = won ? num(row?.current_streak, 0) + 1 : 0;
      const best = Math.max(num(row?.best_streak, 0), streak);

      await client.query(
        `INSERT INTO match_players
           (match_id, user_id, bugs_eaten, final_stash, shots, hits, nips, steals_made, stolen_from, placement, rating_delta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [matchId, p.userId, p.bugsEaten, p.finalStash, p.shots, p.hits, p.nips, p.stealsMade, p.stolenFrom, p.placement, delta],
      );
      await client.query(
        `UPDATE user_stats SET
           matches = matches + 1,
           wins = wins + $2,
           bugs_eaten_total = bugs_eaten_total + $3,
           shots_total = shots_total + $4,
           hits_total = hits_total + $5,
           nips_total = nips_total + $6,
           steals_total = steals_total + $7,
           stolen_total = stolen_total + $8,
           current_streak = $9,
           best_streak = $10,
           rating = rating + $11
         WHERE user_id = $1`,
        [p.userId, won ? 1 : 0, p.bugsEaten, p.shots, p.hits, p.nips, p.stealsMade, p.stolenFrom, streak, best, delta],
      );
    }
    await client.query("COMMIT");
    return matchId;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the original error matters more
    }
    throw err;
  } finally {
    client.release();
  }
}
