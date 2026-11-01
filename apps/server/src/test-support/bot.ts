import { WebSocket } from "ws";
import { decodeServer, encodeClient } from "@spitfin/shared";
import type { ClientMsg, ServerMsg, WireEvent } from "@spitfin/shared";

type Msg<T extends ServerMsg["t"]> = Extract<ServerMsg, { t: T }>;

/** The fields of an `input` message that a script chooses (the bot fills in `t` and `seq`). */
export type InputFields = Omit<Extract<ClientMsg, { t: "input" }>, "t" | "seq">;

/** Polls every 2 ms until `cond` is true. Throws if it takes longer than `ms`. */
export async function waitUntil(cond: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

/**
 * A test client that plays the part of a browser: it connects with a ticket, sends what it is told
 * to, and records everything the server sends back.
 */
export class Bot {
  welcome: Msg<"welcome"> | null = null;
  start: Msg<"start"> | null = null;
  end: Msg<"end"> | null = null;
  /** The `waiting` count of every `queued` message, in order. */
  queued: number[] = [];
  /** The `code` of every `error` message. */
  errors: string[] = [];
  lastSnap: Msg<"snap"> | null = null;
  snapCount = 0;
  /** False once a snapshot arrives with a lower tick than the one before it. */
  ticksNeverGoBack = true;
  /** How far this bot's own fish moved between snapshots, added up. */
  travel = 0;
  /** How many events of each type arrived. */
  eventTypes = new Map<string, number>();
  /** Every event received, in order. */
  events: WireEvent[] = [];
  /** Messages that `decodeServer` rejected. */
  undecodable = 0;
  closed: { code: number; reason: string } | null = null;
  /** The sequence number of the last input actually sent. */
  lastSeq = 0;

  private seq = 0;
  private prev: { x: number; z: number } | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => this.onMessage(data.toString()));
    ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
    ws.on("error", () => { });
  }

  /** Opens a socket. Rejects if the server refuses the upgrade. */
  static connect(url: string): Promise<Bot> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const bot = new Bot(ws);
      ws.once("open", () => resolve(bot));
      ws.once("unexpected-response", (_req, res) => {
        res.resume();
        reject(new Error(`connection refused with HTTP ${res.statusCode}`));
      });
      ws.once("error", reject);
    });
  }

  join(): void {
    this.send({ t: "join" });
  }

  leave(): void {
    this.send({ t: "leave" });
  }

  /** Sends one input with the next sequence number. Anything not given is zero or false. */
  input(fields: Partial<InputFields> = {}): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.seq += 1;
    this.lastSeq = this.seq;
    this.send({
      t: "input",
      seq: this.seq,
      ax: 0,
      az: 0,
      spit: false,
      yaw: 0,
      pitch: 0,
      nip: false,
      ...fields,
    });
  }

  /** Closes politely. */
  close(): void {
    this.ws.close();
  }

  /** Closes at once without a goodbye. */
  terminate(): void {
    this.ws.terminate();
  }

  private send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeClient(msg));
  }

  private onMessage(raw: string): void {
    const m = decodeServer(raw);
    if (m === null) {
      this.undecodable += 1;
      return;
    }
    switch (m.t) {
      case "welcome":
        this.welcome = m;
        break;
      case "queued":
        this.queued.push(m.waiting);
        break;
      case "start":
        this.start = m;
        break;
      case "snap":
        this.onSnap(m);
        break;
      case "end":
        this.end = m;
        break;
      case "error":
        this.errors.push(m.code);
        break;
    }
  }

  private onSnap(m: Msg<"snap">): void {
    if (this.lastSnap !== null && m.tick < this.lastSnap.tick) this.ticksNeverGoBack = false;
    this.lastSnap = m;
    this.snapCount += 1;
    for (const e of m.events) this.events.push(e);
    for (const e of m.events) this.eventTypes.set(e.type, (this.eventTypes.get(e.type) ?? 0) + 1);

    const me = this.start === null ? undefined : m.players[this.start.you];
    if (me !== undefined) {
      if (this.prev !== null) this.travel += Math.hypot(me.x - this.prev.x, me.z - this.prev.z);
      this.prev = { x: me.x, z: me.z };
    }
  }
}
