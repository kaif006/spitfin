import { describe, it, expect } from "vitest";
import { SPIT_ORIGIN_Y } from "./constants";
import { makeBugSpec } from "./bugs";
import type { BugSpec } from "./bugs";
import { spitAim } from "./aim";
import { newSpitter, trySpit } from "./spit";

describe("spitAim", () => {
  it("points the yaw at the target", () => {
    expect(spitAim(0, 0, 3, SPIT_ORIGIN_Y, 0).yaw).toBeCloseTo(0);
    expect(spitAim(0, 0, 0, SPIT_ORIGIN_Y, 4).yaw).toBeCloseTo(Math.PI / 2);
    expect(spitAim(1, 1, -2, SPIT_ORIGIN_Y, 1).yaw).toBeCloseTo(Math.PI);
  });

  it("gets the pitch from the height above the mouth", () => {
    expect(spitAim(0, 0, 4, SPIT_ORIGIN_Y, 0).pitch).toBeCloseTo(0);
    expect(spitAim(0, 0, 4, SPIT_ORIGIN_Y + 3, 0).pitch).toBeCloseTo(Math.atan2(3, 4));
  });

  it("stays finite when the target is straight above the fish", () => {
    const a = spitAim(1, 1, 1, 2, 1);
    expect(a.pitch).toBeCloseTo(Math.PI / 2);
    expect(Number.isFinite(a.yaw)).toBe(true);
  });

  it("stays finite when the target is at the mouth", () => {
    const a = spitAim(2, -1, 2, SPIT_ORIGIN_Y, -1);
    expect(Number.isFinite(a.yaw)).toBe(true);
    expect(a.pitch).toBeCloseTo(0);
  });

  it("an aim at a bug makes trySpit hit it", () => {
    const bug: BugSpec = {
      ...makeBugSpec(1, 0, []),
      id: 5, perched: true, perchX: -4, perchY: 2.2, perchZ: 3, spawnTime: 0, despawnTime: 100,
    };
    const fish = newSpitter(1, -2);
    const { yaw, pitch } = spitAim(fish.x, fish.z, bug.perchX, bug.perchY, bug.perchZ);
    const res = trySpit(fish, yaw, pitch, { seed: 1, bugs: [bug], shot: [], obstacles: [] }, 10);
    expect(res.bugId).toBe(5);
  });
});
