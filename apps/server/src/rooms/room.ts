// An authoritative match room. It owns one SimState, runs it at 30 Hz, and talks to its players
// through plain `send(data: string)` callbacks. It knows nothing about sockets, accounts or
// matchmaking, so it can be tested without a network.

import {
  LAG_REWIND_MAX,
  NO_BUG,
  NO_OBSTACLE,
  NO_VICTIM,
  TICK_HZ,
  WIRE_MAX_AXIS,
  WIRE_MAX_EVENTS,
  WIRE_MAX_PLAYERS,
  encodeServer,
  isDashing,
  makeSimInput,
  newSim,
  simRanking,
  stepSim,
} from "@spitfin/shared";
import type {
  ClientMsg,
  ServerMsg,
  SimEvent,
  SimInput,
  SimPlayer,
  SimState,
  WireEvent,
  WireHit,
  WirePlayer,
  WireRank,
  WireRosterEntry,
} from "@spitfin/shared";

/** Snapshots go out at 15 Hz, which is every second sim tick. */
export const SNAPSHOT_HZ = 15;
export const SNAPSHOT_EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ);
/** At most this many unapplied inputs are kept per player (about 200 ms). Older ones are merged away. */
export const MAX_INPUT_QUEUE = 6;
/** If a player's input is late, their last movement is repeated for at most this many ticks, then they idle. */
export const MAX_HOLD_TICKS = 5;
/** After a stall the room runs at most this many ticks at once and then gives up the lost time. */
export const MAX_CATCHUP_TICKS = 5;

const MAX_SEQ = 0xffffffff;

export type InputMsg = Extract<ClientMsg, { t: "input" }>;
export type Send = (data: string) => void;

export interface RoomMemberInit {
  userId: string;
  name: string;
  /** Delivers one encoded message. Null means the player is not connected right now. */
  send: Send | null;
}

export interface RoomOptions {
  /** Match seed, an unsigned 32-bit integer. */
  seed: number;
  /** 1 to 4 players. Sim player ids are their positions in this list (0, 1, 2, 3). */
  members: readonly RoomMemberInit[];
  /** Milliseconds from a monotonic clock. Tests pass a fake one. */
  now?: () => number;
  /** Called once, after the final snapshot and the `end` message have been sent. */
  onEnd?: (room: Room) => void;
  /** Called when the room hits an internal error. The room stops itself first. */
  onError?: (err: unknown) => void;
}

interface QueuedInput {
  seq: number;
  ax: number;
  az: number;
  spit: boolean;
  yaw: number;
  pitch: number;
  nip: boolean;
}

interface Member {
  readonly id: number;
  readonly userId: string;
  readonly name: string;
  send: Send | null;
  queue: QueuedInput[];
  lastSeq: number; // highest seq accepted so far
  ack: number; // seq of the last input applied to the sim (-1 before any)
  heldAx: number;
  heldAz: number;
  holdLeft: number; // ticks left in which the last movement is repeated
  rewind: number; // lag compensation in seconds
}

type RoomState = "new" | "running" | "ended" | "stopped";

const r2 = (v: number): number => Math.round(v * 100) / 100;
const clampAxis = (v: number): number => (v < -WIRE_MAX_AXIS ? -WIRE_MAX_AXIS : v > WIRE_MAX_AXIS ? WIRE_MAX_AXIS : v);

function wirePlayer(p: SimPlayer, t: number): WirePlayer {
  return {
    id: p.id,
    x: r2(p.x),
    z: r2(p.z),
    vx: r2(p.vx),
    vz: r2(p.vz),
    // Rounded, but never outside [-PI, PI] (rounding up could pass PI by a hair).
    facing: Math.max(-Math.PI, Math.min(Math.PI, Math.round(p.facing * 1000) / 1000)),
    stash: p.stash,
    eaten: p.bugsEaten,
    shots: p.shots,
    hits: p.hits,
    nips: p.nipsUsed,
    spitCd: r2(Math.max(0, p.nextSpitTime - t)),
    nipCd: r2(Math.max(0, p.nipReadyTime - t)),
    dash: isDashing(p, t),
    immune: t < p.immuneUntil,
  };
}

