import { ARENA, FISH_RADIUS } from "./constants";
import type { Obstacle } from "./obstacles";

/** The parts of a fish that collision reads and writes. FishState and SimPlayer both fit. */
export interface FishBody {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

const PASSES = 4; // several obstacles can overlap at once; a few passes settle it

/**
 * Push a fish out of any reed or rock it overlaps, and remove the velocity pointing into it,
 * so the fish slides along the surface. Pure and deterministic. Mutates `f`.
 */
export function collideFish(f: FishBody, obstacles: readonly Obstacle[]): void {
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const minD = o.radius + FISH_RADIUS;
      const dx = f.x - o.x;
      const dz = f.z - o.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;

      // Direction from the obstacle's centre to the fish. If the fish is exactly on the centre,
      // push it back the way it came (or along +x if it is not moving).
      let nx: number;
      let nz: number;
      const d = Math.sqrt(d2);
      if (d > 1e-9) {
        nx = dx / d;
        nz = dz / d;
      } else {
        const sp = Math.hypot(f.vx, f.vz);
        if (sp > 1e-9) {
          nx = -f.vx / sp;
          nz = -f.vz / sp;
        } else {
          nx = 1;
          nz = 0;
        }
      }

      f.x = o.x + nx * minD;
      f.z = o.z + nz * minD;
      const vn = f.vx * nx + f.vz * nz;
      if (vn < 0) {
        f.vx -= vn * nx;
        f.vz -= vn * nz;
      }
      moved = true;
    }
    if (!moved) break;
  }

  const hx = ARENA.w / 2;
  const hz = ARENA.h / 2;
  if (f.x < -hx) f.x = -hx;
  else if (f.x > hx) f.x = hx;
  if (f.z < -hz) f.z = -hz;
  else if (f.z > hz) f.z = hz;
}
