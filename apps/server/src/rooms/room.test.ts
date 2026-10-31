import { describe, expect, it, vi } from "vitest";
import {
  SIM_MATCH_TICKS,
  TICK_HZ,
  bugPosition,
  decodeServer,
  makeFallingBug,
  makeSimInput,
  newSim,
  spitAim,
  stepSim,
} from "@spitfin/shared";
import type { ServerMsg, Vec3 } from "@spitfin/shared";
import { MAX_CATCHUP_TICKS, MAX_HOLD_TICKS, MAX_INPUT_QUEUE, Room } from "./room.js";
import type { InputMsg, RoomOptions } from "./room.js";

type SnapMsg = Extract<ServerMsg, { t: "snap" }>;
type StartMsg = Extract<ServerMsg, { t: "start" }>;
type EndMsg = Extract<ServerMsg, { t: "end" }>;

const SEED = 12345;

function input(seq: number, p: Partial<Omit<InputMsg, "t" | "seq">> = {}): InputMsg {
  return { t: "input", seq, ax: 0, az: 0, spit: false, yaw: 0, pitch: 0, nip: false, ...p };
}

function setup(n = 2, extra: Partial<RoomOptions> = {}) {
  let clock = 0;
  const raw: string[][] = [];
  const members = Array.from({ length: n }, (_, i) => {
    const box: string[] = [];
    raw.push(box);
    return { userId: `u${i}`, name: `Fish${i}`, send: (data: string) => { box.push(data); } };
  });
  const room = new Room({ seed: SEED, members, now: () => clock, ...extra });

  /** Everything member i has received so far, decoded. A message that does not decode fails the test. */
  const msgs = (i: number): ServerMsg[] =>
    raw[i].map((d) => {
      const m = decodeServer(d);
      if (m === null) throw new Error(`undecodable message: ${d}`);
      return m;
    });
  const snaps = (i: number): SnapMsg[] => msgs(i).filter((m): m is SnapMsg => m.t === "snap");

  /** Run exactly n more ticks, one clock step at a time. */
  const ticks = (count: number): void => {
    for (let k = 0; k < count; k++) {
      clock = Math.max(clock, Math.ceil(((room.tick + 1) * 1000) / TICK_HZ));
      room.pump();
    }
  };
  const advance = (ms: number): void => {
    clock += ms;
    room.pump();
  };
  return { room, raw, msgs, snaps, ticks, advance };
}

describe("Room setup", () => {
  it("rejects bad member lists and seeds", () => {
    const one = { userId: "a", name: "A", send: null };
    expect(() => new Room({ seed: SEED, members: [] })).toThrow();
    const five = Array.from({ length: 5 }, (_, i) => ({ userId: `u${i}`, name: "x", send: null }));
    expect(() => new Room({ seed: SEED, members: five })).toThrow();
    expect(() => new Room({ seed: SEED, members: [one, one] })).toThrow();
    for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) {
      expect(() => new Room({ seed, members: [one] })).toThrow();
    }
  });

  it("gives players sim ids in list order and exposes the roster", () => {
    const { room } = setup(3);
    expect(room.playerId("u0")).toBe(0);
    expect(room.playerId("u2")).toBe(2);
    expect(room.playerId("nobody")).toBe(undefined);
    expect(room.roster()).toEqual([
      { id: 0, name: "Fish0" },
      { id: 1, name: "Fish1" },
      { id: 2, name: "Fish2" },
    ]);
  });
});

