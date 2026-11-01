import { describe, expect, it } from "vitest";
import { RATING_START, ratingDeltas } from "./rating.js";

const P = (rating: number, rank: number) => ({ rating, rank });

describe("ratingDeltas", () => {
  it("moves two equal players by K/2", () => {
    expect(ratingDeltas([P(1000, 1), P(1000, 2)])).toEqual([12, -12]);
  });

  it("splits four equal players 12, 4, -4, -12", () => {
    expect(ratingDeltas([P(1000, 1), P(1000, 2), P(1000, 3), P(1000, 4)])).toEqual([12, 4, -4, -12]);
  });

  it("is zero-sum for equal ratings", () => {
    const d = ratingDeltas([P(1000, 1), P(1000, 2), P(1000, 3)]);
    expect(d.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("gives an exact tie no change between equal ratings", () => {
    expect(ratingDeltas([P(1000, 1), P(1000, 1)])).toEqual([0, 0]);
  });

  it("rewards an upset more than an expected win", () => {
    const upset = ratingDeltas([P(800, 1), P(1200, 2)])[0]!;
    const expected = ratingDeltas([P(1200, 1), P(800, 2)])[0]!;
    expect(upset).toBe(22);
    expect(expected).toBe(2);
    expect(upset).toBeGreaterThan(expected);
  });

  it("does not depend on input order", () => {
    const a = [P(900, 2), P(1100, 1), P(1000, 3)];
    const d = ratingDeltas(a);
    const rev = ratingDeltas([...a].reverse()).reverse();
    expect(rev).toEqual(d);
  });

  it("returns 0 for a single player and treats bad ratings as the start rating", () => {
    expect(ratingDeltas([P(1000, 1)])).toEqual([0]);
    expect(ratingDeltas([P(NaN, 1), P(RATING_START, 2)])).toEqual([12, -12]);
  });
});
