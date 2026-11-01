import { describe, expect, it } from "vitest";
import { newSim } from "@spitfin/shared";
import { buildMatchRecord } from "./record.js";

describe("buildMatchRecord", () => {
  it("maps sim players to users and ranks them", () => {
    const sim = newSim(7, [0, 1]);
    sim.players[0]!.stash = 1;
    sim.players[1]!.stash = 3;
    sim.players[1]!.bugsEaten = 3;
    const r = buildMatchRecord(sim, 7, ["u0", "u1"], new Date(0));
    expect(r.seed).toBe(7);
    expect(r.players.map((p) => [p.userId, p.placement])).toEqual([["u0", 2], ["u1", 1]]);
    expect(r.players[1]!.finalStash).toBe(3);
    expect(r.players[1]!.bugsEaten).toBe(3);
  });

  it("gives exact ties the same placement", () => {
    const r = buildMatchRecord(newSim(7, [0, 1]), 7, ["u0", "u1"], new Date(0));
    expect(r.players.map((p) => p.placement)).toEqual([1, 1]);
  });
});
