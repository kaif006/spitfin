import { NIP_CONE_DEG, NIP_COOLDOWN, NIP_DURATION, NIP_IMMUNITY, NIP_RANGE } from "./constants";
import type { Eater } from "./eating";

export const NO_VICTIM = -1;

/** A fish as seen by the nip rules. Extends Eater, so it also works with the eating rules. */
export interface Nipper extends Eater {
  facing: number; // yaw in radians, atan2(dz, dx). The nip dashes this way.
  nipReadyTime: number; // may nip again at or after this time
  nipEndTime: number; // the dash lasts until this time
  immuneUntil: number; // cannot be nipped before this time
  lastVictimId: number; // NO_VICTIM until the first successful nip
  nipsUsed: number; // every nip fired, hit or miss (a tie-break at the end of the match)
  steals: number; // nips that took a bug
  timesNipped: number; // how often this fish was nipped
}

export const newNipper = (id: number, x = 0, z = 0, facing = 0): Nipper => ({
  id,
  x,
  z,
  stash: 0,
  bugsEaten: 0,
  facing,
  nipReadyTime: 0,
  nipEndTime: 0,
  immuneUntil: 0,
  lastVictimId: NO_VICTIM,
  nipsUsed: 0,
  steals: 0,
  timesNipped: 0,
});

export interface NipResult {
  fired: boolean; // false while on cooldown (or if the facing is invalid)
  victimId: number; // NO_VICTIM when the nip missed
  stolen: number; // 1 on a hit, otherwise 0
}

const RANGE_SQ = NIP_RANGE * NIP_RANGE;
const COS_HALF_CONE = Math.cos(((NIP_CONE_DEG / 2) * Math.PI) / 180); // NIP_CONE_DEG is the full width
const FACING_MIN_INPUT = 0.1; // smaller stick input does not turn the fish

export const isImmune = (n: Nipper, t: number): boolean => t < n.immuneUntil;
export const isDashing = (n: Nipper, t: number): boolean => t < n.nipEndTime;

/** Turn the fish toward its movement input. Tiny or invalid input leaves the facing alone. */
export function updateFacing(n: Nipper, ax: number, az: number): void {
  const len = Math.hypot(ax, az);
  if (!Number.isFinite(len) || len < FACING_MIN_INPUT) return;
  n.facing = Math.atan2(az, ax);
}

/**
 * Try to nip at match time `t`. `others` may include the thief (it is skipped by id).
 * Mutates the thief (cooldown, counters) and, on a hit, the victim (stash, immunity).
 */
export function tryNip(thief: Nipper, others: readonly Nipper[], t: number): NipResult {
  if (!Number.isFinite(thief.facing)) return { fired: false, victimId: NO_VICTIM, stolen: 0 };
  if (t < thief.nipReadyTime) return { fired: false, victimId: NO_VICTIM, stolen: 0 };

  thief.nipReadyTime = t + NIP_COOLDOWN;
  thief.nipEndTime = t + NIP_DURATION;
  thief.nipsUsed += 1;

  const fx = Math.cos(thief.facing);
  const fz = Math.sin(thief.facing);
  let victim: Nipper | null = null;
  let bestD2 = Infinity;

  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    if (o.id === thief.id) continue;
    if (o.stash < 1) continue;
    if (isImmune(o, t)) continue;
    if (o.id === thief.lastVictimId) continue;
    const dx = o.x - thief.x;
    const dz = o.z - thief.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > RANGE_SQ) continue;
    if (d2 > 1e-12 && (dx * fx + dz * fz) / Math.sqrt(d2) < COS_HALF_CONE) continue; // outside the cone
    if (victim === null || d2 < bestD2 || (d2 === bestD2 && o.id < victim.id)) {
      victim = o;
      bestD2 = d2;
    }
  }

  if (victim === null) return { fired: true, victimId: NO_VICTIM, stolen: 0 };

  victim.stash -= 1;
  thief.stash += 1;
  victim.immuneUntil = t + NIP_IMMUNITY;
  victim.timesNipped += 1;
  thief.steals += 1;
  thief.lastVictimId = victim.id;
  return { fired: true, victimId: victim.id, stolen: 1 };
}
