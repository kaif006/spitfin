import { MOUTH_RADIUS } from "./constants";
import type { Vec3 } from "./bugs";
import type { FallingBug } from "./falling";
import { fallingBugPhase, fallingBugPosition } from "./falling";

export const NOT_EATEN = -1;

/** A fish as seen by the eating rules. `stash` and `bugsEaten` are updated in place. */
export interface Eater {
  id: number;
  x: number;
  z: number;
  stash: number;
  bugsEaten: number;
}

/** A bug that has been shot. `eatenBy` is the winning player's id, or NOT_EATEN. */
export interface ShotBug {
  fall: FallingBug;
  eatenBy: number;
}

export interface EatEvent {
  bugId: number;
  playerId: number;
}

export const newShotBug = (fall: FallingBug): ShotBug => ({ fall, eatenBy: NOT_EATEN });

const pos: Vec3 = { x: 0, y: 0, z: 0 };
const RADIUS_SQ = MOUTH_RADIUS * MOUTH_RADIUS;

/**
 * Who gets a bug at (bx, bz)? Only fish within MOUTH_RADIUS count.
 * Closest wins; an exact distance tie goes to the lower id. Array order never matters.
 */
export function pickEater(bx: number, bz: number, fish: readonly Eater[]): Eater | null {
  let best: Eater | null = null;
  let bestD2 = Infinity;
  for (let i = 0; i < fish.length; i++) {
    const f = fish[i];
    const dx = f.x - bx;
    const dz = f.z - bz;
    const d2 = dx * dx + dz * dz;
    if (d2 > RADIUS_SQ) continue;
    if (best === null || d2 < bestD2 || (d2 === bestD2 && f.id < best.id)) {
      best = f;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * Run the eating rules for match time `t`. Call once per sim tick.
 * Returns how many bugs were eaten this tick. If `events` is given, one entry per eaten bug is pushed to it
 * (the caller owns the array and clears it between ticks).
 */
export function resolveEating(
  shot: ShotBug[],
  fish: readonly Eater[],
  t: number,
  events?: EatEvent[],
): number {
  let eaten = 0;
  for (let i = 0; i < shot.length; i++) {
    const s = shot[i];
    if (s.eatenBy !== NOT_EATEN) continue;
    if (fallingBugPhase(s.fall, t) !== "floating") continue;
    fallingBugPosition(s.fall, t, pos);
    const winner = pickEater(pos.x, pos.z, fish);
    if (winner === null) continue;
    s.eatenBy = winner.id;
    winner.stash += 1;
    winner.bugsEaten += 1;
    eaten += 1;
    if (events) events.push({ bugId: s.fall.bugId, playerId: winner.id });
  }
  return eaten;
}
