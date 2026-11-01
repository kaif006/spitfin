import { describe, expect, it } from "vitest";
import { makeSimInput, newSim, stepSim } from "@spitfin/shared";
import type { SimPlayer, WirePlayer } from "@spitfin/shared";
import { Predictor, type PredInput } from "./predict";

const wire = (b: Pick<SimPlayer, "x" | "z" | "vx" | "vz" | "facing">): WirePlayer => ({
  id: 0, x: b.x, z: b.z, vx: b.vx, vz: b.vz, facing: b.facing,
  stash: 0, eaten: 0, shots: 0, hits: 0, nips: 0, spitCd: 0, nipCd: 0, dash: false, immune: false,
});
const script = (i: number): PredInput => ({
  ax: i < 60 ? 1 : -1,
  az: i % 40 < 20 ? 0.5 : -0.5,
  nip: i === 10 || i === 50 || i === 110, // the one at 50 lands on the cooldown and must be ignored
});

describe("Predictor", () => {
  it("follows the real sim tick for tick, including a nip dash and its cooldown", () => {
    const sim = newSim(7, [0]);
    const pred = new Predictor(sim.obstacles);
    pred.reset(wire(sim.players[0]!));
    for (let i = 1; i <= 150; i++) {
      const inp = script(i);
      stepSim(sim, [makeSimInput(inp)]);
      pred.step(inp);
      pred.commit(i, inp);
      expect(pred.body.x).toBeCloseTo(sim.players[0]!.x, 6);
      expect(pred.body.z).toBeCloseTo(sim.players[0]!.z, 6);
    }
  });

  it("takes the server's state and replays only the unacknowledged inputs", () => {
    const a = new Predictor([]);
    a.reset(wire({ x: 0, z: 0, vx: 0, vz: 0, facing: 0 }));
    for (let i = 1; i <= 3; i++) {
      a.step(script(i));
      a.commit(i, script(i));
    }
    const server = { ...wire(a.body), x: a.body.x + 1 };

    const b = new Predictor([]);
    b.reset(wire({ x: 0, z: 0, vx: 0, vz: 0, facing: 0 }));
    for (let i = 1; i <= 5; i++) {
      b.step(script(i));
      b.commit(i, script(i));
    }
    b.reconcile(server, 3);

    const c = new Predictor([]);
    c.reset(server);
    c.step(script(4));
    c.step(script(5));
    expect(b.unacked).toBe(2);
    expect(b.body.x).toBeCloseTo(c.body.x, 9);
    expect(b.body.z).toBeCloseTo(c.body.z, 9);
  });

  it("forgets unacknowledged inputs when the server's counter goes back (reconnect)", () => {
    const p = new Predictor([]);
    p.reset(wire({ x: 0, z: 0, vx: 0, vz: 0, facing: 0 }));
    for (let i = 1; i <= 4; i++) {
      p.step(script(i));
      p.commit(i, script(i));
    }
    p.reconcile(wire(p.body), 2);
    expect(p.unacked).toBe(2);
    p.reconcile(wire(p.body), -1);
    expect(p.unacked).toBe(0);
  });
});
