import { describe, expect, it } from "vitest";
import { ARENA, FISH_SPEED, NIP_DASH_SPEED, TICK_DT } from "./constants";
import { makeSimInput, newSim, stepSim } from "./match";
import { isDashing } from "./nip";

const idle = makeSimInput();

describe("stepSim with dashes and fish contact", () => {
  it("a nip dash carries the fish forward, ignores steering, and locks the facing", () => {
    const s = newSim(1, [0, 1]);
    const [a, b] = s.players;
    a.x = -1; a.z = 0; a.vx = 0; a.vz = 0; a.facing = 0;
    b.x = 8; b.z = 5; b.vx = 0; b.vz = 0;

    stepSim(s, [makeSimInput({ nip: true })]); // tick 1: the nip fires
    expect(isDashing(a, s.time + TICK_DT)).toBe(true);

    for (let i = 0; i < 7; i++) stepSim(s, [makeSimInput({ az: 1 })]); // ticks 2 to 8: steering is ignored
    expect(a.x).toBeCloseTo(-1 + 7 * NIP_DASH_SPEED * TICK_DT, 6);
    expect(a.z).toBeCloseTo(0, 9);
    expect(a.facing).toBe(0);
    expect(Math.hypot(a.vx, a.vz)).toBeCloseTo(NIP_DASH_SPEED, 6);

    stepSim(s, [makeSimInput({ az: 1 })]); // tick 9: the dash is over, steering works again
    expect(isDashing(a, s.time)).toBe(false);
    expect(a.facing).toBeCloseTo(Math.PI / 2, 9);
    expect(a.z).toBeGreaterThan(0);
  });

  it("a nip still steals when it connects, and the dash then shoves the victim instead of passing through", () => {
    const s = newSim(1, [0, 1]);
    const [a, b] = s.players;
    a.x = -0.5; a.z = 0; a.vx = 0; a.vz = 0; a.facing = 0;
    b.x = 0.3; b.z = 0; b.vx = 0; b.vz = 0; b.stash = 1;

    stepSim(s, [makeSimInput({ nip: true })]);
    expect(a.stash).toBe(1);
    expect(b.stash).toBe(0);

    for (let i = 0; i < 7; i++) stepSim(s, [idle]);
    expect(a.x).toBeLessThan(b.x); // never passed through
    expect(b.x).toBeGreaterThan(0.6); // was shoved forward from 0.3
    expect(b.x - a.x).toBeGreaterThan(0.1);
  });

  it("fish that start on top of each other are pushed apart over a few ticks", () => {
    const s = newSim(1, [0, 1]);
    const [a, b] = s.players;
    a.x = 0; a.z = 0; a.vx = 0; a.vz = 0;
    b.x = 0.2; b.z = 0; b.vx = 0; b.vz = 0;

    stepSim(s, []);
    expect(b.x - a.x).toBeGreaterThan(0.2);

    for (let i = 0; i < 60; i++) stepSim(s, []);
    expect(b.x - a.x).toBeGreaterThan(0.69);
    expect(a.x + b.x).toBeCloseTo(0.2, 6); // pushed equally, so the pair's centre stays put
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it("a pushed fish is still kept inside the arena", () => {
    const s = newSim(1, [0, 1]);
    const [a, b] = s.players;
    for (const f of [a, b]) {
      f.x = ARENA.w / 2 - 0.1;
      f.z = ARENA.h / 2 - 0.1;
      f.vx = 0;
      f.vz = 0;
    }
    stepSim(s, []);
    for (const f of [a, b]) {
      expect(Math.abs(f.x)).toBeLessThanOrEqual(ARENA.w / 2);
      expect(Math.abs(f.z)).toBeLessThanOrEqual(ARENA.h / 2);
    }
    expect(a.x).toBeLessThan(b.x);
  });

  it("a fish swimming into a stopped one shoves it, and both end up slower than top speed", () => {
    const s = newSim(1, [0, 1]);
    const [a, b] = s.players;
    a.x = -2; a.z = 0; a.vx = 0; a.vz = 0;
    b.x = 0; b.z = 0; b.vx = 0; b.vz = 0;
    for (let i = 0; i < 90; i++) stepSim(s, [makeSimInput({ ax: 1 })]);
    expect(b.x).toBeGreaterThan(0.5); // was moved
    expect(a.x).toBeLessThan(b.x);
    const speed = (b.x - 0) / (90 * TICK_DT);
    expect(speed).toBeLessThan(FISH_SPEED);
  });
});