export class Room {
  readonly seed: number;
  /** The authoritative state. Treat it as read-only outside this class (tests poke it on purpose). */
  readonly sim: SimState;

  private readonly members: Member[];
  private readonly byUser = new Map<string, Member>();
  private readonly inputs: SimInput[];
  private readonly simEvents: SimEvent[] = [];
  private readonly pending: WireEvent[] = [];
  private readonly clock: () => number;
  private readonly onEnd: ((room: Room) => void) | undefined;
  private readonly onError: (err: unknown) => void;
  private startMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: RoomState = "new";

  constructor(opts: RoomOptions) {
    const n = opts.members.length;
    if (n < 1 || n > WIRE_MAX_PLAYERS) {
      throw new RangeError(`a room needs 1 to ${WIRE_MAX_PLAYERS} players, got ${n}`);
    }
    if (!Number.isInteger(opts.seed) || opts.seed < 0 || opts.seed > MAX_SEQ) {
      throw new RangeError("seed must be an unsigned 32-bit integer");
    }
    this.seed = opts.seed;
    this.clock = opts.now ?? (() => performance.now());
    this.onEnd = opts.onEnd;
    this.onError = opts.onError ?? ((err) => console.error("room error", err));

    this.members = opts.members.map((init, id) => ({
      id,
      userId: init.userId,
      name: init.name,
      send: init.send,
      queue: [],
      lastSeq: -1,
      ack: -1,
      heldAx: 0,
      heldAz: 0,
      holdLeft: 0,
      rewind: 0,
    }));
    for (const m of this.members) {
      if (this.byUser.has(m.userId)) throw new Error(`duplicate user ${m.userId}`);
      this.byUser.set(m.userId, m);
    }

    this.sim = newSim(opts.seed, this.members.map((m) => m.id));
    this.inputs = this.members.map(() => makeSimInput());
  }

  get tick(): number {
    return this.sim.tick;
  }

  get running(): boolean {
    return this.state === "running";
  }

  /** True once the match has played to its end. */
  get over(): boolean {
    return this.state === "ended";
  }

  has(userId: string): boolean {
    return this.byUser.has(userId);
  }

  playerId(userId: string): number | undefined {
    return this.byUser.get(userId)?.id;
  }

  roster(): WireRosterEntry[] {
    return this.members.map((m) => ({ id: m.id, name: m.name }));
  }

  /** Sends `start` and a baseline snapshot to everyone connected, then begins ticking. */
  start(): void {
    if (this.state !== "new") throw new Error("room already started");
    this.state = "running";
    this.startMs = this.clock();
    for (const m of this.members) this.sendTo(m, this.startMsg(m));
    this.flushSnapshot();
    this.schedule();
  }

  /** Stops ticking without telling anyone (used on server shutdown). Safe to call at any time. */
  stop(): void {
    if (this.state === "new" || this.state === "running") this.state = "stopped";
    this.clearTimer();
  }

  /**
   * Queues one input from a player. Returns false (and ignores it) if the room is not running, the
   * player is unknown, `seq` is not newer than the last accepted one, or a value is invalid.
   */
  handleInput(userId: string, msg: InputMsg): boolean {
    if (this.state !== "running") return false;
    const m = this.byUser.get(userId);
    if (m === undefined) return false;
    if (!Number.isInteger(msg.seq) || msg.seq < 0 || msg.seq > MAX_SEQ || msg.seq <= m.lastSeq) return false;
    if (!Number.isFinite(msg.ax) || !Number.isFinite(msg.az)) return false;
    if (!Number.isFinite(msg.yaw) || !Number.isFinite(msg.pitch)) return false;
    if (typeof msg.spit !== "boolean" || typeof msg.nip !== "boolean") return false;

    m.lastSeq = msg.seq;
    if (m.queue.length >= MAX_INPUT_QUEUE) this.dropOldest(m);
    m.queue.push({
      seq: msg.seq,
      ax: clampAxis(msg.ax),
      az: clampAxis(msg.az),
      spit: msg.spit,
      yaw: msg.yaw,
      pitch: msg.pitch,
      nip: msg.nip,
    });
    return true;
  }

