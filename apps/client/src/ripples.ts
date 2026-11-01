export const MAX_RIPPLES = 8;
export const RIPPLE_LIFE = 4; // seconds

type Slot = { x: number; z: number; t: number; s: number };

/** A small ring of live ripples. When it is full, the oldest one is replaced. */
export class RipplePool {
  private readonly slots: Slot[] = Array.from({ length: MAX_RIPPLES }, () => ({ x: 0, z: 0, t: 0, s: 0 }));

  add(x: number, z: number, now: number, strength: number): void {
    let pick = this.slots[0]!;
    for (const sl of this.slots) {
      if (sl.s <= 0 || now - sl.t >= RIPPLE_LIFE) {
        pick = sl;
        break;
      }
      if (sl.t < pick.t) pick = sl;
    }
    pick.x = x;
    pick.z = z;
    pick.t = now;
    pick.s = strength;
  }

  /** Writes x, z, start time, strength for every slot (strength 0 means unused or finished). */
  fill(out: Float32Array, now: number): void {
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const sl = this.slots[i]!;
      const alive = sl.s > 0 && now - sl.t < RIPPLE_LIFE;
      out[i * 4] = sl.x;
      out[i * 4 + 1] = sl.z;
      out[i * 4 + 2] = sl.t;
      out[i * 4 + 3] = alive ? sl.s : 0;
    }
  }
}
