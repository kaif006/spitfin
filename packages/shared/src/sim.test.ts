import { describe, expect, it } from "vitest";
import { ARENA, FISH_SPEED, TICK_DT, newFish, stepFish } from "./index";

describe("stepFish", () => {
  it("never exceeds top speed on diagonals", () => {
    const f = newFish();
    for (let i = 0; i < 120; i++) stepFish(f, 1, 1, TICK_DT);
    expect(Math.hypot(f.vx, f.vz)).toBeLessThanOrEqual(FISH_SPEED + 1e-6);
  });
  it("stays inside the arena", () => {
    const f = newFish();
    for (let i = 0; i < 600; i++) stepFish(f, 1, 0, TICK_DT);
    expect(f.x).toBeLessThanOrEqual(ARENA.w / 2);
  });
});
