import { describe, it, expect } from "vitest";
import { BUG_MAX_ALIVE, BUG_SPAWN_INTERVAL, MATCH_DURATION, SPAWN_CLEAR_RADIUS, SPIT_ORIGIN_Y, TICK_HZ } from "./constants";
import { bugPosition } from "./bugs";
import { fallingBugPhase, fallingBugPosition } from "./falling";
import { mulberry32 } from "./rng";
import type { SimEvent } from "./match";
import { SIM_MATCH_TICKS, SIM_SPAWN_RING, makeSimInput, newSim, simAliveBugs, simRanking, stepSim } from "./match";

describe("sim setup", () => {
  it("sorts players by id", () => {
    expect(newSim(1, [3, 1, 2]).players.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("rejects duplicate player ids", () => {
    expect(() => newSim(1, [1, 2, 2])).toThrow();
  });

  it("puts players on the spawn ring, facing outward, clear of obstacles", () => {
    const s = newSim(11, [1, 2, 3]);
    for (const p of s.players) {
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(SIM_SPAWN_RING);
      expect(SIM_SPAWN_RING).toBeLessThan(SPAWN_CLEAR_RADIUS);
      expect(p.facing).toBeCloseTo(Math.atan2(p.z, p.x));
      for (const o of s.obstacles) expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThan(o.radius);
    }
  });
});

describe("bug schedule and match clock", () => {
  it("spawns bug 0 at the start and one more every second", () => {
    const s = newSim(2, [1]);
    expect(s.bugs.length).toBe(1);
    for (let i = 0; i < TICK_HZ - 1; i++) stepSim(s, []);
    expect(s.bugs.length).toBe(1);
    stepSim(s, []);
    expect(s.bugs.length).toBe(2);
    for (let i = 0; i < 9 * TICK_HZ; i++) stepSim(s, []);
    expect(s.bugs.length).toBe(11);
  });

  it("never has more than BUG_MAX_ALIVE bugs, and stops spawning when the match ends", () => {
    const s = newSim(3, [1]);
    let maxAlive = simAliveBugs(s);
    for (let i = 0; i < SIM_MATCH_TICKS; i++) {
      stepSim(s, []);
      maxAlive = Math.max(maxAlive, simAliveBugs(s));
    }
    expect(maxAlive).toBeGreaterThan(0);
    expect(maxAlive).toBeLessThanOrEqual(BUG_MAX_ALIVE);
    expect(s.bugs.length).toBe(Math.ceil(MATCH_DURATION / BUG_SPAWN_INTERVAL));
  });

  it("ends exactly at MATCH_DURATION and then ignores further steps", () => {
    const s = newSim(4, [1]);
    for (let i = 0; i < SIM_MATCH_TICKS - 1; i++) stepSim(s, []);
    expect(s.over).toBe(false);
    stepSim(s, []);
    expect(s.over).toBe(true);
    expect(s.time).toBe(MATCH_DURATION);
    stepSim(s, []);
    expect(s.tick).toBe(SIM_MATCH_TICKS);
  });

  it("emits the end event once", () => {
    const s = newSim(4, [1]);
    const events: SimEvent[] = [];
    for (let i = 0; i < SIM_MATCH_TICKS + 5; i++) stepSim(s, [], events);
    expect(events.filter((e) => e.type === "end")).toHaveLength(1);
  });
});

describe("inputs", () => {
  it("moves the fish and turns it toward its movement", () => {
    const s = newSim(5, [1]);
    const p = s.players[0];
    p.x = 0;
    p.z = 0;
    for (let i = 0; i < 10; i++) stepSim(s, [makeSimInput({ ax: 1 })]);
    expect(p.x).toBeGreaterThan(0);
    expect(p.facing).toBeCloseTo(0);
    for (let i = 0; i < 10; i++) stepSim(s, [makeSimInput({ az: -1 })]);
    expect(p.facing).toBeCloseTo(-Math.PI / 2);
  });

  it("ignores invalid numbers", () => {
    const s = newSim(5, [1]);
    stepSim(s, [makeSimInput({ ax: NaN, az: Infinity, spit: true, yaw: NaN, pitch: 0 })]);
    const p = s.players[0];
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(p.shots).toBe(0);
  });

  it("treats missing inputs as idle", () => {
    const s = newSim(5, [1, 2]);
    const before = s.players.map((p) => [p.x, p.z]);
    stepSim(s, []);
    expect(s.players.map((p) => [p.x, p.z])).toEqual(before);
  });
});

describe("rules inside a tick", () => {
  it("a spit that hits starts a falling bug and emits an event", () => {
    const s = newSim(7, [10, 20]);
    s.obstacles.length = 0; // nothing in the way
    const bug = { ...bugPosition(s.bugs[0], 1 / TICK_HZ, { x: 0, y: 0, z: 0 }) };
    const len = Math.hypot(bug.x, bug.z);
    const ux = len > 1e-6 ? -bug.x / len : 1;
    const uz = len > 1e-6 ? -bug.z / len : 0;
    const shooter = s.players[0];
    shooter.x = bug.x + ux * 3;
    shooter.z = bug.z + uz * 3;
    const yaw = Math.atan2(bug.z - shooter.z, bug.x - shooter.x);
    const pitch = Math.atan2(bug.y - SPIT_ORIGIN_Y, 3);

    const events: SimEvent[] = [];
    stepSim(s, [makeSimInput({ spit: true, yaw, pitch })], events);

    expect(s.shot).toHaveLength(1);
    expect(s.shot[0].fall.bugId).toBe(0);
    expect(shooter.hits).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "spit", playerId: 10, hitBugId: 0 }));
  });

  it("a fish standing where a shot bug lands eats it", () => {
    const s = newSim(7, [10, 20]);
    s.obstacles.length = 0;
    const bug = { ...bugPosition(s.bugs[0], 1 / TICK_HZ, { x: 0, y: 0, z: 0 }) };
    const len = Math.hypot(bug.x, bug.z);
    const shooter = s.players[0];
    shooter.x = bug.x + (len > 1e-6 ? -bug.x / len : 1) * 3;
    shooter.z = bug.z + (len > 1e-6 ? -bug.z / len : 0) * 3;
    stepSim(s, [makeSimInput({
      spit: true,
      yaw: Math.atan2(bug.z - shooter.z, bug.x - shooter.x),
      pitch: Math.atan2(bug.y - SPIT_ORIGIN_Y, 3),
    })]);
    expect(s.shot).toHaveLength(1);

    const fall = s.shot[0].fall;
    while (fallingBugPhase(fall, (s.tick + 1) / TICK_HZ) !== "floating") stepSim(s, []);
    const land = fallingBugPosition(fall, (s.tick + 1) / TICK_HZ, { x: 0, y: 0, z: 0 });
    const eater = s.players[1];
    eater.x = land.x;
    eater.z = land.z;

    const events: SimEvent[] = [];
    stepSim(s, [], events);
    expect(s.shot[0].eatenBy).toBe(20);
    expect(eater.stash).toBe(1);
    expect(eater.bugsEaten).toBe(1);
    expect(events).toContainEqual({ type: "eat", bugId: 0, playerId: 20 });
  });

  it("a nip steals a bug and emits an event", () => {
    const s = newSim(1, [1, 2]);
    const [a, b] = s.players;
    a.x = 0; a.z = 0; a.facing = 0;
    b.x = 1; b.z = 0; b.stash = 2;
    const events: SimEvent[] = [];
    stepSim(s, [makeSimInput({ nip: true })], events);
    expect(a.stash).toBe(1);
    expect(b.stash).toBe(1);
    expect(events).toContainEqual({ type: "nip", thiefId: 1, victimId: 2 });
  });

  it("is deterministic over a long run with random inputs", () => {
    const TAU = Math.PI * 2;
    const run = () => {
      const s = newSim(99, [1, 2, 3]);
      const rng = mulberry32(5);
      for (let i = 0; i < 900; i++) {
        const inputs = s.players.map(() => makeSimInput({
          ax: rng() * 2 - 1,
          az: rng() * 2 - 1,
          spit: rng() < 0.1,
          yaw: rng() * TAU,
          pitch: rng() * 1.3,
          nip: rng() < 0.03,
        }));
        stepSim(s, inputs);
      }
      return s;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
    expect(a.players.some((p) => p.shots > 0)).toBe(true);
  });
});

describe("ranking", () => {
  it("ranks by stash", () => {
    const s = newSim(1, [1, 2, 3]);
    const [a, b, c] = s.players;
    a.stash = 1; b.stash = 3; c.stash = 2;
    const r = simRanking(s);
    expect(r.map((x) => x.id)).toEqual([2, 3, 1]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("breaks stash ties by bugs eaten, then by fewer nips used", () => {
    const s = newSim(1, [1, 2, 3]);
    const [a, b, c] = s.players;
    a.stash = 2; a.bugsEaten = 2; a.nipsUsed = 1;
    b.stash = 2; b.bugsEaten = 3; b.nipsUsed = 5;
    c.stash = 2; c.bugsEaten = 3; c.nipsUsed = 2;
    expect(simRanking(s).map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it("players tied on every key share a rank", () => {
    const s = newSim(1, [1, 2, 3]);
    const [a, b, c] = s.players;
    a.stash = 5; b.stash = 5; c.stash = 1;
    const r = simRanking(s);
    expect(r.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3]);
  });
});
