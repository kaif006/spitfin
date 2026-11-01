import { TICK_HZ, simRanking } from "@spitfin/shared";
import type { SimState } from "@spitfin/shared";
import type { MatchRecord } from "./save.js";

/** Builds the record to save from a finished sim. `userIds[i]` is the user of sim player `i`. */
export function buildMatchRecord(sim: SimState, seed: number, userIds: readonly string[], startedAt: Date): MatchRecord {
  const rank = new Map(simRanking(sim).map((r) => [r.id, r.rank]));
  return {
    seed,
    startedAt,
    durationS: Math.round(sim.tick / TICK_HZ),
    players: sim.players.map((p) => ({
      userId: userIds[p.id]!,
      bugsEaten: p.bugsEaten,
      finalStash: p.stash,
      shots: p.shots,
      hits: p.hits,
      nips: p.nipsUsed,
      stealsMade: p.steals,
      stolenFrom: p.timesNipped,
      placement: rank.get(p.id) ?? sim.players.length,
    })),
  };
}
