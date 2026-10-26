import { ARENA, BUG_FALL_DRIFT, BUG_FALL_MAX, BUG_FALL_MIN, BUG_FLOAT_LIFETIME, BUG_HIT_POP, FLOAT_DRIFT_SPEED, FLOAT_EDGE_MARGIN } from "./constants";
import type { Vec3 } from "./bugs";
import { hash01 } from "./rng";

const TAU = Math.PI * 2;
const SALT = 0x5bd1e995; // keeps these random values separate from the bug-path ones
const HX = ARENA.w / 2 - FLOAT_EDGE_MARGIN;
const HZ = ARENA.h / 2 - FLOAT_EDGE_MARGIN;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type BugPhase = "falling" | "floating" | "expired";

/** Everything needed to compute a shot bug's position at any time. Built once, at the moment of the hit. */
export interface FallingBug {
  bugId: number;
  hitTime: number;
  fallDuration: number;
  gravity: number;
  startX: number; startY: number; startZ: number;
  landX: number; landZ: number;
  driftVx: number; driftVz: number; // drift velocity while floating
}

/** Pure: the same (seed, bugId, hitTime, hitPos) always gives the same fall. */
export function makeFallingBug(seed: number, bugId: number, hitTime: number, hitPos: Vec3): FallingBug {
  const r = (channel: number) => hash01((seed ^ SALT) >>> 0, bugId, channel);

  const fallDuration = BUG_FALL_MIN + r(0) * (BUG_FALL_MAX - BUG_FALL_MIN);
  const fallAngle = r(1) * TAU;
  const fallDist = BUG_FALL_DRIFT * (0.3 + 0.7 * r(2));
  const landX = clamp(hitPos.x + Math.cos(fallAngle) * fallDist, -HX, HX);
  const landZ = clamp(hitPos.z + Math.sin(fallAngle) * fallDist, -HZ, HZ);

  // y(s) = startY + pop*s - 0.5*g*s^2. Solving y(T) = 0 gives g, so the bug lands exactly at T.
  const gravity = (2 * (hitPos.y + BUG_HIT_POP * fallDuration)) / (fallDuration * fallDuration);

  const floatAngle = r(3) * TAU;
  const floatSpeed = FLOAT_DRIFT_SPEED * (0.5 + 0.5 * r(4));

  return {
    bugId,
    hitTime,
    fallDuration,
    gravity,
    startX: hitPos.x, startY: hitPos.y, startZ: hitPos.z,
    landX, landZ,
    driftVx: Math.cos(floatAngle) * floatSpeed,
    driftVz: Math.sin(floatAngle) * floatSpeed,
  };
}

export const landTime = (fb: FallingBug): number => fb.hitTime + fb.fallDuration;
export const expireTime = (fb: FallingBug): number => landTime(fb) + BUG_FLOAT_LIFETIME;

export function fallingBugPhase(fb: FallingBug, t: number): BugPhase {
  if (t < landTime(fb)) return "falling";
  if (t < expireTime(fb)) return "floating";
  return "expired";
}

/** Position at match time `t`. Writes into `out` to avoid allocation. Floating bugs sit at y = 0 (the water). */
export function fallingBugPosition(fb: FallingBug, t: number, out: Vec3): Vec3 {
  const s = t - fb.hitTime;
  if (s < fb.fallDuration) {
    const c = s < 0 ? 0 : s;
    const k = c / fb.fallDuration;
    out.x = fb.startX + (fb.landX - fb.startX) * k;
    out.z = fb.startZ + (fb.landZ - fb.startZ) * k;
    out.y = Math.max(0, fb.startY + BUG_HIT_POP * c - 0.5 * fb.gravity * c * c);
    return out;
  }
  const u = Math.min(s - fb.fallDuration, BUG_FLOAT_LIFETIME);
  out.x = clamp(fb.landX + fb.driftVx * u, -HX, HX);
  out.z = clamp(fb.landZ + fb.driftVz * u, -HZ, HZ);
  out.y = 0;
  return out;
}
