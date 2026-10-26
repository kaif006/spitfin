import { describe, it, expect } from "vitest";
import { MOUTH_RADIUS } from "./constants";
import type { Vec3 } from "./bugs";
import { expireTime, fallingBugPosition, landTime, makeFallingBug } from "./falling";
import type { EatEvent, Eater } from "./eating";
import { NOT_EATEN, newShotBug, pickEater, resolveEating } from "./eating";

const tmp: Vec3 = { x: 0, y: 0, z: 0 };
const mkFish = (id: number, x: number, z: number): Eater => ({ id, x, z, stash: 0, bugsEaten: 0 });

/** A bug that is floating at time `t`, with its position at that time. */
function floatingBug(bugId = 0, hitPos: Vec3 = { x: 0, y: 2, z: 0 }) {
  const fall = makeFallingBug(1, bugId, 0, hitPos);
  const t = landTime(fall) + 0.5;
  fallingBugPosition(fall, t, tmp);
  return { shot: newShotBug(fall), t, x: tmp.x, z: tmp.z };
}

describe("eating", () => {
  it("a fish within the mouth radius eats a floating bug", () => {
    const b = floatingBug();
    const f = mkFish(3, b.x + 0.3, b.z);
    expect(resolveEating([b.shot], [f], b.t)).toBe(1);
    expect(b.shot.eatenBy).toBe(3);
    expect(f.stash).toBe(1);
    expect(f.bugsEaten).toBe(1);
  });

  it("a fish outside the mouth radius eats nothing", () => {
    const b = floatingBug();
    const f = mkFish(1, b.x + MOUTH_RADIUS + 0.05, b.z);
    expect(resolveEating([b.shot], [f], b.t)).toBe(0);
    expect(b.shot.eatenBy).toBe(NOT_EATEN);
    expect(f.stash).toBe(0);
  });

  it("a bug cannot be eaten while it is still falling", () => {
    const fall = makeFallingBug(1, 0, 0, { x: 0, y: 2, z: 0 });
    const t = landTime(fall) - 0.1;
    fallingBugPosition(fall, t, tmp);
    const f = mkFish(1, tmp.x, tmp.z);
    expect(resolveEating([newShotBug(fall)], [f], t)).toBe(0);
    expect(f.stash).toBe(0);
  });

  it("a bug cannot be eaten after it expires", () => {
    const b = floatingBug();
    const f = mkFish(1, b.x, b.z);
    expect(resolveEating([b.shot], [f], expireTime(b.shot.fall) + 0.1)).toBe(0);
    expect(f.stash).toBe(0);
  });

  it("the closest fish wins a contested bug", () => {
    const b = floatingBug();
    const near = mkFish(9, b.x + 0.1, b.z);
    const far = mkFish(1, b.x + 0.5, b.z);
    resolveEating([b.shot], [far, near], b.t);
    expect(b.shot.eatenBy).toBe(9);
    expect(near.stash).toBe(1);
    expect(far.stash).toBe(0);
  });

  it("an exact distance tie goes to the lower id, whatever the array order", () => {
    for (const order of [[5, 2], [2, 5]]) {
      const b = floatingBug();
      const fish = order.map((id) => mkFish(id, b.x + 0.3, b.z));
      expect(pickEater(b.x, b.z, fish)?.id).toBe(2);
      resolveEating([b.shot], fish, b.t);
      expect(b.shot.eatenBy).toBe(2);
    }
  });

  it("a bug is eaten only once", () => {
    const b = floatingBug();
    const f = mkFish(1, b.x, b.z);
    expect(resolveEating([b.shot], [f], b.t)).toBe(1);
    expect(resolveEating([b.shot], [f], b.t + 0.1)).toBe(0);
    expect(f.stash).toBe(1);
    expect(f.bugsEaten).toBe(1);
  });

  it("each bug goes to the fish standing at it", () => {
    const fall1 = makeFallingBug(1, 1, 0, { x: -5, y: 2, z: 0 });
    const fall2 = makeFallingBug(1, 2, 0, { x: 5, y: 2, z: 0 });
    const t = 2;
    fallingBugPosition(fall1, t, tmp);
    const a = mkFish(0, tmp.x, tmp.z);
    fallingBugPosition(fall2, t, tmp);
    const b = mkFish(1, tmp.x, tmp.z);
    const shot = [newShotBug(fall1), newShotBug(fall2)];
    expect(resolveEating(shot, [a, b], t)).toBe(2);
    expect(shot[0].eatenBy).toBe(0);
    expect(shot[1].eatenBy).toBe(1);
  });

  it("records an event for every eaten bug", () => {
    const b = floatingBug(7);
    const f = mkFish(4, b.x, b.z);
    const events: EatEvent[] = [];
    resolveEating([b.shot], [f], b.t, events);
    expect(events).toEqual([{ bugId: 7, playerId: 4 }]);
  });

  it("does nothing when there are no fish or no bugs", () => {
    const b = floatingBug();
    expect(resolveEating([b.shot], [], b.t)).toBe(0);
    expect(resolveEating([], [mkFish(1, 0, 0)], 5)).toBe(0);
  });
});
