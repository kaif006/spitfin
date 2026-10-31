import { describe, expect, it } from "vitest";
import { FISH_PUSH, FISH_RADIUS } from "./constants";
import { separateFish } from "./bump";

const CONTACT = 2 * FISH_RADIUS;
const fishAt = (x: number, z: number, vx = 0, vz = 0) => ({ x, z, vx, vz });
const gap = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);

describe("separateFish", () => {
  it("does nothing for fish that are apart", () => {
    const a = fishAt(0, 0);
    const b = fishAt(1, 0);
    expect(separateFish([a, b])).toBe(false);
    expect([a.x, a.z, b.x, b.z]).toEqual([0, 0, 1, 0]);
  });

  it("does nothing when the fish only just touch", () => {
    const a = fishAt(0, 0);
    const b = fishAt(CONTACT, 0);
    expect(separateFish([a, b])).toBe(false);
    expect(b.x).toBe(CONTACT);
  });

  it("does nothing with fewer than two fish", () => {
    expect(separateFish([])).toBe(false);
    expect(separateFish([fishAt(0, 0)])).toBe(false);
  });

  it("pushes overlapping fish apart along the line between them, equally", () => {
    const a = fishAt(0, 0);
    const b = fishAt(0.5, 0);
    const overlap = CONTACT - 0.5;
    expect(separateFish([a, b])).toBe(true);
    const each = (overlap * FISH_PUSH) / 2;
    expect(a.x).toBeCloseTo(-each, 9);
    expect(b.x).toBeCloseTo(0.5 + each, 9);
    expect(a.z).toBe(0);
    expect(b.z).toBe(0);
  });

  it("works along any direction", () => {
    const a = fishAt(1, 1);
    const b = fishAt(1.3, 1.4); // distance 0.5, diagonal
    separateFish([a, b]);
    expect(gap(a, b)).toBeCloseTo(0.5 + (CONTACT - 0.5) * FISH_PUSH, 9);
    // still on the same line
    expect((b.z - a.z) / (b.x - a.x)).toBeCloseTo(0.4 / 0.3, 9);
  });

  it("is soft: one call does not fully separate the fish, and repeated calls converge without crossing", () => {
    const a = fishAt(0, 0);
    const b = fishAt(0.2, 0);
    separateFish([a, b]);
    expect(gap(a, b)).toBeGreaterThan(0.2);
    expect(gap(a, b)).toBeLessThan(CONTACT);

    let last = gap(a, b);
    for (let i = 0; i < 80; i++) {
      separateFish([a, b]);
      const g = gap(a, b);
      expect(g).toBeGreaterThanOrEqual(last);
      expect(g).toBeLessThanOrEqual(CONTACT + 1e-12);
      expect(b.x).toBeGreaterThan(a.x); // never swapped sides
      last = g;
    }
    expect(last).toBeCloseTo(CONTACT, 9);
  });

  it("gives the same result whichever fish comes first", () => {
    const a1 = fishAt(0, 0);
    const b1 = fishAt(0.4, 0.1);
    separateFish([a1, b1]);
    const a2 = fishAt(0, 0);
    const b2 = fishAt(0.4, 0.1);
    separateFish([b2, a2]);
    expect(a2.x).toBeCloseTo(a1.x, 12);
    expect(a2.z).toBeCloseTo(a1.z, 12);
    expect(b2.x).toBeCloseTo(b1.x, 12);
    expect(b2.z).toBeCloseTo(b1.z, 12);
  });

  it("adds up pushes from several fish before applying them", () => {
    // The middle fish is pushed equally from both sides, so it must not move at all.
    const a = fishAt(-0.5, 0);
    const m = fishAt(0, 0);
    const c = fishAt(0.5, 0);
    const each = ((CONTACT - 0.5) * FISH_PUSH) / 2;
    separateFish([a, m, c]);
    expect(m.x).toBeCloseTo(0, 12);
    expect(a.x).toBeCloseTo(-0.5 - each, 12);
    expect(c.x).toBeCloseTo(0.5 + each, 12);
  });

  it("pushes fish at exactly the same spot apart along x, lower index to the left", () => {
    const a = fishAt(1, 1);
    const b = fishAt(1, 1);
    expect(separateFish([a, b])).toBe(true);
    const each = (CONTACT * FISH_PUSH) / 2;
    expect(a.x).toBeCloseTo(1 - each, 12);
    expect(b.x).toBeCloseTo(1 + each, 12);
    expect(a.z).toBe(1);
    expect(b.z).toBe(1);
  });

  it("changes positions only, never velocities", () => {
    const a = fishAt(0, 0, 3, -1);
    const b = fishAt(0.3, 0, -2, 4);
    separateFish([a, b]);
    expect([a.vx, a.vz, b.vx, b.vz]).toEqual([3, -1, -2, 4]);
  });

  it("with a push of 1 separates two fish completely in one call", () => {
    const a = fishAt(0, 0);
    const b = fishAt(0.3, 0.2);
    separateFish([a, b], 1);
    expect(gap(a, b)).toBeCloseTo(CONTACT, 9);
  });
});
