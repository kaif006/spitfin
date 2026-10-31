import { NIP_DASH_SPEED } from "./constants";
import type { FishBody } from "./collide";

/**
 * One tick of a nip dash: the fish moves along `facing` at NIP_DASH_SPEED and ignores steering.
 * The caller runs collideFish afterwards (which also keeps the fish inside the arena), and keeps
 * the facing locked while the dash lasts. Mutates `f`.
 *
 * When the dash ends, the normal acceleration ramp in stepFish bleeds off the extra speed, so the
 * fish glides a little further instead of stopping dead.
 */
export function stepDash(f: FishBody, facing: number, dt: number): void {
  f.vx = Math.cos(facing) * NIP_DASH_SPEED;
  f.vz = Math.sin(facing) * NIP_DASH_SPEED;
  f.x += f.vx * dt;
  f.z += f.vz * dt;
}