describe("Room start and timing", () => {
  it("sends each player their own start message, then a baseline snapshot", () => {
    const { room, msgs } = setup(2);
    room.start();
    const a = msgs(0);
    const b = msgs(1);
    expect(a[0].t).toBe("start");
    expect((a[0] as StartMsg).you).toBe(0);
    expect((b[0] as StartMsg).you).toBe(1);
    expect((a[0] as StartMsg).seed).toBe(SEED);
    expect((a[0] as StartMsg).players).toEqual(room.roster());
    const snap = a[1] as SnapMsg;
    expect(snap.t).toBe("snap");
    expect(snap.tick).toBe(0);
    expect(snap.ack).toBe(-1);
    expect(snap.players).toHaveLength(2);
    expect(snap.events).toHaveLength(0);
    expect(room.running).toBe(true);
    expect(() => room.start()).toThrow();
    room.stop();
  });

  it("runs exactly the ticks that are due", () => {
    const { room, advance } = setup(2);
    room.start();
    advance(33);
    expect(room.tick).toBe(0);
    advance(1); // 34 ms
    expect(room.tick).toBe(1);
    advance(66); // 100 ms
    expect(room.tick).toBe(3);
    room.stop();
  });

  it("sends snapshots at 15 Hz, every second tick", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    ticks(30);
    expect(snaps(0).map((s) => s.tick)).toEqual(Array.from({ length: 16 }, (_, i) => i * 2));
    expect(snaps(1)).toHaveLength(16);
    room.stop();
  });

  it("does not fast-forward after a stall", () => {
    const { room, advance } = setup(2);
    room.start();
    advance(10_000);
    expect(room.tick).toBe(MAX_CATCHUP_TICKS);
    advance(34);
    expect(room.tick).toBe(MAX_CATCHUP_TICKS + 1);
    room.stop();
  });

  it("ticks on its own timer and stops cleanly", () => {
    vi.useFakeTimers();
    try {
      const room = new Room({
        seed: SEED,
        members: [{ userId: "a", name: "A", send: null }, { userId: "b", name: "B", send: null }],
        now: () => Date.now(),
      });
      room.start();
      vi.advanceTimersByTime(1000);
      expect(room.tick).toBeGreaterThanOrEqual(29);
      expect(room.tick).toBeLessThanOrEqual(30);
      room.stop();
      const frozen = room.tick;
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(room.tick).toBe(frozen);
      expect(room.running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Room inputs", () => {
  it("rejects input before the match runs, from unknown users, and with bad values", () => {
    const { room, ticks } = setup(2);
    expect(room.handleInput("u0", input(0))).toBe(false); // not started
    room.start();
    expect(room.handleInput("nobody", input(0))).toBe(false);
    expect(room.handleInput("u0", input(0, { ax: Number.NaN }))).toBe(false);
    expect(room.handleInput("u0", input(0, { az: Infinity }))).toBe(false);
    expect(room.handleInput("u0", input(0, { yaw: Number.NaN }))).toBe(false);
    expect(room.handleInput("u0", input(-1))).toBe(false);
    expect(room.handleInput("u0", input(1.5))).toBe(false);
    expect(room.handleInput("u0", input(2 ** 32))).toBe(false);
    expect(room.handleInput("u0", { ...input(0), spit: 1 as unknown as boolean })).toBe(false);
    expect(room.handleInput("u0", input(0))).toBe(true);
    ticks(1);
    room.stop();
  });

  it("ignores stale and repeated sequence numbers", () => {
    const { room } = setup(2);
    room.start();
    expect(room.handleInput("u0", input(5))).toBe(true);
    expect(room.handleInput("u0", input(5))).toBe(false);
    expect(room.handleInput("u0", input(3))).toBe(false);
    expect(room.handleInput("u0", input(6))).toBe(true);
    expect(room.handleInput("u1", input(0))).toBe(true); // each player counts on their own
    room.stop();
  });

  it("applies one queued input per tick and acknowledges each player separately", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    for (let seq = 0; seq < 3; seq++) room.handleInput("u0", input(seq));
    ticks(2);
    expect(snaps(0).at(-1)?.tick).toBe(2);
    expect(snaps(0).at(-1)?.ack).toBe(1);
    expect(snaps(1).at(-1)?.ack).toBe(-1);
    ticks(2);
    expect(snaps(0).at(-1)?.tick).toBe(4);
    expect(snaps(0).at(-1)?.ack).toBe(2);
    room.stop();
  });

  it("gives the same result as stepping the sim directly", () => {
    const { room, ticks } = setup(2);
    room.start();
    const ref = newSim(SEED, [0, 1]);
    const script = (k: number, who: number) => ({
      ax: Math.cos(k / (10 + who)),
      az: Math.sin(k / (7 + who)),
      spit: k % 25 === 7 * (who + 1) % 25,
      yaw: k / 10 + who,
      pitch: 0.2 + (k % 10) / 10,
      nip: k % 40 === 13 + who,
    });
    for (let k = 0; k < 300; k++) {
      const a = script(k, 0);
      const b = script(k, 1);
      expect(room.handleInput("u0", input(k, a))).toBe(true);
      expect(room.handleInput("u1", input(k, b))).toBe(true);
      ticks(1);
      stepSim(ref, [makeSimInput(a), makeSimInput(b)]);
    }
    expect(room.tick).toBe(300);
    expect(room.sim.players).toEqual(ref.players);
    expect(room.sim.shot).toEqual(ref.shot);
    // and the fish really did something
    expect(room.sim.players[0].shots).toBeGreaterThan(0);
    expect(room.sim.players[0].nipsUsed).toBeGreaterThan(0);
    room.stop();
  });

  it("repeats the last movement for a few ticks when input is late, then idles", () => {
    const { room, ticks } = setup(2);
    room.start();
    room.handleInput("u0", input(0, { ax: 1 }));
    const p = room.sim.players[0];
    ticks(1);
    const v1 = p.vx;
    expect(v1).toBeGreaterThan(0);
    ticks(MAX_HOLD_TICKS);
    const vHeld = p.vx;
    expect(vHeld).toBeGreaterThan(v1); // still accelerating on the repeated input
    ticks(1);
    expect(p.vx).toBeLessThan(vHeld); // the hold has run out: slowing down
    ticks(60);
    expect(Math.abs(p.vx)).toBeLessThan(0.01);
    room.stop();
  });

  it("does not repeat held movement for a player without a connection", () => {
    const { room, ticks } = setup(2);
    room.start();
    room.handleInput("u0", input(0, { ax: 1 }));
    ticks(1);
    room.detach("u0");
    const p = room.sim.players[0];
    const v = p.vx;
    ticks(1);
    expect(p.vx).toBeLessThan(v);
    room.stop();
  });

  it("never loses a spit when the queue overflows", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    room.handleInput("u0", input(0, { spit: true, yaw: 1, pitch: 0.5 }));
    for (let seq = 1; seq <= MAX_INPUT_QUEUE; seq++) room.handleInput("u0", input(seq));
    // seq 0 was dropped to make room, and its spit moved onto seq 1
    ticks(2);
    expect(room.sim.players[0].shots).toBe(1);
    expect(snaps(0).at(-1)?.ack).toBe(2);
    room.stop();
  });

  it("never loses a nip when the queue overflows", () => {
    const { room, ticks } = setup(2);
    room.start();
    room.handleInput("u0", input(0, { nip: true }));
    for (let seq = 1; seq <= MAX_INPUT_QUEUE; seq++) room.handleInput("u0", input(seq));
    ticks(1);
    expect(room.sim.players[0].nipsUsed).toBe(1);
    room.stop();
  });

  it("only accepts a lag-compensation setting for known players", () => {
    const { room } = setup(2);
    expect(room.setRewind("u0", 0.1)).toBe(true);
    expect(room.setRewind("u0", Number.NaN)).toBe(true);
    expect(room.setRewind("nobody", 0.1)).toBe(false);
  });
});

describe("Room events", () => {
  it("sends a spit that hits a bug with the exact position the sim used", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    const s = room.sim;
    s.obstacles.length = 0; // nothing in the way, so the shot below must hit
    const t = 1 / TICK_HZ; // the time of the next tick
    const target: Vec3 = { x: 0, y: 0, z: 0 };
    bugPosition(s.bugs[0], t, target);
    const fish = s.players[0];
    fish.x = target.x + (target.x > 0 ? -1 : 1);
    fish.z = target.z;
    s.players[1].x = 0;
    s.players[1].z = target.z > 0 ? -7 : 7; // far away, so no pushing
    const aim = spitAim(fish.x, fish.z, target.x, target.y, target.z);
    room.handleInput("u0", input(0, { spit: true, yaw: aim.yaw, pitch: aim.pitch }));
    ticks(2);

    const snap = snaps(0).at(-1) as SnapMsg;
    expect(snap.tick).toBe(2);
    const spit = snap.events.find((e) => e.type === "spit");
    expect(spit).not.toBe(undefined);
    if (spit?.type !== "spit") throw new Error("unreachable");
    expect(spit.tick).toBe(1);
    expect(spit.playerId).toBe(0);
    expect(spit.blockedBy).toBe(null);
    expect(spit.hit?.bugId).toBe(s.bugs[0].id);
    expect(spit.hit?.x).toBeCloseTo(target.x, 9);
    expect(spit.hit?.y).toBeCloseTo(target.y, 9);
    expect(spit.hit?.z).toBeCloseTo(target.z, 9);

    // a client can rebuild the same fall from the event alone
    const rebuilt = makeFallingBug(SEED, spit.hit!.bugId, spit.tick / TICK_HZ, spit.hit!);
    expect(rebuilt).toEqual(s.shot[0].fall);

    const me = snap.players[0];
    expect(me.shots).toBe(1);
    expect(me.hits).toBe(1);
    expect(me.spitCd).toBeCloseTo(0.67, 2);
    room.stop();
  });

  it("sends a missed nip with no victim", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    room.handleInput("u0", input(0, { nip: true }));
    ticks(2);
    const snap = snaps(0).at(-1) as SnapMsg;
    expect(snap.events).toEqual([{ type: "nip", tick: 1, thiefId: 0, victimId: null }]);
    expect(snap.players[0].nips).toBe(1);
    room.stop();
  });

  it("sends a nip that steals, and shows dash and immunity in the snapshot", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    const s = room.sim;
    s.obstacles.length = 0;
    s.players[0].x = 2; s.players[0].z = 0; s.players[0].facing = 0;
    s.players[1].x = 3; s.players[1].z = 0;
    s.players[1].stash = 1;
    room.handleInput("u0", input(0, { nip: true }));
    ticks(2);
    const snap = snaps(1).at(-1) as SnapMsg;
    expect(snap.events).toEqual([{ type: "nip", tick: 1, thiefId: 0, victimId: 1 }]);
    expect(snap.players[0].stash).toBe(1);
    expect(snap.players[1].stash).toBe(0);
    expect(snap.players[0].dash).toBe(true);
    expect(snap.players[1].immune).toBe(true);
    expect(snap.players[0].nipCd).toBeGreaterThan(2.5);
    room.stop();
  });

  it("keeps every snapshot position and facing inside what the decoder accepts", () => {
    const { room, snaps, ticks } = setup(2);
    room.start();
    room.handleInput("u0", input(0, { ax: -1, az: 1 }));
    ticks(40);
    for (const sn of snaps(0)) {
      for (const p of sn.players) {
        expect(Math.abs(p.facing)).toBeLessThanOrEqual(Math.PI);
        expect(p.spitCd).toBeGreaterThanOrEqual(0);
        expect(p.nipCd).toBeGreaterThanOrEqual(0);
      }
    }
    room.stop();
  });
});

