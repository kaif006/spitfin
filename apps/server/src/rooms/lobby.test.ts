import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeServer } from "@spitfin/shared";
import type { ServerMsg } from "@spitfin/shared";
import { CLOSE_REPLACED, Lobby, MATCH_FILL_WAIT_MS } from "./lobby.js";
import type { Connection, LobbyOptions, RoomLike } from "./lobby.js";
import type { InputMsg, Room, RoomOptions, Send } from "./room.js";

type StartMsg = Extract<ServerMsg, { t: "start" }>;

const INPUT: InputMsg = { t: "input", seq: 0, ax: 0, az: 0, spit: false, yaw: 0, pitch: 0, nip: false };

/** A room that only records what the lobby does to it. */
class FakeRoom implements RoomLike {
  started = false;
  stopped = false;
  readonly attached: { userId: string; send: Send }[] = [];
  readonly detached: string[] = [];
  readonly inputs: [string, InputMsg][] = [];

  constructor(readonly opts: RoomOptions) { }

  get userIds(): string[] {
    return this.opts.members.map((m) => m.userId);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  attach(userId: string, send: Send): boolean {
    this.attached.push({ userId, send });
    return true;
  }
  detach(userId: string): boolean {
    this.detached.push(userId);
    return true;
  }
  handleInput(userId: string, msg: InputMsg): boolean {
    this.inputs.push([userId, msg]);
    return true;
  }
  end(): void {
    this.opts.onEnd?.(this as unknown as Room);
  }
  crash(err: unknown): void {
    this.opts.onError?.(err);
  }
}

function makeConn() {
  const sent: string[] = [];
  const closed: { code: number; reason: string }[] = [];
  const conn: Connection = {
    send: (data) => { sent.push(data); },
    close: (code, reason) => { closed.push({ code, reason }); },
  };
  /** Everything received so far, decoded. A message that does not decode fails the test. */
  const msgs = (): ServerMsg[] =>
    sent.map((d) => {
      const m = decodeServer(d);
      if (m === null) throw new Error(`undecodable message: ${d}`);
      return m;
    });
  return { conn, sent, closed, msgs };
}
type FakeConn = ReturnType<typeof makeConn>;

/** The `waiting` counts a player has been told, in order. */
const waitingOf = (c: FakeConn): number[] =>
  c.msgs().flatMap((m) => (m.t === "queued" ? [m.waiting] : []));

const lobbies: Lobby[] = [];
afterEach(() => {
  for (const l of lobbies.splice(0)) l.stop();
});

function setup(extra: Partial<LobbyOptions> = {}) {
  let clock = 0;
  const rooms: FakeRoom[] = [];
  const errors: unknown[] = [];
  const lobby = new Lobby({
    now: () => clock,
    makeSeed: () => 1000 + rooms.length,
    createRoom: (o) => {
      const r = new FakeRoom(o);
      rooms.push(r);
      return r;
    },
    onError: (e) => { errors.push(e); },
    ...extra,
  });
  lobbies.push(lobby);
  const connect = (id: string): FakeConn => {
    const c = makeConn();
    lobby.connect(id, `Fish-${id}`, c.conn);
    return c;
  };
  const enter = (id: string): FakeConn => {
    const c = connect(id);
    lobby.join(id);
    return c;
  };
  /** Move the clock to `ms` and let the lobby start anything that is due. */
  const at = (ms: number): void => {
    clock = ms;
    lobby.pump();
  };
  return { lobby, rooms, errors, connect, enter, at };
}

describe("Lobby matchmaking", () => {
  it("tells a lone player they are waiting and does not start a match", () => {
    const { lobby, rooms, enter, at } = setup();
    const a = enter("a");
    expect(a.msgs()).toEqual([{ t: "queued", waiting: 1 }]);
    at(60_000);
    expect(rooms).toHaveLength(0);
    expect(lobby.queueSize).toBe(1);
  });

  it("starts a two-player match only after the fill wait", () => {
    const { lobby, rooms, enter, at } = setup();
    const a = enter("a");
    const b = enter("b");
    expect(waitingOf(a)).toEqual([1, 2]);
    expect(waitingOf(b)).toEqual([2]);

    at(MATCH_FILL_WAIT_MS - 1);
    expect(rooms).toHaveLength(0);
    at(MATCH_FILL_WAIT_MS);
    expect(rooms).toHaveLength(1);

    const room = rooms[0];
    expect(room.started).toBe(true);
    expect(room.userIds).toEqual(["a", "b"]);
    expect(room.opts.members.map((m) => m.name)).toEqual(["Fish-a", "Fish-b"]);
    expect(room.opts.members[0].send).toBe(a.conn.send);
    expect(room.opts.members[1].send).toBe(b.conn.send);
    expect(room.opts.seed).toBe(1000);
    expect(lobby.queueSize).toBe(0);
    expect(lobby.roomCount).toBe(1);
    expect(lobby.roomOf("a")).toBe(room);
    expect(lobby.roomOf("b")).toBe(room);
  });

  it("starts a full match of four at once, without telling the last joiner they are queued", () => {
    const { lobby, rooms, enter } = setup();
    enter("a");
    enter("b");
    enter("c");
    expect(rooms).toHaveLength(0);
    const d = enter("d");
    expect(rooms).toHaveLength(1);
    expect(rooms[0].userIds).toEqual(["a", "b", "c", "d"]);
    expect(d.msgs()).toEqual([]);
    expect(lobby.queueSize).toBe(0);
  });

  it("starts the first four of five and keeps the fifth waiting", () => {
    const { lobby, rooms, enter } = setup();
    for (const id of ["a", "b", "c", "d"]) enter(id);
    const e = enter("e");
    expect(rooms).toHaveLength(1);
    expect(rooms[0].userIds).toEqual(["a", "b", "c", "d"]);
    expect(waitingOf(e)).toEqual([1]);
    expect(lobby.isQueued("e")).toBe(true);
    expect(lobby.roomOf("e")).toBe(undefined);
  });

  it("counts the fill wait from when the second player arrives, not the first", () => {
    const { rooms, enter, at } = setup();
    enter("a"); // t = 0
    at(8000);
    enter("b"); // t = 8000: the wait starts now
    at(12_999);
    expect(rooms).toHaveLength(0);
    at(13_000);
    expect(rooms).toHaveLength(1);
  });

  it("lets late arrivals into a match that is still filling", () => {
    const { rooms, enter, at } = setup();
    enter("a");
    enter("b"); // t = 0
    at(3000);
    enter("c");
    at(MATCH_FILL_WAIT_MS);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].userIds).toEqual(["a", "b", "c"]);
  });

