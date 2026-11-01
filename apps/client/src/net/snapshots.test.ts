import { describe, expect, it } from "vitest";
import type { WirePlayer } from "@spitfin/shared";
import { sampleFrames, type Frame, type Shown } from "./snapshots";

const p = (id: number, x: number, z: number, facing = 0): WirePlayer => ({
  id, x, z, vx: 0, vz: 0, facing, stash: 0, eaten: 0, shots: 0, hits: 0, nips: 0,
  spitCd: 0, nipCd: 0, dash: false, immune: false,
});
const frame = (tick: number, players: WirePlayer[]): Frame => ({ tick, t: tick / 30, players });

describe("sampleFrames", () => {
  it("blends the two snapshots around the time", () => {
    const frames = [frame(0, [p(0, 0, 0)]), frame(2, [p(0, 2, 4)])];
    const out: Shown[] = [];
    expect(sampleFrames(frames, 1 / 30, out)).toBe(true);
    expect(out[0]?.x).toBeCloseTo(1);
    expect(out[0]?.z).toBeCloseTo(2);
  });

  it("clamps before the first and after the last snapshot", () => {
    const frames = [frame(2, [p(0, 1, 1)]), frame(4, [p(0, 3, 3)])];
    const out: Shown[] = [];
    sampleFrames(frames, 0, out);
    expect(out[0]?.x).toBe(1);
    sampleFrames(frames, 10, out);
    expect(out[0]?.x).toBe(3);
  });

  it("turns the short way round and reports no frames", () => {
    const frames = [frame(0, [p(0, 0, 0, 3.0)]), frame(2, [p(0, 0, 0, -3.0)])];
    const out: Shown[] = [];
    sampleFrames(frames, 1 / 30, out);
    expect(Math.abs(out[0]?.facing ?? 0)).toBeCloseTo(Math.PI, 2);
    expect(sampleFrames([], 0, out)).toBe(false);
  });
});
