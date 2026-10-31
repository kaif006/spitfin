import { describe, expect, it } from "vitest";
import { FISH_SPEED, NIP_DASH_SPEED, NIP_RANGE, TICK_DT } from "./constants";
import { stepDash } from "./dash";

const fish = (vx = 0, vz = 0) => ({ x: 0, z: 0, vx, vz });

describe("stepDash", () => {
  it("dashes faster than the top swimming speed", () => {
    expect(NIP_DASH_SPEED).toBeGreaterThan(FISH_SPEED);
  });

  it("moves along the facing at the dash speed", () => {
    const f = fish();
    stepDash(f, 0, TICK_DT);
    expect(f.vx).toBeCloseTo(NIP_DASH_SPEED, 9);
    expect(f.vz).toBeCloseTo(0, 9);
    expect(f.x).toBeCloseTo(NIP_DASH_SPEED * TICK_DT, 9);
    expect(f.z).toBeCloseTo(0, 9);
  });

  it("keeps the same speed in every direction", () => {
    for (const facing of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 2, 2.5, -3]) {
      const f = fish();
      stepDash(f, facing, TICK_DT);
      expect(Math.hypot(f.vx, f.vz), `facing ${facing}`).toBeCloseTo(NIP_DASH_SPEED, 9);
      expect(Math.atan2(f.vz, f.vx), `facing ${facing}`).toBeCloseTo(facing, 9);
    }
  });

  it("overrides whatever velocity the fish had", () => {
    const f = fish(-FISH_SPEED, 2);
    stepDash(f, Math.PI / 2, TICK_DT);
    expect(f.vx).toBeCloseTo(0, 9);
    expect(f.vz).toBeCloseTo(NIP_DASH_SPEED, 9);
  });

  it("covers close to the nip range over the 7 dash ticks of a full nip", () => {
    const f = fish();
    for (let i = 0; i < 7; i++) stepDash(f, 0, TICK_DT);
    expect(f.x).toBeGreaterThan(NIP_RANGE * 0.9);
    expect(f.x).toBeLessThanOrEqual(NIP_RANGE);
  });
});