  it("does not match a player who left the queue", () => {
    const { lobby, rooms, enter, at } = setup();
    enter("a");
    const b = enter("b");
    at(1000);
    lobby.leave("a");
    expect(lobby.queueSize).toBe(1);
    expect(lobby.isQueued("a")).toBe(false);
    expect(waitingOf(b)).toEqual([2, 1]);
    at(2000);
    enter("c"); // the wait restarts at 2000
    at(6999);
    expect(rooms).toHaveLength(0);
    at(7000);
    expect(rooms[0].userIds).toEqual(["b", "c"]);
  });

  it("does not match a player who disconnected while queued", () => {
    const { lobby, rooms, enter, at } = setup();
    const a = enter("a");
    enter("b");
    lobby.disconnect("a", a.conn);
    expect(lobby.isConnected("a")).toBe(false);
    expect(lobby.queueSize).toBe(1);
    enter("c");
    at(MATCH_FILL_WAIT_MS);
    expect(rooms[0].userIds).toEqual(["b", "c"]);
  });

  it("does not queue a player twice", () => {
    const { lobby, enter } = setup();
    const a = enter("a");
    lobby.join("a");
    expect(lobby.queueSize).toBe(1);
    expect(waitingOf(a)).toEqual([1, 1]);
  });

  it("starts matches on its own timer", () => {
    vi.useFakeTimers();
    try {
      const rooms: FakeRoom[] = [];
      const lobby = new Lobby({
        now: () => Date.now(),
        createRoom: (o) => {
          const r = new FakeRoom(o);
          rooms.push(r);
          return r;
        },
      });
      lobbies.push(lobby);
      lobby.connect("a", "A", makeConn().conn);
      lobby.connect("b", "B", makeConn().conn);
      lobby.join("a");
      lobby.join("b");
      vi.advanceTimersByTime(MATCH_FILL_WAIT_MS - 1);
      expect(rooms).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(rooms).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a fresh seed for every match", () => {
    const { rooms, enter } = setup();
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) enter(id);
    expect(rooms.map((r) => r.opts.seed)).toEqual([1000, 1001]);
  });
});

