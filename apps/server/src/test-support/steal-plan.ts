import {
  BUG_SPAWN_INTERVAL,
  MOUTH_RADIUS,
  SIM_SPAWN_RING,
  TICK_HZ,
  bugPosition,
  fallingBugPosition,
  generateObstacles,
  landTime,
  makeBugSpec,
  newSpitter,
  spitAim,
  trySpit,
} from "@spitfin/shared";
import type { BugSpec, Vec3 } from "@spitfin/shared";

export interface StealPlan {
  seed: number;
  /** The sim tick on which fish 0 must spit. */
  tick: number;
  yaw: number;
  pitch: number;
}

/**
 * Finds a (seed, tick, aim) where a spit from fish 0's start position hits a bug that lands inside
 * fish 0's mouth radius, so a fish that stands still eats it. Pure and deterministic.
 */
export function planSteal(): StealPlan {
  const fx = SIM_SPAWN_RING;
  const fz = 0;
  const pos: Vec3 = { x: 0, y: 0, z: 0 };
  const land: Vec3 = { x: 0, y: 0, z: 0 };
  for (let seed = 1; seed <= 3000; seed++) {
    const obstacles = generateObstacles(seed);
    const bugs: BugSpec[] = [];
    for (let tick = 1; tick <= 300; tick++) {
      const t = tick / TICK_HZ;
      while (bugs.length * BUG_SPAWN_INTERVAL <= t + 1e-9) bugs.push(makeBugSpec(seed, bugs.length, obstacles));
      for (const b of bugs) {
        if (t < b.spawnTime || t >= b.despawnTime) continue;
        bugPosition(b, t, pos);
        const aim = spitAim(fx, fz, pos.x, pos.y, pos.z);
        const r = trySpit(newSpitter(fx, fz), aim.yaw, aim.pitch, { seed, bugs, shot: [], obstacles }, t, 0);
        if (!r.hit) continue;
        fallingBugPosition(r.hit.fall, landTime(r.hit.fall), land);
        if (Math.hypot(land.x - fx, land.z - fz) <= MOUTH_RADIUS * 0.65) {
          return { seed, tick, yaw: aim.yaw, pitch: aim.pitch };
        }
      }
    }
  }
  throw new Error("no steal plan found");
}
