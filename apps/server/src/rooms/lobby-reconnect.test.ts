import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lobby, RECONNECT_WINDOW_MS, type Connection, type RoomLike } from "./lobby.js";
import type { RoomOptions } from "./room.js";

class FakeRoom implements RoomLike {
  attached: string[] = [];
  detached: string[] = [];
  rewinds: [string, number][] = [];
  constructor(readonly opts: RoomOptions) { }
  start() { }
  stop() { }
  attach(userId: string) {
    this.attached.push(userId);
    return true;
  }
  detach(userId: string) {
    this.detached.push(userId);
    return true;
  }
  handleInput() {
    return true;
  }
  setRewind(userId: string, seconds: number) {
    this.rewinds.push([userId, seconds]);
  }
}

let rooms: FakeRoom[];
let t: number;
let lobby: Lobby;

const conn = (): Connection => ({ send: () => { }, close: () => { } });

/** Two players join and the fill wait passes, so a match is running. */
function startMatch() {
  const a = conn();
  const b = conn();
  lobby.connect("a", "A", a);
  lobby.connect("b", "B", b);
  lobby.join("a");
  lobby.join("b");
  t += 5000;
  lobby.pump();
  return { a, b };
}

beforeEach(() => {
  vi.useFakeTimers();
  rooms = [];
  t = 0;
  lobby = new Lobby({
    now: () => t,
    makeSeed: () => 1,
    fillWaitMs: 5000,
    createRoom: (opts) => {
      const room = new FakeRoom(opts);
      rooms.push(room);
      return room;
    },
    onError: (err) => {
      throw err;
    },
  });
});

afterEach(() => {
  lobby.stop();
  vi.useRealTimers();
});

describe("reconnect window", () => {
  it("keeps the player's place until the window is over", () => {
    const { a } = startMatch();
    lobby.disconnect("a", a);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS - 1);
    expect(lobby.roomOf("a")).toBe(rooms[0]);
    expect(rooms[0]!.detached).toEqual(["a"]);
  });

  it("frees the player when the window ends, so they can queue again", () => {
    const { a } = startMatch();
    lobby.disconnect("a", a);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS);
    expect(lobby.roomOf("a")).toBeUndefined();
    expect(lobby.roomOf("b")).toBe(rooms[0]);

    lobby.connect("a", "A", conn());
    lobby.join("a");
    expect(lobby.isQueued("a")).toBe(true);
  });

  it("gives the fish back to a player who returns in time, and cancels the window", () => {
    const { a } = startMatch();
    lobby.disconnect("a", a);
    vi.advanceTimersByTime(5000);
    lobby.connect("a", "A", conn());
    expect(rooms[0]!.attached).toEqual(["a"]);
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS * 2);
    expect(lobby.roomOf("a")).toBe(rooms[0]);
  });

  it("ignores the late close of a socket that was already replaced", () => {
    const { a } = startMatch();
    lobby.connect("a", "A", conn()); // replaces `a`
    lobby.disconnect("a", a); // the old socket reports its close
    vi.advanceTimersByTime(RECONNECT_WINDOW_MS * 2);
    expect(rooms[0]!.detached).toEqual([]);
    expect(lobby.roomOf("a")).toBe(rooms[0]);
  });

  it("drops the window when the match ends first", () => {
    const { a } = startMatch();
    lobby.disconnect("a", a);
    expect(vi.getTimerCount()).toBe(1);
    rooms[0]!.opts.onEnd?.(undefined as never);
    expect(lobby.roomOf("a")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the window on stop", () => {
    const { a } = startMatch();
    lobby.disconnect("a", a);
    lobby.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("lag compensation", () => {
  it("passes the rewind on to the player's room, and ignores players with no room", () => {
    startMatch();
    lobby.setRewind("a", 0.05);
    lobby.setRewind("nobody", 0.1);
    expect(rooms[0]!.rewinds).toEqual([["a", 0.05]]);
  });
});
