import { ARENA, FISH_ACCEL_TIME, FISH_SPEED } from "./constants";

export interface FishState {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export const newFish = (): FishState => ({ x: 0, z: 0, vx: 0, vz: 0 });

/** Pure, deterministic movement step. Axis values are clamped to unit length. */
export function stepFish(f: FishState, ax: number, az: number, dt: number): void {
  const len = Math.hypot(ax, az);
  if (len > 1) { ax /= len; az /= len; }
  const k = Math.min(1, dt / FISH_ACCEL_TIME);
  f.vx += (ax * FISH_SPEED - f.vx) * k;
  f.vz += (az * FISH_SPEED - f.vz) * k;
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  const hx = ARENA.w / 2, hz = ARENA.h / 2;
  if (f.x < -hx) { f.x = -hx; f.vx = 0; }
  if (f.x > hx) { f.x = hx; f.vx = 0; }
  if (f.z < -hz) { f.z = -hz; f.vz = 0; }
  if (f.z > hz) { f.z = hz; f.vz = 0; }
}
