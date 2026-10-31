import { describe, expect, it } from "vitest";
import {
  decodeClient,
  decodeServer,
  encodeClient,
  encodeServer,
  WIRE_MAX_EVENTS,
  WIRE_MAX_PLAYERS,
} from "./codec";
import type { ClientMsg, ServerMsg, WireEvent, WirePlayer } from "./protocol";

type Snap = Extract<ServerMsg, { t: "snap" }>;

const INPUT: Extract<ClientMsg, { t: "input" }> = {
  t: "input", seq: 7, ax: 0.5, az: -1, spit: true, yaw: 1.25, pitch: 0.5, nip: false,
};

const PLAYER: WirePlayer = {
  id: 0, x: 1.25, z: -2.5, vx: 0.5, vz: 0, facing: 0.75,
  stash: 2, eaten: 3, shots: 10, hits: 4, nips: 1,
  spitCd: 0.3, nipCd: 0, dash: false, immune: true,
};
const player = (id: number): WirePlayer => ({ ...PLAYER, id });

const EVENTS: WireEvent[] = [
  { type: "spit", tick: 10, playerId: 0, length: 6.5, hit: { bugId: 3, x: 1, y: 2, z: -1 }, blockedBy: null },
  { type: "spit", tick: 11, playerId: 1, length: 2.25, hit: null, blockedBy: 4 },
  { type: "nip", tick: 12, thiefId: 1, victimId: 0 },
  { type: "nip", tick: 13, thiefId: 0, victimId: null },
  { type: "eat", tick: 14, playerId: 1, bugId: 3 },
];

const SNAP: Snap = { t: "snap", tick: 14, ack: 6, players: [player(0), player(1)], events: EVENTS };

const rawInput = (seq: string) =>
  `{"t":"input","seq":${seq},"ax":0,"az":0,"spit":false,"yaw":0,"pitch":0,"nip":false}`;

/** The input message as JSON text with one numeric field replaced by a literal such as 1e999. */
const inputWith = (field: string, literal: string) =>
  JSON.stringify({ ...INPUT, [field]: 0 }).replace(`"${field}":0`, `"${field}":${literal}`);

