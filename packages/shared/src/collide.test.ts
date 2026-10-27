import { describe, it, expect } from "vitest";
import { ARENA, FISH_RADIUS, ROCK_RADIUS } from "./constants";
import { collideFish } from "./collide";
import type { FishBody } from "./collide";
import { makeSimInput, newSim, stepSim } from "./match";
import type { Obstacle } from "./obstacles";
import { mulberry32 } from "./rng";

const rock: Obstacle = { id: 0, kind: "rock", x: 0, z: 0, radius: ROCK_RADIUS };
const MIN = ROCK_RADIUS + FISH_RADIUS;
const body = (x: number, z: number, vx = 0, vz = 0): FishBody => ({ x, z, vx, vz });

describe("collideFish", () => {
  it("pushes a fish out to the contact distance, along the line of centres", () => {
    const f = body(0.5, 0);
    collideFish(f, [rock]);
    expect(f.x).toBeCloseTo(MIN);
    expect(f.z).toBeCloseTo(0);
  });

  it("removes only the velocity pointing into the obstacle, so the fish slides", () => {
    const f = body(-1, 0.5, 2, 0);
    const d = Math.hypot(1, 0.5);
    collideFish(f, [rock]);
    const nx = -1 / d;
    const nz = 0.5 / d;
    expect(f.vx * nx + f.vz * nz).toBeCloseTo(0); // nothing left pointing into the rock
    expect(Math.hypot(f.vx, f.vz)).toBeCloseTo(2 * nz); // the sideways part is kept
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(MIN);
  });

  it("leaves a fish that is not touching alone", () => {
    const f = body(MIN + 0.5, 0, 1, 0);
    collideFish(f, [rock]);
    expect(f).toEqual(body(MIN + 0.5, 0, 1, 0));
  });

  it("keeps the velocity of a fish that is moving away from the obstacle", () => {
    const f = body(1, 0, 3, 0);
    collideFish(f, [rock]);
    expect(f.vx).toBe(3);
    expect(f.x).toBeCloseTo(MIN);
  });

  it("copes with a fish exactly on an obstacle's centre", () => {
    const f = body(0, 0, 1, 0);
    collideFish(f, [rock]);
    expect(Number.isFinite(f.x) && Number.isFinite(f.z)).toBe(true);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(MIN);
  });
});

describe("collision inside the sim", () => {
  it("a fish driven straight at a rock stops at the contact distance", () => {
    const s = newSim(1, [1]);
    s.obstacles.length = 0;
    s.obstacles.push(rock);
    const p = s.players[0];
    p.x = -4;
    p.z = 0;
    for (let i = 0; i < 150; i++) stepSim(s, [makeSimInput({ ax: 1 })]);
    expect(p.x).toBeCloseTo(-MIN, 5);
    expect(p.z).toBeCloseTo(0, 5);
  });

  it("fish never end a tick inside an obstacle or outside the arena", () => {
    const s = newSim(21, [1, 2, 3]);
    const rng = mulberry32(9);
    for (let tick = 0; tick < 600; tick++) {
      stepSim(s, s.players.map(() => makeSimInput({ ax: rng() * 2 - 1, az: rng() * 2 - 1 })));
      for (const p of s.players) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(ARENA.w / 2);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(ARENA.h / 2);
        for (const o of s.obstacles) {
          expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThanOrEqual(o.radius + FISH_RADIUS - 0.05);
        }
      }
    }
  });
});
