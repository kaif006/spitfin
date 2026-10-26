import { describe, it, expect } from "vitest";
import { generateObstacles } from "./obstacles";
import { ARENA, OBSTACLE_GAP, OBSTACLE_MARGIN, SPAWN_CLEAR_RADIUS } from "./constants";

describe("generateObstacles", () => {
  it("is deterministic for the same seed", () => {
    expect(generateObstacles(42)).toEqual(generateObstacles(42));
  });

  it("differs between seeds", () => {
    expect(generateObstacles(1)).not.toEqual(generateObstacles(2));
  });

  it("always makes 6 to 8 obstacles", () => {
    for (let seed = 0; seed < 200; seed++) {
      const n = generateObstacles(seed).length;
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(8);
    }
  });

  it("keeps obstacles inside the arena margin", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const o of generateObstacles(seed)) {
        expect(Math.abs(o.x)).toBeLessThanOrEqual(ARENA.w / 2 - OBSTACLE_MARGIN + 1e-9);
        expect(Math.abs(o.z)).toBeLessThanOrEqual(ARENA.h / 2 - OBSTACLE_MARGIN + 1e-9);
      }
    }
  });

  it("never overlaps obstacles or blocks the centre", () => {
    for (let seed = 0; seed < 100; seed++) {
      const obs = generateObstacles(seed);
      for (let i = 0; i < obs.length; i++) {
        expect(Math.hypot(obs[i].x, obs[i].z)).toBeGreaterThanOrEqual(SPAWN_CLEAR_RADIUS + obs[i].radius - 1e-9);
        for (let j = i + 1; j < obs.length; j++) {
          const d = Math.hypot(obs[i].x - obs[j].x, obs[i].z - obs[j].z);
          expect(d).toBeGreaterThanOrEqual(obs[i].radius + obs[j].radius + OBSTACLE_GAP - 1e-9);
        }
      }
    }
  });

  it("always includes at least 3 reeds", () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(generateObstacles(seed).filter((o) => o.kind === "reed").length).toBeGreaterThanOrEqual(3);
    }
  });
});
