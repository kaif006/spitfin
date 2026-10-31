import { describe, expect, it } from "vitest";
import { LAG_REWIND_MAX } from "@spitfin/shared";
import { RTT_SMOOTHING, rewindFromRtt, smoothRtt } from "./lag.js";

describe("rewindFromRtt", () => {
  it("is half the round trip, in seconds", () => {
    expect(rewindFromRtt(100)).toBeCloseTo(0.05, 10);
  });

  it("never exceeds the cap", () => {
    expect(rewindFromRtt(10_000)).toBe(LAG_REWIND_MAX);
  });

  it("is zero for nonsense", () => {
    for (const bad of [0, -5, NaN, Infinity]) expect(rewindFromRtt(bad)).toBe(0);
  });
});

describe("smoothRtt", () => {
  it("takes the first sample as it is, then blends later ones", () => {
    expect(smoothRtt(null, 100)).toBe(100);
    expect(smoothRtt(100, 200)).toBeCloseTo(100 + 100 * RTT_SMOOTHING, 10);
  });

  it("ignores a bad sample", () => {
    expect(smoothRtt(80, NaN)).toBe(80);
    expect(smoothRtt(80, -1)).toBe(80);
    expect(smoothRtt(null, NaN)).toBe(0);
  });
});
