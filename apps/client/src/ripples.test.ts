import { describe, expect, it } from "vitest";
import { MAX_RIPPLES, RIPPLE_LIFE, RipplePool } from "./ripples";

const out = () => new Float32Array(MAX_RIPPLES * 4);

describe("RipplePool", () => {
  it("writes a ripple as x, z, start time, strength", () => {
    const p = new RipplePool();
    p.add(1, 2, 3, 0.5);
    const o = out();
    p.fill(o, 3.5);
    expect(Array.from(o.slice(0, 4))).toEqual([1, 2, 3, 0.5]);
    expect(o[7]).toBe(0);
  });

  it("switches a ripple off after its lifetime", () => {
    const p = new RipplePool();
    p.add(0, 0, 0, 1);
    const o = out();
    p.fill(o, RIPPLE_LIFE + 0.1);
    expect(o[3]).toBe(0);
  });

  it("replaces the oldest ripple when full", () => {
    const p = new RipplePool();
    for (let i = 0; i < MAX_RIPPLES; i++) p.add(i, 0, i * 0.1, 1);
    p.add(99, 0, 1, 1);
    const o = out();
    p.fill(o, 1);
    const xs = Array.from({ length: MAX_RIPPLES }, (_, i) => o[i * 4]);
    expect(xs).toContain(99);
    expect(xs).not.toContain(0);
    expect(xs).toContain(1);
  });
});
