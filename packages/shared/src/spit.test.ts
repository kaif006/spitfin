import { describe, it, expect } from "vitest";
import {
  BUG_HIT_RADIUS,
  LAG_REWIND_MAX,
  REED_HEIGHT,
  SPIT_COOLDOWN,
  SPIT_ORIGIN_Y,
  SPIT_PITCH_MAX,
  SPIT_RANGE,
} from "./constants";
import { bugPosition, makeBugSpec } from "./bugs";
import type { BugSpec, Vec3 } from "./bugs";
import { newShotBug } from "./eating";
import { makeFallingBug } from "./falling";
import type { Obstacle } from "./obstacles";
import { NO_BUG, NO_OBSTACLE, newSpitter, trySpit } from "./spit";
import type { SpitContext } from "./spit";

const base = makeBugSpec(1, 0, []);

/** A stationary bug at a fixed place, alive from `spawn` to `despawn`. */
const staticBug = (id: number, x: number, y: number, z: number, spawn = 0, despawn = 100): BugSpec => ({
  ...base,
  id,
  perched: true,
  perchX: x,
  perchY: y,
  perchZ: z,
  spawnTime: spawn,
  despawnTime: despawn,
});

const ctxOf = (bugs: BugSpec[], obstacles: Obstacle[] = [], shot: SpitContext["shot"] = []): SpitContext => ({
  seed: 1,
  bugs,
  shot,
  obstacles,
});

/** Yaw and pitch that point from a fish at (fx, fz) to the point (x, y, z). */
function aimAt(fx: number, fz: number, x: number, y: number, z: number) {
  const dx = x - fx;
  const dz = z - fz;
  return { yaw: Math.atan2(dz, dx), pitch: Math.atan2(y - SPIT_ORIGIN_Y, Math.hypot(dx, dz)) };
}