describe("client messages", () => {
  it("round-trips every client message", () => {
    const all: ClientMsg[] = [{ t: "ping", n: 5 }, { t: "join" }, { t: "leave" }, INPUT];
    for (const m of all) expect(decodeClient(encodeClient(m))).toEqual(m);
  });

  it("rejects text that is not a JSON object with a known type", () => {
    const bad = ["", "nope", "{", "null", "5", '"join"', "[]", '[{"t":"join"}]', "{}", '{"t":"hello"}', '{"t":5}', '{"t":null}'];
    for (const raw of bad) expect(decodeClient(raw), raw).toBeNull();
  });

  it("copies only known fields, so a client cannot smuggle in a rewind", () => {
    const m = decodeClient(JSON.stringify({ ...INPUT, rewind: 5, playerId: 3, x: 99 }));
    expect(m).toEqual(INPUT);
    expect(m).not.toHaveProperty("rewind");
  });

  it("rejects an input with a missing or wrongly typed field", () => {
    const base: Record<string, unknown> = { ...INPUT };
    for (const field of ["seq", "ax", "az", "spit", "yaw", "pitch", "nip"]) {
      const missing = { ...base };
      delete missing[field];
      expect(decodeClient(JSON.stringify(missing)), `missing ${field}`).toBeNull();
      expect(decodeClient(JSON.stringify({ ...base, [field]: "1" })), `string ${field}`).toBeNull();
      expect(decodeClient(JSON.stringify({ ...base, [field]: null })), `null ${field}`).toBeNull();
    }
    expect(decodeClient(JSON.stringify({ ...base, spit: 1 })), "spit as a number").toBeNull();
    expect(decodeClient(JSON.stringify({ ...base, nip: 0 })), "nip as a number").toBeNull();
  });

  it("rejects non-finite and out-of-range numbers", () => {
    const bad: [string, string][] = [
      ["ax", "1e999"], ["ax", "-1e999"], ["ax", "2.5"], ["az", "-2.5"],
      ["yaw", "7.5"], ["yaw", "-7.5"], ["pitch", "2.5"], ["pitch", "-2.5"],
    ];
    for (const [field, literal] of bad) {
      expect(decodeClient(inputWith(field, literal)), `${field}=${literal}`).toBeNull();
    }
    expect(decodeClient(inputWith("ax", "2"))).not.toBeNull(); // the limits themselves are allowed
    expect(decodeClient(inputWith("yaw", "-7"))).not.toBeNull();
  });

  it("accepts the axes the client really sends on a diagonal", () => {
    const m = decodeClient(encodeClient({ ...INPUT, ax: Math.SQRT2, az: 0 }));
    expect(m).toMatchObject({ ax: Math.SQRT2, az: 0 });
  });

  it("rejects a bad sequence number", () => {
    for (const bad of ["-1", "1.5", "4294967296", '"3"', "null", "true", "1e999"]) {
      expect(decodeClient(rawInput(bad)), bad).toBeNull();
    }
    expect(decodeClient(rawInput("0"))).not.toBeNull();
    expect(decodeClient(rawInput("4294967295"))).not.toBeNull();
  });

  it("needs a finite number in a ping", () => {
    for (const raw of ['{"t":"ping"}', '{"t":"ping","n":"1"}', '{"t":"ping","n":null}', '{"t":"ping","n":1e999}']) {
      expect(decodeClient(raw), raw).toBeNull();
    }
    expect(decodeClient('{"t":"ping","n":-3.5}')).toEqual({ t: "ping", n: -3.5 });
  });

  it("is not fooled by a __proto__ key", () => {
    const m = decodeClient('{"t":"join","__proto__":{"admin":true}}');
    expect(m).toEqual({ t: "join" });
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe("server messages", () => {
  it("round-trips every server message", () => {
    const all: ServerMsg[] = [
      { t: "welcome", tickHz: 30 },
      { t: "pong", n: 2 },
      { t: "queued", waiting: 3 },
      { t: "start", seed: 123456, you: 1, players: [{ id: 0, name: "Gilly" }, { id: 1, name: "Guest-1234" }] },
      SNAP,
      {
        t: "end", ranking: [
          { id: 1, rank: 1, stash: 5, eaten: 6, nips: 2 },
          { id: 0, rank: 2, stash: 3, eaten: 4, nips: 0 },
        ]
      },
      { t: "error", code: "already_playing" },
    ];
    for (const m of all) expect(decodeServer(encodeServer(m)), m.t).toEqual(m);
  });

  it("rejects garbage and unknown message types", () => {
    const bad = ["", "nope", "{", "null", "[]", "{}", '{"t":"hello"}', '{"t":"input"}', '{"t":7}'];
    for (const raw of bad) expect(decodeServer(raw), raw).toBeNull();
  });

  it("rejects a start with a bad roster", () => {
    const start = (players: unknown, you = 0) => JSON.stringify({ t: "start", seed: 1, you, players });
    const ok = [{ id: 0, name: "A" }, { id: 1, name: "B" }];
    expect(decodeServer(start(ok))).not.toBeNull();
    expect(decodeServer(start(ok, 2)), "you not in the roster").toBeNull();
    expect(decodeServer(start([ok[0], ok[0]])), "duplicate ids").toBeNull();
    expect(decodeServer(start([])), "empty roster").toBeNull();
    expect(decodeServer(start([0, 1, 2, 3, 4].map((id) => ({ id, name: "x" })))), "five players").toBeNull();
    expect(decodeServer(start([{ id: 0, name: 5 }])), "name not a string").toBeNull();
    expect(decodeServer(start([{ id: 0, name: "x".repeat(33) }])), "name too long").toBeNull();
  });

  it("rejects a snapshot with a malformed player", () => {
    const withPlayer = (p: unknown) => JSON.stringify({ ...SNAP, players: [p] });
    expect(decodeServer(withPlayer(PLAYER))).not.toBeNull();
    const base: Record<string, unknown> = { ...PLAYER };
    for (const field of Object.keys(base)) {
      const missing = { ...base };
      delete missing[field];
      expect(decodeServer(withPlayer(missing)), `missing ${field}`).toBeNull();
      expect(decodeServer(withPlayer({ ...base, [field]: "1" })), `string ${field}`).toBeNull();
    }
    expect(decodeServer(withPlayer({ ...base, spitCd: -0.1 })), "negative cooldown").toBeNull();
    expect(decodeServer(withPlayer({ ...base, stash: -1 })), "negative stash").toBeNull();
    expect(decodeServer(withPlayer(null)), "null player").toBeNull();
  });

  it("rejects a snapshot with a malformed event", () => {
    const withEvent = (e: unknown) => JSON.stringify({ ...SNAP, events: [e] });
    const bad: unknown[] = [
      { type: "dance", tick: 1 },
      { type: "eat", playerId: 1, bugId: 3 }, // no tick
      { type: "eat", tick: -1, playerId: 1, bugId: 3 },
      { type: "spit", tick: 1, playerId: 0, length: 3, hit: { bugId: 1, x: 0, y: 0 }, blockedBy: null }, // no z
      { type: "spit", tick: 1, playerId: 0, length: 3, hit: null }, // blockedBy missing
      { type: "spit", tick: 1, playerId: 0, length: 3, hit: null, blockedBy: -1 },
      { type: "spit", tick: 1, playerId: 0, length: -3, hit: null, blockedBy: null },
      { type: "nip", tick: 1, thiefId: 0 }, // victimId missing
      null,
      5,
    ];
    for (const e of bad) expect(decodeServer(withEvent(e)), JSON.stringify(e)).toBeNull();
  });

  it("limits the players and events in a snapshot", () => {
    const players = (n: number) => Array.from({ length: n }, (_, i) => player(i));
    const events = (n: number) => Array.from({ length: n }, (_, i): WireEvent => ({ type: "eat", tick: i, playerId: 0, bugId: i }));
    const snap = (p: unknown, e: unknown) => JSON.stringify({ ...SNAP, players: p, events: e });
    expect(decodeServer(snap(players(WIRE_MAX_PLAYERS), []))).not.toBeNull();
    expect(decodeServer(snap(players(WIRE_MAX_PLAYERS + 1), [])), "too many players").toBeNull();
    expect(decodeServer(snap([], [])), "no players").toBeNull();
    expect(decodeServer(snap(players(1), events(WIRE_MAX_EVENTS)))).not.toBeNull();
    expect(decodeServer(snap(players(1), events(WIRE_MAX_EVENTS + 1))), "too many events").toBeNull();
    expect(decodeServer(snap(players(1), "nope")), "events not a list").toBeNull();
  });

  it("accepts ack -1 (nothing applied yet) but nothing lower", () => {
    const withAck = (ack: unknown) => JSON.stringify({ ...SNAP, ack });
    expect(decodeServer(withAck(-1))).not.toBeNull();
    expect(decodeServer(withAck(0))).not.toBeNull();
    expect(decodeServer(withAck(-2)), "-2").toBeNull();
    expect(decodeServer(withAck(1.5)), "1.5").toBeNull();
    expect(decodeServer(withAck(null)), "null").toBeNull();
  });

  it("rejects bad simple messages", () => {
    const bad = [
      '{"t":"error","code":"nope"}', '{"t":"error"}',
      '{"t":"queued","waiting":-1}', '{"t":"queued"}',
      '{"t":"welcome","tickHz":0}', '{"t":"welcome"}',
      '{"t":"pong"}', '{"t":"pong","n":"1"}',
    ];
    for (const raw of bad) expect(decodeServer(raw), raw).toBeNull();
  });

  it("rejects a bad ranking", () => {
    const end = (ranking: unknown) => JSON.stringify({ t: "end", ranking });
    const row = { id: 0, rank: 1, stash: 1, eaten: 1, nips: 0 };
    expect(decodeServer(end([row]))).not.toBeNull();
    expect(decodeServer(end([{ ...row, rank: 0 }])), "rank 0").toBeNull();
    expect(decodeServer(end([])), "empty").toBeNull();
    expect(decodeServer(end([row, row, row, row, row])), "five rows").toBeNull();
    expect(decodeServer(end("nope")), "not a list").toBeNull();
  });
});
