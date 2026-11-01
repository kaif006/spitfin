import type { WirePlayer } from "@spitfin/shared";

export interface Frame {
  tick: number;
  /** Match time in seconds: tick / TICK_HZ. */
  t: number;
  players: WirePlayer[];
}

export interface Shown {
  x: number;
  z: number;
  facing: number;
  dash: boolean;
}

const TAU = Math.PI * 2;

/** Shortest signed angle from a to b. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Fills `out` with where every fish is at match time `t`, blending the two snapshots around it.
 * Before the first snapshot or after the last, the nearest one is used. Returns false if there are none.
 */
export function sampleFrames(frames: readonly Frame[], t: number, out: Shown[]): boolean {
  const n = frames.length;
  if (n === 0) return false;
  const first = frames[0]!;
  const newest = frames[n - 1]!;
  let lo = first;
  let hi = first;
  if (t >= newest.t) {
    lo = newest;
    hi = newest;
  } else if (t > first.t) {
    for (let i = n - 1; i > 0; i--) {
      const prev = frames[i - 1]!;
      if (prev.t <= t) {
        lo = prev;
        hi = frames[i]!;
        break;
      }
    }
  }
  const k = hi.t > lo.t ? (t - lo.t) / (hi.t - lo.t) : 0;
  out.length = hi.players.length;
  for (let i = 0; i < hi.players.length; i++) {
    const b = hi.players[i]!;
    const a = lo.players[i] ?? b;
    const o = out[i] ?? (out[i] = { x: 0, z: 0, facing: 0, dash: false });
    o.x = a.x + (b.x - a.x) * k;
    o.z = a.z + (b.z - a.z) * k;
    o.facing = a.facing + angleDiff(a.facing, b.facing) * k;
    o.dash = b.dash;
  }
  return true;
}
