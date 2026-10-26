import { describe, it, expect } from "vitest";
import { makeBugSpec, bugPosition, type Vec3 } from "./bugs";
import { generateObstacles } from "./obstacles";
import {
  ARENA,
  BUG_HEIGHT_MAX,
  BUG_HEIGHT_MIN,
  BUG_LIFETIME,
  BUG_SPAWN_INTERVAL,
  FLIGHT_MARGIN,
  REED_HEIGHT,
} from "./constants";

const SEED = 12345;
const obstacles = generateObstacles(SEED);
const tmp = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe("makeBugSpec", () => {
  it("spawns on a fixed schedule and despawns after the lifetime", () => {
    const s = makeBugSpec(SEED, 7, obstacles);
    expect(s.spawnTime).toBe(7 * BUG_SPAWN_INTERVAL);
    expect(s.despawnTime).toBe(s.spawnTime + BUG_LIFETIME);
  });

  it("is deterministic", () => {
    expect(makeBugSpec(SEED, 9, obstacles)).toEqual(makeBugSpec(SEED, 9, obstacles));
  });

  it("makes about 25% of bugs perched", () => {
    let perched = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (makeBugSpec(SEED, i, obstacles).perched) perched++;
    expect(perched / n).toBeGreaterThan(0.21);
    expect(perched / n).toBeLessThan(0.29);
  });

  it("never perches when there are no reeds", () => {
    for (let i = 0; i < 500; i++) expect(makeBugSpec(SEED, i, []).perched).toBe(false);
  });
});

describe("bugPosition", () => {
  it("keeps flying bugs inside the arena and the 1 to 3 height band", () => {
    const p = tmp();
    for (let i = 0; i < 300; i++) {
      const s = makeBugSpec(SEED, i, obstacles);
      if (s.perched) continue;
      for (let age = 0; age <= BUG_LIFETIME; age += 0.25) {
        bugPosition(s, s.spawnTime + age, p);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(ARENA.w / 2 - FLIGHT_MARGIN + 1e-9);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(ARENA.h / 2 - FLIGHT_MARGIN + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(BUG_HEIGHT_MIN - 1e-9);
        expect(p.y).toBeLessThanOrEqual(BUG_HEIGHT_MAX + 1e-9);
      }
    }
  });

  it("actually moves flying bugs", () => {
    let i = 0;
    let s = makeBugSpec(SEED, i, obstacles);
    while (s.perched) s = makeBugSpec(SEED, ++i, obstacles);
    const a = bugPosition(s, s.spawnTime, tmp());
    const b = bugPosition(s, s.spawnTime + 3, tmp());
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.1);
  });

  it("keeps perched bugs still, on top of a reed", () => {
    let found = 0;
    for (let i = 0; i < 200 && found < 5; i++) {
      const s = makeBugSpec(SEED, i, obstacles);
      if (!s.perched) continue;
      found++;
      const a = bugPosition(s, s.spawnTime, tmp());
      const b = bugPosition(s, s.spawnTime + 8, tmp());
      expect(a).toEqual(b);
      expect(a.y).toBe(REED_HEIGHT);
      expect(obstacles.some((o) => o.kind === "reed" && o.x === a.x && o.z === a.z)).toBe(true);
    }
    expect(found).toBeGreaterThan(0);
  });
});