  /** Lag compensation for this player's spits, in seconds (capped at LAG_REWIND_MAX). */
  setRewind(userId: string, seconds: number): boolean {
    const m = this.byUser.get(userId);
    if (m === undefined) return false;
    m.rewind = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), LAG_REWIND_MAX) : 0;
    return true;
  }

  /** The player's connection is gone. Their fish keeps swimming idle and can still be nipped. */
  detach(userId: string): boolean {
    const m = this.byUser.get(userId);
    if (m === undefined) return false;
    this.drop(m);
    return true;
  }

  /**
   * Gives the player a (new) connection. A running room sends `start` and a snapshot at once so the
   * client can pick up. The input counters restart, because a fresh client counts from 0 again.
   */
  attach(userId: string, send: Send): boolean {
    const m = this.byUser.get(userId);
    if (m === undefined || this.state === "ended" || this.state === "stopped") return false;
    m.send = send;
    m.queue.length = 0;
    m.lastSeq = -1;
    m.ack = -1;
    m.holdLeft = 0;
    if (this.state === "running") {
      this.sendTo(m, this.startMsg(m));
      this.sendTo(m, this.snapshotMsg(m, this.wirePlayers(), []));
    }
    return true;
  }

  /** Runs every tick that is due by the clock. The timer calls this; tests call it directly. */
  pump(): void {
    if (this.state !== "running") return;
    try {
      let due = Math.floor(((this.clock() - this.startMs) * TICK_HZ) / 1000) - this.sim.tick;
      if (due > MAX_CATCHUP_TICKS) {
        // The process stalled. Give up the lost time instead of fast-forwarding the match.
        this.startMs += ((due - MAX_CATCHUP_TICKS) * 1000) / TICK_HZ;
        due = MAX_CATCHUP_TICKS;
      }
      for (let i = 0; i < due && this.state === "running"; i++) this.step();
    } catch (err) {
      this.fail(err);
    }
  }

  // ---- internals ----

  private readonly onTimer = (): void => {
    this.timer = null;
    this.pump();
    if (this.state === "running") this.schedule();
  };

  private schedule(): void {
    const nextAt = this.startMs + ((this.sim.tick + 1) * 1000) / TICK_HZ;
    const delay = Math.max(1, Math.ceil(nextAt - this.clock()));
    this.timer = setTimeout(this.onTimer, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private fail(err: unknown): void {
    if (this.state === "running") this.state = "stopped";
    this.clearTimer();
    this.onError(err);
  }

  private step(): void {
    const s = this.sim;
    this.fillInputs();
    this.simEvents.length = 0;
    stepSim(s, this.inputs, this.simEvents);
    this.collectEvents();
    if (s.over) {
      this.finish();
      return;
    }
    if (s.tick % SNAPSHOT_EVERY === 0) this.flushSnapshot();
  }

  /** One queued input per player per tick. A late player repeats their last movement for a short while. */
  private fillInputs(): void {
    for (const m of this.members) {
      const inp = this.inputs[m.id];
      const q = m.queue.shift();
      if (q !== undefined) {
        m.ack = q.seq;
        m.heldAx = q.ax;
        m.heldAz = q.az;
        m.holdLeft = MAX_HOLD_TICKS;
        inp.ax = q.ax;
        inp.az = q.az;
        inp.spit = q.spit;
        inp.yaw = q.yaw;
        inp.pitch = q.pitch;
        inp.nip = q.nip;
      } else if (m.holdLeft > 0) {
        m.holdLeft -= 1;
        inp.ax = m.heldAx;
        inp.az = m.heldAz;
        inp.spit = false;
        inp.yaw = 0;
        inp.pitch = 0;
        inp.nip = false;
      } else {
        inp.ax = 0;
        inp.az = 0;
        inp.spit = false;
        inp.yaw = 0;
        inp.pitch = 0;
        inp.nip = false;
      }
      inp.rewind = m.rewind;
    }
  }

  /** The queue is full: drop the oldest input but pass its spit and nip on, so a button press is never lost. */
  private dropOldest(m: Member): void {
    const old = m.queue.shift();
    const next = m.queue[0];
    if (old === undefined || next === undefined) return;
    if (old.spit && !next.spit) {
      next.spit = true;
      next.yaw = old.yaw;
      next.pitch = old.pitch;
    }
    if (old.nip) next.nip = true;
  }

  private collectEvents(): void {
    const tick = this.sim.tick;
    for (const e of this.simEvents) {
      switch (e.type) {
        case "spit":
          this.pending.push({
            type: "spit",
            tick,
            playerId: e.playerId,
            length: r2(e.length),
            hit: this.hitFor(e.hitBugId),
            blockedBy: e.blockedBy === NO_OBSTACLE ? null : e.blockedBy,
          });
          break;
        case "nip":
          this.pending.push({
            type: "nip",
            tick,
            thiefId: e.thiefId,
            victimId: e.victimId === NO_VICTIM ? null : e.victimId,
          });
          break;
        case "eat":
          this.pending.push({ type: "eat", tick, playerId: e.playerId, bugId: e.bugId });
          break;
        case "end":
          break; // the end of the match is announced by `finish`
      }
    }
  }

  /**
   * Where the jet hit the bug. This is exactly the position the sim used to start the fall, and it is
   * not rounded, so a client that calls makeFallingBug(seed, bugId, tick / TICK_HZ, hit) gets an
   * identical fall.
   */
  private hitFor(bugId: number): WireHit | null {
    if (bugId === NO_BUG) return null;
    const shot = this.sim.shot;
    for (let i = shot.length - 1; i >= 0; i--) {
      const fb = shot[i].fall;
      if (fb.bugId === bugId) return { bugId, x: fb.startX, y: fb.startY, z: fb.startZ };
    }
    return null;
  }

  private wirePlayers(): WirePlayer[] {
    const t = this.sim.time;
    return this.sim.players.map((p) => wirePlayer(p, t));
  }

  private startMsg(m: Member): ServerMsg {
    return { t: "start", seed: this.seed, you: m.id, players: this.roster() };
  }

  private snapshotMsg(m: Member, players: WirePlayer[], events: WireEvent[]): ServerMsg {
    return { t: "snap", tick: this.sim.tick, ack: m.ack, players, events };
  }

  /** Sends one snapshot with up to WIRE_MAX_EVENTS pending events. Any extra events wait for the next one. */
  private flushSnapshot(): void {
    const players = this.wirePlayers();
    const events = this.pending.splice(0, WIRE_MAX_EVENTS);
    for (const m of this.members) {
      if (m.send !== null) this.sendTo(m, this.snapshotMsg(m, players, events));
    }
  }

  private finish(): void {
    this.state = "ended";
    this.clearTimer();
    do {
      this.flushSnapshot();
    } while (this.pending.length > 0);
    const ranking: WireRank[] = simRanking(this.sim).map((r) => ({
      id: r.id,
      rank: r.rank,
      stash: r.stash,
      eaten: r.bugsEaten,
      nips: r.nipsUsed,
    }));
    for (const m of this.members) this.sendTo(m, { t: "end", ranking });
    this.onEnd?.(this);
  }

  private sendTo(m: Member, msg: ServerMsg): void {
    if (m.send === null) return;
    const data = encodeServer(msg);
    try {
      m.send(data);
    } catch {
      this.drop(m); // a broken connection must never disturb the other players
    }
  }

  private drop(m: Member): void {
    m.send = null;
    m.queue.length = 0;
    m.holdLeft = 0;
  }
}