describe("spit", () => {
  it("hits a bug in the line of fire", () => {
    const fish = newSpitter(0, 0);
    const aim = aimAt(0, 0, 3, 1.5, 0);
    const res = trySpit(fish, aim.yaw, aim.pitch, ctxOf([staticBug(5, 3, 1.5, 0)]), 10);
    expect(res.fired).toBe(true);
    expect(res.hit).not.toBeNull();
    expect(res.bugId).toBe(5);
    expect(res.blockedBy).toBe(NO_OBSTACLE);
    expect(res.hit!.fall.bugId).toBe(5);
    expect(res.hit!.fall.hitTime).toBe(10);
    expect(res.hit!.fall.startX).toBeCloseTo(3);
    expect(res.hit!.fall.startY).toBeCloseTo(1.5);
    expect(res.length).toBeCloseTo(Math.hypot(3, 1.5 - SPIT_ORIGIN_Y) - BUG_HIT_RADIUS, 5);
    expect(fish.shots).toBe(1);
    expect(fish.hits).toBe(1);
    expect(fish.nextSpitTime).toBeCloseTo(10 + SPIT_COOLDOWN);
  });

  it("misses when aimed away and travels the full range", () => {
    const fish = newSpitter(0, 0);
    const aim = aimAt(0, 0, 3, 1.5, 0);
    const res = trySpit(fish, aim.yaw + 0.5, aim.pitch, ctxOf([staticBug(5, 3, 1.5, 0)]), 10);
    expect(res.fired).toBe(true);
    expect(res.hit).toBeNull();
    expect(res.bugId).toBe(NO_BUG);
    expect(res.blockedBy).toBe(NO_OBSTACLE);
    expect(res.length).toBeCloseTo(SPIT_RANGE);
    expect(fish.shots).toBe(1);
    expect(fish.hits).toBe(0);
  });

  it("respects the range limit", () => {
    const near = aimAt(0, 0, 7.5, 1, 0);
    expect(trySpit(newSpitter(), near.yaw, near.pitch, ctxOf([staticBug(1, 7.5, 1, 0)]), 10).hit).not.toBeNull();
    const far = aimAt(0, 0, 9, 1, 0);
    const res = trySpit(newSpitter(), far.yaw, far.pitch, ctxOf([staticBug(1, 9, 1, 0)]), 10);
    expect(res.hit).toBeNull();
    expect(res.length).toBeCloseTo(SPIT_RANGE);
  });

  it("the nearest bug on the ray wins", () => {
    // Both bugs sit on the same ray: at x = 5 the ray height is 0.3 + 0.4 * 5 = 2.3.
    const bugs = [staticBug(2, 5, 2.3, 0), staticBug(1, 3, 1.5, 0)];
    const aim = aimAt(0, 0, 3, 1.5, 0);
    expect(trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf(bugs), 10).bugId).toBe(1);
  });

  it("skips bugs that were already shot", () => {
    const bugs = [staticBug(1, 3, 1.5, 0), staticBug(2, 5, 2.3, 0)];
    const shot = [newShotBug(makeFallingBug(1, 1, 5, { x: 3, y: 1.5, z: 0 }))];
    const aim = aimAt(0, 0, 3, 1.5, 0);
    expect(trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf(bugs, [], shot), 10).bugId).toBe(2);
  });

  it("ignores bugs that are not alive at that time", () => {
    const bugs = [staticBug(1, 3, 1.5, 0, 10, 20)];
    const aim = aimAt(0, 0, 3, 1.5, 0);
    expect(trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf(bugs), 5).hit).toBeNull();
    expect(trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf(bugs), 25).hit).toBeNull();
    expect(trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf(bugs), 15).hit).not.toBeNull();
  });

  it("enforces the cooldown", () => {
    const fish = newSpitter();
    const ctx = ctxOf([]);
    expect(trySpit(fish, 0, 0.2, ctx, 10).fired).toBe(true);
    expect(trySpit(fish, 0, 0.2, ctx, 10.5).fired).toBe(false);
    expect(fish.shots).toBe(1);
    expect(trySpit(fish, 0, 0.2, ctx, 10 + SPIT_COOLDOWN).fired).toBe(true);
    expect(fish.shots).toBe(2);
  });

  it("rejects invalid aim without using up the cooldown", () => {
    const fish = newSpitter();
    expect(trySpit(fish, NaN, 0.2, ctxOf([]), 10).fired).toBe(false);
    expect(trySpit(fish, 0, Infinity, ctxOf([]), 10).fired).toBe(false);
    expect(fish.shots).toBe(0);
    expect(fish.nextSpitTime).toBe(0);
  });

  it("clamps pitch to the allowed range", () => {
    const up = trySpit(newSpitter(), 0, 5, ctxOf([]), 10);
    expect(up.endY).toBeCloseTo(SPIT_ORIGIN_Y + Math.sin(SPIT_PITCH_MAX) * SPIT_RANGE, 5);
    const down = trySpit(newSpitter(), 0, -1, ctxOf([]), 10);
    expect(down.endY).toBeCloseTo(SPIT_ORIGIN_Y, 5);
  });

  it("a reed blocks the jet and the jet ends at the reed", () => {
    const reed: Obstacle = { id: 3, kind: "reed", x: 2, z: 0, radius: 0.4 };
    const aim = aimAt(0, 0, 5, 1, 0);
    const fish = newSpitter();
    const res = trySpit(fish, aim.yaw, aim.pitch, ctxOf([staticBug(1, 5, 1, 0)], [reed]), 10);
    expect(res.hit).toBeNull();
    expect(res.blockedBy).toBe(3);
    expect(res.endX).toBeCloseTo(1.6, 5); // the near edge of the reed
    expect(fish.shots).toBe(1);
    expect(fish.hits).toBe(0);
  });

  it("a jet passes over a low rock", () => {
    const rock: Obstacle = { id: 2, kind: "rock", x: 2, z: 0, radius: 0.9 };
    const aim = aimAt(0, 0, 5, 3, 0);
    const res = trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf([staticBug(1, 5, 3, 0)], [rock]), 10);
    expect(res.blockedBy).toBe(NO_OBSTACLE);
    expect(res.bugId).toBe(1);
  });

  it("a perched bug is not blocked by the reed it sits on", () => {
    const reed: Obstacle = { id: 0, kind: "reed", x: 4, z: 0, radius: 0.4 };
    const aim = aimAt(0, 0, 4, REED_HEIGHT, 0);
    const res = trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf([staticBug(1, 4, REED_HEIGHT, 0)], [reed]), 10);
    expect(res.blockedBy).toBe(NO_OBSTACLE);
    expect(res.bugId).toBe(1);
  });

  it("but a reed in front of a bug that is not on it still blocks", () => {
    const reed: Obstacle = { id: 0, kind: "reed", x: 3.9, z: 0, radius: 0.4 };
    const aim = aimAt(0, 0, 4, REED_HEIGHT, 0);
    const res = trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf([staticBug(1, 4, REED_HEIGHT, 0)], [reed]), 10);
    expect(res.hit).toBeNull();
    expect(res.blockedBy).toBe(0);
  });

  it("lag compensation tests bugs where they were, with the rewind capped", () => {
    const spec = makeBugSpec(5, 0, []); // a flying bug, alive from t = 0 to t = 10
    const tmp: Vec3 = { x: 0, y: 0, z: 0 };
    const t = 5;

    bugPosition(spec, t - 0.12, tmp);
    let aim = aimAt(tmp.x + 3, tmp.z, tmp.x, tmp.y, tmp.z);
    const a = trySpit(newSpitter(tmp.x + 3, tmp.z), aim.yaw, aim.pitch, ctxOf([spec]), t, 0.12);
    expect(a.bugId).toBe(spec.id);
    expect(a.hit!.fall.startX).toBeCloseTo(tmp.x, 5);

    // A huge claimed rewind is capped at LAG_REWIND_MAX.
    bugPosition(spec, t - LAG_REWIND_MAX, tmp);
    aim = aimAt(tmp.x + 3, tmp.z, tmp.x, tmp.y, tmp.z);
    const b = trySpit(newSpitter(tmp.x + 3, tmp.z), aim.yaw, aim.pitch, ctxOf([spec]), t, 5);
    expect(b.bugId).toBe(spec.id);
  });

  it("is deterministic", () => {
    const run = () => {
      const aim = aimAt(0, 0, 3, 1.5, 0);
      return trySpit(newSpitter(), aim.yaw, aim.pitch, ctxOf([staticBug(5, 3, 1.5, 0)]), 10);
    };
    expect(run()).toEqual(run());
  });
});
