// The lobby: who is connected, who is waiting for a match, and which room each player is in.
// It knows nothing about sockets or accounts. A connection is just { send, close }, so the lobby
// can be tested without a network, and rooms are created through a factory so tests can fake them.

import { randomInt } from "node:crypto";
import { WIRE_MAX_PLAYERS, encodeServer } from "@spitfin/shared";
import type { ServerMsg } from "@spitfin/shared";
import { Room } from "./room.js";
import type { InputMsg, RoomOptions, Send } from "./room.js";

/** A match needs at least this many players. */
export const MATCH_MIN_PLAYERS = 2;
/** A match starts at once when this many are waiting. */
export const MATCH_MAX_PLAYERS = WIRE_MAX_PLAYERS;
/**
 * With at least MATCH_MIN_PLAYERS waiting, the match starts this long after the queue first reached
 * that size, so late arrivals can still join it. A full queue does not wait.
 */
export const MATCH_FILL_WAIT_MS = 5000;
/** WebSocket close code for a connection replaced by a newer one from the same player (4000 to 4999 are ours to use). */
export const CLOSE_REPLACED = 4001;
const CLOSE_GOING_AWAY = 1001;

/** What the lobby needs from one client connection. */
export interface Connection {
  send: Send;
  close(code: number, reason: string): void;
}

/** What the lobby needs from a room. The real `Room` fits. */
export interface RoomLike {
  start(): void;
  stop(): void;
  attach(userId: string, send: Send): boolean;
  detach(userId: string): boolean;
  handleInput(userId: string, msg: InputMsg): boolean;
}

export interface LobbyOptions {
  /** Milliseconds from a monotonic clock. Passed on to the rooms. Tests pass a fake one. */
  now?: () => number;
  /** Match seed, an unsigned 32-bit integer. Defaults to a random one. */
  makeSeed?: () => number;
  /** Creates the room for a match. Defaults to the real Room. */
  createRoom?: (opts: RoomOptions) => RoomLike;
  fillWaitMs?: number;
  /** Called when a room fails or cannot be created. The players of a failed room are freed first. */
  onError?: (err: unknown) => void;
}

interface Client {
  readonly name: string;
  readonly conn: Connection;
}

