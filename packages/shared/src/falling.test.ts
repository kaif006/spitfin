import { describe, it, expect } from "vitest";
import { ARENA, BUG_FALL_DRIFT, BUG_FALL_MAX, BUG_FALL_MIN, BUG_FLOAT_LIFETIME, FLOAT_DRIFT_SPEED } from "./constants";
import { expireTime, fallingBugPhase, fallingBugPosition, landTime, makeFallingBug } from "./falling";
import type { Vec3 } from "./bugs";

const hit: Vec3 = { x: 2, y: 2, z: -1 };
const tmp: Vec3 = { x: 0, y: 0, z: 0 };

describe("falling bugs", () => {
  it("fall duration stays within the allowed range", () => {
    for (let id = 0; id < 200; id++) {
      const fb = makeFallingBug(42, id, 10, hit);
      expect(fb.fallDuration).toBeGreaterThanOrEqual(BUG_FALL_MIN);
      expect(fb.fallDuration).toBeLessThanOrEqual(BUG_FALL_MAX);
    }
  });

  it("is deterministic", () => {
    expect(makeFallingBug(7, 3, 5, hit)).toEqual(makeFallingBug(7, 3, 5, hit));
  });

  it("different bugs fall differently", () => {
    const a = makeFallingBug(7, 1, 5, hit);
    const b = makeFallingBug(7, 2, 5, hit);
    expect(a.fallDuration === b.fallDuration && a.landX === b.landX).toBe(false);
  });

  it("starts at the hit position", () => {
    const fb = makeFallingBug(1, 0, 4, hit);
    fallingBugPosition(fb, 4, tmp);
    expect(tmp.x).toBeCloseTo(hit.x);
    expect(tmp.y).toBeCloseTo(hit.y);
    expect(tmp.z).toBeCloseTo(hit.z);
  });

  it("stays above the water while falling and reaches it at landing", () => {
    const fb = makeFallingBug(1, 0, 4, hit);
    for (let i = 0; i < 100; i++) {
      fallingBugPosition(fb, 4 + (fb.fallDuration * 0.99 * i) / 99, tmp);
      expect(tmp.y).toBeGreaterThan(0);
    }
    fallingBugPosition(fb, landTime(fb) - 1e-4, tmp);
    expect(tmp.y).toBeLessThan(0.01);
    fallingBugPosition(fb, landTime(fb), tmp);
    expect(tmp.y).toBe(0);
  });

  it("lands within the drift limit of where it was hit", () => {
    for (let id = 0; id < 200; id++) {
      const fb = makeFallingBug(9, id, 0, hit);
      fallingBugPosition(fb, landTime(fb), tmp);
      expect(Math.hypot(tmp.x - hit.x, tmp.z - hit.z)).toBeLessThanOrEqual(BUG_FALL_DRIFT + 1e-9);
    }
  });

  it("moves through falling, floating, expired", () => {
    const fb = makeFallingBug(1, 0, 10, hit);
    expect(fallingBugPhase(fb, 10)).toBe("falling");
    expect(fallingBugPhase(fb, landTime(fb) - 0.01)).toBe("falling");
    expect(fallingBugPhase(fb, landTime(fb))).toBe("floating");
    expect(fallingBugPhase(fb, expireTime(fb) - 0.01)).toBe("floating");
    expect(fallingBugPhase(fb, expireTime(fb))).toBe("expired");
    expect(expireTime(fb) - landTime(fb)).toBeCloseTo(BUG_FLOAT_LIFETIME);
  });

  it("floating bugs stay on the water and inside the arena, even from a corner", () => {
    const corner: Vec3 = { x: ARENA.w / 2 - 1, y: 2, z: ARENA.h / 2 - 1 };
    for (let id = 0; id < 100; id++) {
      const fb = makeFallingBug(5, id, 0, corner);
      for (let t = landTime(fb); t <= expireTime(fb); t += 0.25) {
        fallingBugPosition(fb, t, tmp);
        expect(tmp.y).toBe(0);
        expect(Math.abs(tmp.x)).toBeLessThanOrEqual(ARENA.w / 2);
        expect(Math.abs(tmp.z)).toBeLessThanOrEqual(ARENA.h / 2);
      }
    }
  });

  it("floating drift is slow", () => {
    const fb = makeFallingBug(3, 8, 0, hit);
    fallingBugPosition(fb, landTime(fb), tmp);
    const x0 = tmp.x, z0 = tmp.z;
    fallingBugPosition(fb, expireTime(fb), tmp);
    expect(Math.hypot(tmp.x - x0, tmp.z - z0)).toBeLessThanOrEqual(FLOAT_DRIFT_SPEED * BUG_FLOAT_LIFETIME + 1e-9);
  });
});
