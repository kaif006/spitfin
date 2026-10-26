import {
  ARENA,
  BUG_HEIGHT_MAX,
  BUG_HEIGHT_MIN,
  BUG_LIFETIME,
  BUG_SPAWN_INTERVAL,
  FLIGHT_MARGIN,
  PERCHED_CHANCE,
  REED_HEIGHT,
} from "./constants";
import type { Obstacle } from "./obstacles";
import { hash01 } from "./rng";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Everything needed to compute a bug's position at any time. Built once at spawn. */
export interface BugSpec {
  id: number;
  spawnTime: number;
  despawnTime: number; // an unshot bug disappears at this time
  perched: boolean;
  // Flying bugs follow a Lissajous curve: position = centre + amplitude * sin(freq * age + phase)
  cx: number; cz: number;
  ampX: number; ampZ: number; ampY: number;
  freqX: number; freqZ: number; freqY: number;
  phaseX: number; phaseZ: number; phaseY: number;
  baseY: number;
  // Perched bugs sit still here
  perchX: number; perchY: number; perchZ: number;
}

const TAU = Math.PI * 2;

/** Build the spec for bug number `index`. Pure: same (seed, index, obstacles) gives the same bug. */
export function makeBugSpec(seed: number, index: number, obstacles: readonly Obstacle[]): BugSpec {
  const r = (channel: number) => hash01(seed, index, channel);
  const spawnTime = index * BUG_SPAWN_INTERVAL;
  const reeds = obstacles.filter((o) => o.kind === "reed");
  const perched = reeds.length > 0 && r(0) < PERCHED_CHANCE;

  const ampX = 2 + r(1) * 3; // 2 to 5
  const ampZ = 1.5 + r(2) * 2; // 1.5 to 3.5
  const rangeX = ARENA.w / 2 - FLIGHT_MARGIN - ampX;
  const rangeZ = ARENA.h / 2 - FLIGHT_MARGIN - ampZ;
  const halfBand = (BUG_HEIGHT_MAX - BUG_HEIGHT_MIN) / 2;

  const reed = perched ? reeds[Math.floor(r(10) * reeds.length) % reeds.length] : undefined;

  return {
    id: index,
    spawnTime,
    despawnTime: spawnTime + BUG_LIFETIME,
    perched,
    cx: (r(3) * 2 - 1) * rangeX,
    cz: (r(4) * 2 - 1) * rangeZ,
    ampX,
    ampZ,
    ampY: halfBand * (0.5 + 0.5 * r(9)), // never leaves the 1 to 3 height band
    freqX: 0.3 + r(5) * 0.4,
    freqZ: 0.4 + r(6) * 0.5,
    freqY: 1.0 + r(11) * 1.0,
    phaseX: r(7) * TAU,
    phaseZ: r(8) * TAU,
    phaseY: r(12) * TAU,
    baseY: (BUG_HEIGHT_MIN + BUG_HEIGHT_MAX) / 2,
    perchX: reed ? reed.x : 0,
    perchY: REED_HEIGHT,
    perchZ: reed ? reed.z : 0,
  };
}

/** Position of a flying or perched bug at match time `t`. Writes into `out` to avoid allocation. */
export function bugPosition(spec: BugSpec, t: number, out: Vec3): Vec3 {
  if (spec.perched) {
    out.x = spec.perchX;
    out.y = spec.perchY;
    out.z = spec.perchZ;
    return out;
  }
  const age = t - spec.spawnTime;
  out.x = spec.cx + spec.ampX * Math.sin(spec.freqX * age + spec.phaseX);
  out.y = spec.baseY + spec.ampY * Math.sin(spec.freqY * age + spec.phaseY);
  out.z = spec.cz + spec.ampZ * Math.sin(spec.freqZ * age + spec.phaseZ);
  return out;
}
