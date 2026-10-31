import { FISH_PUSH, FISH_RADIUS } from "./constants";
import type { FishBody } from "./collide";

const CONTACT = 2 * FISH_RADIUS; // fish touch when their centres are closer than this
const CONTACT_SQ = CONTACT * CONTACT;

// Scratch space, so a tick allocates nothing.
const pushX: number[] = [];
const pushZ: number[] = [];

/**
 * Soft fish-versus-fish collisions. Fish whose centres are closer than 2 * FISH_RADIUS are pushed
 * apart along the line between them, undoing `push` (default FISH_PUSH) of the overlap per call,
 * split equally between the two. A fish that keeps swimming into another one therefore shoves it
 * along rather than stopping dead.
 *
 * Only positions change, never velocities. Pushes from every pair are added up first and applied
 * together, so the result does not depend on the order of the fish. Two fish at exactly the same
 * spot are pushed apart along x (the lower index to -x), so the outcome is still deterministic.
 *
 * Returns true if any fish moved. The caller should then run collideFish again for every fish,
 * because a push can move a fish into a reed or rock, or past the arena edge.
 */
export function separateFish(fish: readonly FishBody[], push: number = FISH_PUSH): boolean {
  const n = fish.length;
  if (n < 2) return false;
  for (let i = 0; i < n; i++) {
    pushX[i] = 0;
    pushZ[i] = 0;
  }

  let any = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = fish[i];
      const b = fish[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= CONTACT_SQ) continue;

      let nx = 1;
      let nz = 0;
      let d = 0;
      if (d2 > 1e-18) {
        d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
      }
      const half = ((CONTACT - d) * push) / 2;
      pushX[i] -= nx * half;
      pushZ[i] -= nz * half;
      pushX[j] += nx * half;
      pushZ[j] += nz * half;
      any = true;
    }
  }
  if (!any) return false;

  for (let i = 0; i < n; i++) {
    fish[i].x += pushX[i];
    fish[i].z += pushZ[i];
  }
  return true;
}