describe("Lobby players and rooms", () => {
  it("refuses to queue a player who is already in a match", () => {
    const { lobby, enter } = setup();
    const a = enter("a");
    for (const id of ["b", "c", "d"]) enter(id);
    lobby.join("a");
    expect(a.msgs().at(-1)).toEqual({ t: "error", code: "already_playing" });
    expect(lobby.queueSize).toBe(0);
  });

  it("ignores players who are not connected", () => {
    const { lobby } = setup();
    lobby.join("ghost");
    lobby.leave("ghost");
    expect(lobby.input("ghost", INPUT)).toBe(false);
    expect(lobby.queueSize).toBe(0);
  });

  it("passes input to the player's room, and only for players in a room", () => {
    const { lobby, rooms, enter } = setup();
    for (const id of ["a", "b", "c", "d"]) enter(id);
    enter("x");
    expect(lobby.input("a", INPUT)).toBe(true);
    expect(rooms[0].inputs).toEqual([["a", INPUT]]);
    expect(lobby.input("x", INPUT)).toBe(false); // queued, not playing
    expect(rooms[0].inputs).toHaveLength(1);
  });

  it("closes the old connection when a player connects again, and ignores its late close event", () => {
    const { lobby, connect } = setup();
    const c1 = connect("a");
    const c2 = connect("a");
    expect(c1.closed).toEqual([{ code: CLOSE_REPLACED, reason: "replaced" }]);
    expect(c2.closed).toEqual([]);
    lobby.disconnect("a", c1.conn); // the old socket reports its close
    expect(lobby.isConnected("a")).toBe(true);
    lobby.join("a");
    expect(waitingOf(c2)).toEqual([1]);
    expect(waitingOf(c1)).toEqual([]);
  });

  it("keeps a queued player's place when their connection is replaced", () => {
    const { lobby, enter, connect } = setup();
    const c1 = enter("a");
    enter("b");
    const c2 = connect("a");
    expect(c1.closed.map((c) => c.code)).toEqual([CLOSE_REPLACED]);
    expect(lobby.queueSize).toBe(2);
    expect(lobby.isQueued("a")).toBe(true);
    expect(waitingOf(c2)).toEqual([2]);
  });

  it("lets a player reconnect to a running match, and still refuses to queue them", () => {
    const { lobby, rooms, enter, connect } = setup();
    const a = enter("a");
    for (const id of ["b", "c", "d"]) enter(id);
    const room = rooms[0];

    lobby.disconnect("a", a.conn);
    expect(room.detached).toEqual(["a"]);
    expect(lobby.roomOf("a")).toBe(room); // still has a place in the match

    const a2 = connect("a");
    expect(room.attached).toEqual([{ userId: "a", send: a2.conn.send }]);
    lobby.join("a");
    expect(a2.msgs().at(-1)).toEqual({ t: "error", code: "already_playing" });
  });

  it("hands the fish to a new connection that replaces one during a match", () => {
    const { rooms, enter, connect } = setup();
    const a = enter("a");
    for (const id of ["b", "c", "d"]) enter(id);
    const a2 = connect("a"); // no disconnect in between
    expect(a.closed.map((c) => c.code)).toEqual([CLOSE_REPLACED]);
    expect(rooms[0].attached).toEqual([{ userId: "a", send: a2.conn.send }]);
    expect(rooms[0].detached).toEqual([]);
  });

  it("frees the players when their match ends", () => {
    const { lobby, rooms, enter } = setup();
    for (const id of ["a", "b", "c", "d"]) enter(id);
    rooms[0].end();
    expect(lobby.roomCount).toBe(0);
    expect(lobby.roomOf("a")).toBe(undefined);
    lobby.join("a");
    expect(lobby.isQueued("a")).toBe(true);
  });

  it("frees the players and reports the error when a room fails", () => {
    const { lobby, rooms, errors, enter } = setup();
    for (const id of ["a", "b", "c", "d"]) enter(id);
    const boom = new Error("boom");
    rooms[0].crash(boom);
    expect(errors).toEqual([boom]);
    expect(lobby.roomCount).toBe(0);
    expect(lobby.roomOf("b")).toBe(undefined);
  });

  it("reports an error and keeps going when a room cannot be created", () => {
    const errors: unknown[] = [];
    const { lobby, enter } = setup({
      createRoom: () => { throw new Error("no room for you"); },
      onError: (e) => { errors.push(e); },
    });
    for (const id of ["a", "b", "c", "d"]) enter(id);
    expect(errors).toHaveLength(1);
    expect(lobby.roomCount).toBe(0);
    expect(lobby.roomOf("a")).toBe(undefined);
  });
});

describe("Lobby shutdown", () => {
  it("stops every room, forgets everyone, and refuses new connections", () => {
    const { lobby, rooms, enter } = setup();
    for (const id of ["a", "b", "c", "d"]) enter(id);
    lobby.stop();
    expect(rooms[0].stopped).toBe(true);
    expect(lobby.roomCount).toBe(0);
    expect(lobby.queueSize).toBe(0);
    expect(lobby.isConnected("a")).toBe(false);

    lobby.join("a"); // ignored, does not throw
    const late = makeConn();
    lobby.connect("z", "Z", late.conn);
    expect(late.closed).toEqual([{ code: 1001, reason: "server shutting down" }]);
    expect(lobby.isConnected("z")).toBe(false);
  });
});

describe("Lobby with the real Room", () => {
  it("starts a real room: players get start and a baseline snapshot, and input reaches it", () => {
    const clock = 0;
    const lobby = new Lobby({ now: () => clock, makeSeed: () => 777, fillWaitMs: 0 });
    lobbies.push(lobby);
    const a = makeConn();
    const b = makeConn();
    lobby.connect("u0", "Gilly", a.conn);
    lobby.connect("u1", "Kaif", b.conn);
    lobby.join("u0");
    lobby.join("u1");

    expect(a.msgs().map((m) => m.t)).toEqual(["queued", "start", "snap"]);
    expect(b.msgs().map((m) => m.t)).toEqual(["start", "snap"]);
    const startA = a.msgs()[1] as StartMsg;
    const startB = b.msgs()[0] as StartMsg;
    expect(startA.you).toBe(0);
    expect(startB.you).toBe(1);
    expect(startA.seed).toBe(777);
    expect(startA.players).toEqual([{ id: 0, name: "Gilly" }, { id: 1, name: "Kaif" }]);

    expect(lobby.input("u0", INPUT)).toBe(true);
    expect(lobby.input("u0", INPUT)).toBe(false); // same sequence number again: stale
  });
});