export class Lobby {
  private readonly clients = new Map<string, Client>();
  private readonly queue: string[] = [];
  private readonly roomByUser = new Map<string, RoomLike>();
  private readonly usersByRoom = new Map<RoomLike, string[]>();
  private readonly now: () => number;
  private readonly makeSeed: () => number;
  private readonly createRoom: (opts: RoomOptions) => RoomLike;
  private readonly fillWaitMs: number;
  private readonly onError: (err: unknown) => void;
  private fillSince: number | null = null; // when the queue first reached MATCH_MIN_PLAYERS
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: LobbyOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.makeSeed = opts.makeSeed ?? (() => randomInt(0, 2 ** 32));
    this.createRoom = opts.createRoom ?? ((o) => new Room(o));
    this.fillWaitMs = opts.fillWaitMs ?? MATCH_FILL_WAIT_MS;
    this.onError = opts.onError ?? ((err) => console.error("lobby error", err));
  }

  get queueSize(): number {
    return this.queue.length;
  }

  get roomCount(): number {
    return this.usersByRoom.size;
  }

  isConnected(userId: string): boolean {
    return this.clients.has(userId);
  }

  isQueued(userId: string): boolean {
    return this.queue.includes(userId);
  }

  roomOf(userId: string): RoomLike | undefined {
    return this.roomByUser.get(userId);
  }

  /**
   * Registers a connection for a player. A player has one connection at a time: an older one is
   * closed with CLOSE_REPLACED. If the player is in a running match, the new connection takes over
   * their fish (this is also how a reconnect works). If they are queued, they keep their place.
   */
  connect(userId: string, name: string, conn: Connection): void {
    if (this.stopped) {
      this.closeQuietly(conn, CLOSE_GOING_AWAY, "server shutting down");
      return;
    }
    const old = this.clients.get(userId);
    this.clients.set(userId, { name, conn });
    if (old !== undefined && old.conn !== conn) this.closeQuietly(old.conn, CLOSE_REPLACED, "replaced");

    const room = this.roomByUser.get(userId);
    if (room !== undefined) room.attach(userId, conn.send);
    else if (this.queue.includes(userId)) this.sendTo(userId, { t: "queued", waiting: this.queue.length });
  }

  /**
   * The connection is gone. Ignored if it is no longer the player's current connection (a replaced
   * socket reports its close late). The player leaves the queue. Their place in a running match is
   * kept, so they can reconnect; their fish idles meanwhile.
   */
  disconnect(userId: string, conn: Connection): void {
    const client = this.clients.get(userId);
    if (client === undefined || client.conn !== conn) return;
    this.clients.delete(userId);
    this.roomByUser.get(userId)?.detach(userId);
    this.dequeue(userId);
  }

  /** Puts a connected player in the queue. A player already in a match gets `already_playing`. */
  join(userId: string): void {
    if (this.stopped || !this.clients.has(userId)) return;
    if (this.roomByUser.has(userId)) {
      this.sendTo(userId, { t: "error", code: "already_playing" });
      return;
    }
    if (!this.queue.includes(userId)) this.queue.push(userId);
    this.updateFill();
    this.tryMatch();
    this.broadcastQueued();
  }

  /** Takes a player out of the queue. During a running match this does nothing (there is no forfeit yet). */
  leave(userId: string): void {
    this.dequeue(userId);
  }

  /** Passes an input on to the player's room. False if they are not in one or the room refused it. */
  input(userId: string, msg: InputMsg): boolean {
    return this.roomByUser.get(userId)?.handleInput(userId, msg) ?? false;
  }

  /** Starts any match that is due. The timer calls this; tests call it directly. */
  pump(): void {
    if (this.stopped) return;
    if (this.tryMatch()) this.broadcastQueued();
  }

  /** Stops the timer and every room, and forgets everyone. Connections are left for the caller to close. */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
    for (const room of this.usersByRoom.keys()) {
      try {
        room.stop();
      } catch (err) {
        this.onError(err);
      }
    }
    this.usersByRoom.clear();
    this.roomByUser.clear();
    this.clients.clear();
    this.queue.length = 0;
    this.fillSince = null;
  }

  // ---- internals ----

  private dequeue(userId: string): void {
    const i = this.queue.indexOf(userId);
    if (i < 0) return;
    this.queue.splice(i, 1);
    this.updateFill();
    this.broadcastQueued();
    this.schedule();
  }

  private updateFill(): void {
    if (this.queue.length < MATCH_MIN_PLAYERS) this.fillSince = null;
    else if (this.fillSince === null) this.fillSince = this.now();
  }

  /** Starts as many matches as are due. Returns true if at least one started. */
  private tryMatch(): boolean {
    let started = false;
    for (; ;) {
      const n = this.queue.length;
      const full = n >= MATCH_MAX_PLAYERS;
      const waitedLongEnough =
        n >= MATCH_MIN_PLAYERS && this.fillSince !== null && this.now() - this.fillSince >= this.fillWaitMs;
      if (!full && !waitedLongEnough) break;
      this.startMatch(this.queue.splice(0, Math.min(n, MATCH_MAX_PLAYERS)));
      this.fillSince = null;
      this.updateFill();
      started = true;
    }
    this.schedule();
    return started;
  }

  private startMatch(userIds: readonly string[]): void {
    const members: { userId: string; name: string; send: Send }[] = [];
    for (const userId of userIds) {
      const client = this.clients.get(userId);
      if (client !== undefined) members.push({ userId, name: client.name, send: client.conn.send });
    }
    if (members.length === 0) return;

    let room: RoomLike | undefined;
    try {
      room = this.createRoom({
        seed: this.makeSeed(),
        members,
        now: this.now,
        onEnd: () => {
          if (room !== undefined) this.release(room);
        },
        onError: (err) => {
          if (room !== undefined) this.release(room);
          this.onError(err);
        },
      });
      const ids = members.map((m) => m.userId);
      this.usersByRoom.set(room, ids);
      for (const id of ids) this.roomByUser.set(id, room);
      room.start();
    } catch (err) {
      if (room !== undefined) this.release(room);
      this.onError(err);
    }
  }

  /** The room is over (or failed): its players may queue again. */
  private release(room: RoomLike): void {
    const ids = this.usersByRoom.get(room);
    if (ids === undefined) return;
    this.usersByRoom.delete(room);
    for (const id of ids) {
      if (this.roomByUser.get(id) === room) this.roomByUser.delete(id);
    }
  }

  private broadcastQueued(): void {
    const waiting = this.queue.length;
    for (const userId of this.queue) this.sendTo(userId, { t: "queued", waiting });
  }

  private sendTo(userId: string, msg: ServerMsg): void {
    const client = this.clients.get(userId);
    if (client === undefined) return;
    try {
      client.conn.send(encodeServer(msg));
    } catch {
      // A broken connection is the socket layer's problem; it will report the close.
    }
  }

  private closeQuietly(conn: Connection, code: number, reason: string): void {
    try {
      conn.close(code, reason);
    } catch {
      // already closed
    }
  }

  private schedule(): void {
    this.clearTimer();
    if (this.stopped || this.fillSince === null || this.queue.length < MATCH_MIN_PLAYERS) return;
    const delay = Math.max(1, Math.ceil(this.fillSince + this.fillWaitMs - this.now()));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
