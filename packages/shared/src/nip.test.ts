import { describe, it, expect } from "vitest";
import { NIP_CONE_DEG, NIP_COOLDOWN, NIP_DURATION, NIP_IMMUNITY, NIP_RANGE } from "./constants";
import type { Nipper } from "./nip";
import { NO_VICTIM, isDashing, isImmune, newNipper, tryNip, updateFacing } from "./nip";

/** A fish at (x, z) with the given stash, facing +x unless told otherwise. */
const mk = (id: number, x: number, z: number, stash = 0, facing = 0): Nipper => {
  const n = newNipper(id, x, z, facing);
  n.stash = stash;
  return n;
};

describe("nip", () => {
  it("steals one bug from a fish in front within range", () => {
    const thief = mk(1, 0, 0);
    const victim = mk(2, 1, 0, 2);
    const res = tryNip(thief, [thief, victim], 10);
    expect(res).toEqual({ fired: true, victimId: 2, stolen: 1 });
    expect(thief.stash).toBe(1);
    expect(victim.stash).toBe(1);
    expect(thief.steals).toBe(1);
    expect(thief.nipsUsed).toBe(1);
    expect(thief.lastVictimId).toBe(2);
    expect(victim.timesNipped).toBe(1);
    expect(victim.immuneUntil).toBeCloseTo(10 + NIP_IMMUNITY);
    expect(thief.nipReadyTime).toBeCloseTo(10 + NIP_COOLDOWN);
  });

  it("misses a fish behind the thief", () => {
    const thief = mk(1, 0, 0);
    const victim = mk(2, -1, 0, 2);
    const res = tryNip(thief, [victim], 10);
    expect(res.fired).toBe(true);
    expect(res.victimId).toBe(NO_VICTIM);
    expect(victim.stash).toBe(2);
    expect(thief.stash).toBe(0);
  });

  it("misses a fish out of range and hits one just inside it", () => {
    const out = mk(2, NIP_RANGE + 0.1, 0, 2);
    expect(tryNip(mk(1, 0, 0), [out], 10).victimId).toBe(NO_VICTIM);
    const inside = mk(3, NIP_RANGE - 0.1, 0, 2);
    expect(tryNip(mk(1, 0, 0), [inside], 10).victimId).toBe(3);
  });

  it("the cone is NIP_CONE_DEG wide: just inside the edge hits, just outside misses", () => {
    const half = NIP_CONE_DEG / 2;
    const at = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return mk(2, Math.cos(a), Math.sin(a), 2);
    };
    expect(tryNip(mk(1, 0, 0), [at(half - 2)], 10).victimId).toBe(2);
    expect(tryNip(mk(1, 0, 0), [at(-(half - 2))], 10).victimId).toBe(2);
    expect(tryNip(mk(1, 0, 0), [at(half + 2)], 10).victimId).toBe(NO_VICTIM);
    expect(tryNip(mk(1, 0, 0), [at(-(half + 2))], 10).victimId).toBe(NO_VICTIM);
  });

  it("an immune fish cannot be nipped until its immunity ends", () => {
    const victim = mk(2, 1, 0, 3);
    victim.immuneUntil = 12;
    expect(isImmune(victim, 11.9)).toBe(true);
    expect(isImmune(victim, 12)).toBe(false);
    expect(tryNip(mk(1, 0, 0), [victim], 10).victimId).toBe(NO_VICTIM);
    expect(tryNip(mk(3, 0, 0), [victim], 12).victimId).toBe(2);
  });

  it("enforces the cooldown", () => {
    const thief = mk(1, 0, 0);
    const victim = mk(2, 1, 0, 5);
    expect(tryNip(thief, [victim], 10).fired).toBe(true);
    expect(tryNip(thief, [victim], 10 + NIP_COOLDOWN - 0.1).fired).toBe(false);
    expect(thief.nipsUsed).toBe(1);
    expect(tryNip(thief, [victim], 10 + NIP_COOLDOWN).fired).toBe(true);
    expect(thief.nipsUsed).toBe(2);
  });

  it("a whiff still spends the cooldown and counts as a nip used", () => {
    const thief = mk(1, 0, 0);
    const res = tryNip(thief, [], 10);
    expect(res).toEqual({ fired: true, victimId: NO_VICTIM, stolen: 0 });
    expect(thief.nipsUsed).toBe(1);
    expect(thief.steals).toBe(0);
    expect(thief.lastVictimId).toBe(NO_VICTIM);
    expect(thief.nipReadyTime).toBeCloseTo(10 + NIP_COOLDOWN);
  });

  it("cannot nip the same victim twice in a row", () => {
    const thief = mk(1, 0, 0);
    const victim = mk(2, 1, 0, 5);
    expect(tryNip(thief, [victim], 10).victimId).toBe(2);
    const second = tryNip(thief, [victim], 10 + NIP_COOLDOWN);
    expect(second.fired).toBe(true);
    expect(second.victimId).toBe(NO_VICTIM);
    expect(victim.stash).toBe(4);
    expect(thief.nipsUsed).toBe(2);
  });

  it("can nip a victim again after nipping someone else in between", () => {
    const thief = mk(1, 0, 0);
    const a = mk(2, 1, 0.1, 5); // a bit closer
    const b = mk(3, 1.2, -0.1, 5);
    expect(tryNip(thief, [a, b], 10).victimId).toBe(2);
    expect(tryNip(thief, [a, b], 13).victimId).toBe(3); // a is locked out, b is valid
    expect(tryNip(thief, [a, b], 16).victimId).toBe(2); // the lockout moved on to b
  });

  it("a fish with an empty stash is not a target", () => {
    const thief = mk(1, 0, 0);
    const victim = mk(2, 1, 0, 0);
    const res = tryNip(thief, [victim], 10);
    expect(res.fired).toBe(true);
    expect(res.victimId).toBe(NO_VICTIM);
    expect(victim.immuneUntil).toBe(0);
    expect(victim.timesNipped).toBe(0);
  });

  it("the closest valid fish is chosen, and an exact tie goes to the lower id", () => {
    const near = mk(9, 0.8, 0, 2);
    const far = mk(1, 1.3, 0, 2);
    expect(tryNip(mk(5, 0, 0), [far, near], 10).victimId).toBe(9);

    for (const order of [[5, 2], [2, 5]]) {
      const fish = order.map((id, i) => mk(id, 1, i === 0 ? 0.2 : -0.2, 1));
      expect(tryNip(mk(7, 0, 0), fish, 10).victimId).toBe(2);
    }
  });

  it("an immune fish in front does not shield a valid fish behind it", () => {
    const shield = mk(1, 0.8, 0, 2);
    shield.immuneUntil = 100;
    const target = mk(2, 1.3, 0, 3);
    expect(tryNip(mk(7, 0, 0), [shield, target], 10).victimId).toBe(2);
  });

  it("never targets itself", () => {
    const thief = mk(1, 0, 0, 5);
    const res = tryNip(thief, [thief], 10);
    expect(res.fired).toBe(true);
    expect(res.victimId).toBe(NO_VICTIM);
    expect(thief.stash).toBe(5);
  });

  it("the dash lasts NIP_DURATION", () => {
    const thief = mk(1, 0, 0);
    expect(isDashing(thief, 10)).toBe(false);
    tryNip(thief, [], 10);
    expect(isDashing(thief, 10.1)).toBe(true);
    expect(isDashing(thief, 10 + NIP_DURATION)).toBe(false);
  });

  it("updateFacing follows movement input and ignores tiny input", () => {
    const n = mk(1, 0, 0);
    updateFacing(n, 0, 1);
    expect(n.facing).toBeCloseTo(Math.PI / 2);
    updateFacing(n, 0.01, 0);
    expect(n.facing).toBeCloseTo(Math.PI / 2);
    updateFacing(n, NaN, 0);
    expect(n.facing).toBeCloseTo(Math.PI / 2);
    updateFacing(n, -1, 0);
    expect(n.facing).toBeCloseTo(Math.PI);
  });
});