describe("Room match end", () => {
  it("plays 4500 ticks, sends the last snapshot and the ranking, then goes quiet", () => {
    let ended: Room | null = null;
    let endCalls = 0;
    const { room, msgs, snaps, ticks, advance } = setup(2, {
      onEnd: (r) => { ended = r; endCalls += 1; },
    });
    room.start();
    ticks(SIM_MATCH_TICKS);
    expect(room.tick).toBe(SIM_MATCH_TICKS);
    expect(room.over).toBe(true);
    expect(room.running).toBe(false);
    expect(endCalls).toBe(1);
    expect(ended).toBe(room);

    for (const i of [0, 1]) {
      const all = msgs(i);
      const last = all.at(-1) as EndMsg;
      expect(last.t).toBe("end");
      expect(last.ranking).toHaveLength(2);
      expect(last.ranking.map((r) => r.id)).toEqual([0, 1]);
      expect(last.ranking.map((r) => r.rank)).toEqual([1, 1]); // nobody did anything: a tie
      expect(snaps(i).at(-1)?.tick).toBe(SIM_MATCH_TICKS);
      expect(snaps(i)).toHaveLength(1 + SIM_MATCH_TICKS / 2);
    }

    const count = msgs(0).length;
    advance(5000);
    expect(msgs(0)).toHaveLength(count);
    expect(room.handleInput("u0", input(0))).toBe(false);
    expect(endCalls).toBe(1);
  });

  it("ranks by stash in the end message", () => {
    const { room, msgs, ticks } = setup(2);
    room.start();
    room.sim.players[1].stash = 3;
    ticks(SIM_MATCH_TICKS);
    const last = msgs(0).at(-1) as EndMsg;
    expect(last.ranking[0]).toEqual({ id: 1, rank: 1, stash: 3, eaten: 0, nips: 0 });
    expect(last.ranking[1].rank).toBe(2);
  });
});

