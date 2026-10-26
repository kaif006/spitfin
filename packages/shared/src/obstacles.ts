import {
  ARENA,
  OBSTACLE_GAP,
  OBSTACLE_MARGIN,
  OBSTACLE_MAX,
  OBSTACLE_MIN,
  REED_RADIUS,
  ROCK_RADIUS,
  SPAWN_CLEAR_RADIUS,
} from "./constants";
import { mulberry32 } from "./rng";

export type ObstacleKind = "reed" | "rock";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  radius: number;
}

/**
 * Deterministic obstacle layout for a match seed.
 * The first 3 obstacles are always reeds, so perched bugs always have somewhere to sit.
 */
export function generateObstacles(seed: number): Obstacle[] {
  const rng = mulberry32((seed ^ 0xa5a5a5a5) >>> 0);
  const count = OBSTACLE_MIN + Math.floor(rng() * (OBSTACLE_MAX - OBSTACLE_MIN + 1));
  const hx = ARENA.w / 2 - OBSTACLE_MARGIN;
  const hz = ARENA.h / 2 - OBSTACLE_MARGIN;
  const out: Obstacle[] = [];

  for (let i = 0; i < count; i++) {
    const kind: ObstacleKind = i < 3 ? "reed" : rng() < 0.5 ? "reed" : "rock";
    const radius = kind === "reed" ? REED_RADIUS : ROCK_RADIUS;

    for (let attempt = 0; attempt < 200; attempt++) {
      const x = (rng() * 2 - 1) * hx;
      const z = (rng() * 2 - 1) * hz;
      if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS + radius) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius + OBSTACLE_GAP)) continue;
      out.push({ id: out.length, kind, x, z, radius });
      break;
    }
  }
  return out;
}
