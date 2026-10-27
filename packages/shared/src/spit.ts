import {
  BUG_HIT_RADIUS,
  LAG_REWIND_MAX,
  REED_HEIGHT,
  ROCK_HEIGHT,
  SPIT_COOLDOWN,
  SPIT_ORIGIN_Y,
  SPIT_PITCH_MAX,
  SPIT_PITCH_MIN,
  SPIT_RANGE,
} from "./constants";
import { bugPosition } from "./bugs";
import type { BugSpec, Vec3 } from "./bugs";
import { newShotBug } from "./eating";
import type { ShotBug } from "./eating";
import { makeFallingBug } from "./falling";
import type { Obstacle } from "./obstacles";

export const NO_OBSTACLE = -1;
export const NO_BUG = -1;

/** The parts of a fish that spitting reads and writes. */
export interface Spitter {
  x: number;
  z: number;
  nextSpitTime: number; // the fish may spit again at or after this time
  shots: number;
  hits: number;
}

export const newSpitter = (x = 0, z = 0): Spitter => ({ x, z, nextSpitTime: 0, shots: 0, hits: 0 });

/** The match state a spit needs to look at. The caller owns these arrays. */
export interface SpitContext {
  seed: number;
  bugs: readonly BugSpec[]; // every bug spec generated so far
  shot: readonly ShotBug[]; // bugs already hit
  obstacles: readonly Obstacle[];
}

export interface SpitResult {
  fired: boolean; // false on cooldown or invalid aim
  hit: ShotBug | null; // set when a bug was hit; the caller adds it to the shot list
  bugId: number; // id of the bug hit, or NO_BUG
  blockedBy: number; // id of the obstacle that cut the jet short, or NO_OBSTACLE
  length: number; // how far the jet travelled
  endX: number;
  endY: number;
  endZ: number; // where the jet stopped (for the splash or droplet effect)
}

const pos: Vec3 = { x: 0, y: 0, z: 0 };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const obstacleHeight = (o: Obstacle) => (o.kind === "reed" ? REED_HEIGHT : ROCK_HEIGHT);

function alreadyShot(shot: readonly ShotBug[], bugId: number): boolean {
  for (let i = 0; i < shot.length; i++) if (shot[i].fall.bugId === bugId) return true;
  return false;
}

/** Distance along a unit-direction ray to a sphere, or -1 for a miss. A ray starting inside hits at 0. */
function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const px = ox - cx, py = oy - cy, pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  if (c > 0 && b > 0) return -1; // outside and pointing away
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

/** Distance along the ray to where it enters a vertical cylinder's side within its height, or -1. */
function rayCylinder(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  o: Obstacle,
): number {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1; // straight up
  const fx = ox - o.x, fz = oz - o.z;
  const c = fx * fx + fz * fz - o.radius * o.radius;
  if (c < 0) return -1; // the mouth is already inside this obstacle: ignore it
  const b = fx * dx + fz * dz;
  if (b >= 0) return -1; // pointing away
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  const y = oy + dy * t;
  if (y < 0 || y > obstacleHeight(o)) return -1;
  return t;
}

const notFired = (): SpitResult => ({
  fired: false, hit: null, bugId: NO_BUG, blockedBy: NO_OBSTACLE, length: 0, endX: 0, endY: 0, endZ: 0,
});

/**
 * Try to spit at match time `t`. `rewind` (seconds) is lag compensation: bug positions are tested at
 * `t - rewind`, capped at LAG_REWIND_MAX. A bug that is hit starts falling at `t`.
 * Mutates `spitter` (cooldown and stats). Does not modify the context arrays.
 */
export function trySpit(
  spitter: Spitter,
  yaw: number,
  pitch: number,
  ctx: SpitContext,
  t: number,
  rewind = 0,
): SpitResult {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return notFired();
  if (t < spitter.nextSpitTime) return notFired();

  // Aim direction (unit length). yaw = atan2(dz, dx), pitch = upward angle.
  const p = clamp(pitch, SPIT_PITCH_MIN, SPIT_PITCH_MAX);
  const cp = Math.cos(p);
  const dx = cp * Math.cos(yaw);
  const dy = Math.sin(p);
  const dz = cp * Math.sin(yaw);
  const ox = spitter.x, oy = SPIT_ORIGIN_Y, oz = spitter.z;

  spitter.nextSpitTime = t + SPIT_COOLDOWN;
  spitter.shots += 1;

  const tb = t - (Number.isFinite(rewind) ? clamp(rewind, 0, LAG_REWIND_MAX) : 0);

  // 1. Nearest bug on the ray.
  let bug: BugSpec | null = null;
  let bugT = Infinity;
  let hx = 0, hy = 0, hz = 0;
  for (let i = 0; i < ctx.bugs.length; i++) {
    const spec = ctx.bugs[i];
    if (tb < spec.spawnTime || tb >= spec.despawnTime) continue;
    if (alreadyShot(ctx.shot, spec.id)) continue;
    bugPosition(spec, tb, pos);
    const d = raySphere(ox, oy, oz, dx, dy, dz, pos.x, pos.y, pos.z, BUG_HIT_RADIUS);
    if (d < 0 || d > SPIT_RANGE || d >= bugT) continue;
    bug = spec;
    bugT = d;
    hx = pos.x; hy = pos.y; hz = pos.z;
  }

  // 2. Nearest obstacle closer than the bug (or closer than max range if there is no bug).
  let obsT = bug ? bugT : SPIT_RANGE;
  let obsId = NO_OBSTACLE;
  for (let i = 0; i < ctx.obstacles.length; i++) {
    const o = ctx.obstacles[i];
    if (bug && bug.perched && o.x === bug.perchX && o.z === bug.perchZ) continue; // its own reed
    const d = rayCylinder(ox, oy, oz, dx, dy, dz, o);
    if (d >= 0 && d < obsT) {
      obsT = d;
      obsId = o.id;
    }
  }

  if (obsId !== NO_OBSTACLE) {
    return {
      fired: true, hit: null, bugId: NO_BUG, blockedBy: obsId, length: obsT,
      endX: ox + dx * obsT, endY: oy + dy * obsT, endZ: oz + dz * obsT,
    };
  }

  if (bug) {
    const fall = makeFallingBug(ctx.seed, bug.id, t, { x: hx, y: hy, z: hz });
    spitter.hits += 1;
    return {
      fired: true, hit: newShotBug(fall), bugId: bug.id, blockedBy: NO_OBSTACLE, length: bugT,
      endX: ox + dx * bugT, endY: oy + dy * bugT, endZ: oz + dz * bugT,
    };
  }

  return {
    fired: true, hit: null, bugId: NO_BUG, blockedBy: NO_OBSTACLE, length: SPIT_RANGE,
    endX: ox + dx * SPIT_RANGE, endY: oy + dy * SPIT_RANGE, endZ: oz + dz * SPIT_RANGE,
  };
}
