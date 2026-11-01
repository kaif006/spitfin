export const RATING_START = 1000;
export const RATING_K = 24;

export interface RatedPlayer {
  rating: number;
  rank: number; // 1 = best; equal ranks are ties
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

/**
 * Pairwise multiplayer Elo. Each pair is scored 1 / 0.5 / 0 by rank, and the
 * summed (score - expected) is scaled by K / (n - 1) so a match never moves a
 * rating by more than K. Returns integer deltas in the same order as `players`.
 */
export function ratingDeltas(players: readonly RatedPlayer[]): number[] {
  const n = players.length;
  if (n < 2) return players.map(() => 0);
  const scale = RATING_K / (n - 1);
  return players.map((p, i) => {
    const ri = Number.isFinite(p.rating) ? p.rating : RATING_START;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const q = players[j]!;
      const rj = Number.isFinite(q.rating) ? q.rating : RATING_START;
      const score = p.rank < q.rank ? 1 : p.rank === q.rank ? 0.5 : 0;
      sum += score - expectedScore(ri, rj);
    }
    return Math.round(scale * sum) + 0; // + 0 turns -0 into 0
  });
}