describe("Room connections", () => {
  it("stops sending to a detached player and resumes with start and a snapshot on attach", () => {
    const { room, raw, msgs, ticks } = setup(2);
    room.start();
    room.handleInput("u1", input(5));
    ticks(2);
    expect(room.detach("u1")).toBe(true);
    expect(room.detach("nobody")).toBe(false);
    const before = raw[1].length;
    ticks(4);
    expect(raw[1]).toHaveLength(before);
    expect(raw[0].length).toBeGreaterThan(before);

    const box: string[] = [];
    expect(room.attach("u1", (d) => { box.push(d); })).toBe(true);
    const got = box.map((d) => decodeServer(d));
    expect(got[0]?.t).toBe("start");
    expect((got[0] as StartMsg).you).toBe(1);
    expect(got[1]?.t).toBe("snap");
    expect((got[1] as SnapMsg).ack).toBe(-1);
    expect((got[1] as SnapMsg).tick).toBe(6);
    expect(room.handleInput("u1", input(0))).toBe(true); // a fresh client counts from 0 again
    expect(msgs(0).length).toBeGreaterThan(0);
    room.stop();
  });

  it("refuses to attach to a finished or stopped room, or for an unknown player", () => {
    const { room } = setup(2);
    room.start();
    expect(room.attach("nobody", () => {})).toBe(false);
    room.stop();
    expect(room.attach("u0", () => {})).toBe(false);
  });

  it("drops a player whose send throws, without disturbing the others", () => {
    let calls = 0;
    const good: string[] = [];
    const room = new Room({
      seed: SEED,
      members: [
        { userId: "a", name: "A", send: (d) => { good.push(d); } },
        { userId: "b", name: "B", send: () => { calls += 1; throw new Error("socket is gone"); } },
      ],
      now: () => 0,
    });
    expect(() => room.start()).not.toThrow();
    expect(calls).toBe(1); // never called again after the first failure
    expect(good).toHaveLength(2); // start + baseline snapshot
    room.stop();
  });
});

describe("Room failure", () => {
  it("stops itself and reports an internal error instead of crashing", () => {
    const errors: unknown[] = [];
    const { room, ticks, advance } = setup(2, { onError: (e) => { errors.push(e); } });
    room.start();
    (room.sim as { obstacles: unknown }).obstacles = null; // makes the next tick throw
    ticks(1);
    expect(errors).toHaveLength(1);
    expect(room.running).toBe(false);
    advance(1000);
    expect(errors).toHaveLength(1);
  });
});
