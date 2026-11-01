import { decodeServer, encodeClient } from "@spitfin/shared";
import type { ClientMsg, ServerMsg } from "@spitfin/shared";

export type NetStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** The part of a WebSocket that NetClient uses. */
export interface NetSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface NetHandlers {
  onMessage(m: ServerMsg): void;
  onStatus(s: NetStatus): void;
}

type InputMsg = Extract<ClientMsg, { t: "input" }>;
export type InputFields = Omit<InputMsg, "t" | "seq">;

/** Matches the server's reconnect window. */
export const RECONNECT_WINDOW_MS = 10_000;
const RETRY_MS = 500;
const PING_MS = 2000;
const OPEN = 1;

const defaultOpen = (url: string): NetSocket => new WebSocket(url) as unknown as NetSocket;

export class NetClient {
  status: NetStatus = "idle";
  /** Smoothed round trip time in ms (0 until the first pong). */
  rtt = 0;

  private ws: NetSocket | null = null;
  private seq = 0;
  private pingN = 0;
  private sentAt = new Map<number, number>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private dropAt = 0;
  private wasOpen = false;
  private stopped = false;

  constructor(
    private readonly handlers: NetHandlers,
    private readonly getTicket: () => Promise<string>,
    private readonly urlFor: (ticket: string) => string,
    private readonly open: (url: string) => NetSocket = defaultOpen,
    private readonly now: () => number = () => Date.now(),
  ) { }

  connect(): void {
    this.stopped = false;
    this.setStatus(this.wasOpen ? "reconnecting" : "connecting");
    void this.dial();
  }

  disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.setStatus("closed");
  }

  join(): void {
    this.send({ t: "join" });
  }

  leave(): void {
    this.send({ t: "leave" });
  }

  /** Sends one input with the next sequence number and returns that number (0 if the socket is not open). */
  sendInput(fields: Partial<InputFields> = {}): number {
    if (!this.ws || this.ws.readyState !== OPEN) return 0;
    this.seq += 1;
    this.send({ t: "input", seq: this.seq, ax: 0, az: 0, spit: false, yaw: 0, pitch: 0, nip: false, ...fields });
    return this.seq;
  }

  private send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(encodeClient(msg));
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus(s);
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }

  private async dial(): Promise<void> {
    let ws: NetSocket;
    try {
      const ticket = await this.getTicket();
      if (this.stopped) return;
      ws = this.open(this.urlFor(ticket));
    } catch {
      this.lost();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.wasOpen = true;
      this.setStatus("open");
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), PING_MS);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = decodeServer(e.data);
      if (m === null) return;
      if (m.t === "pong") {
        const t0 = this.sentAt.get(m.n);
        this.sentAt.delete(m.n);
        if (t0 !== undefined) {
          const sample = this.now() - t0;
          this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2;
        }
        return;
      }
      this.handlers.onMessage(m);
    };
    ws.onerror = () => { };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.lost();
    };
  }

  private ping(): void {
    this.pingN += 1;
    this.sentAt.set(this.pingN, this.now());
    this.send({ t: "ping", n: this.pingN });
  }

  /** The socket dropped or never opened. Retry until the reconnect window is used up. */
  private lost(): void {
    if (this.stopped) return;
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.sentAt.clear();
    if (this.status === "open" || this.dropAt === 0) this.dropAt = this.now();
    if (!this.wasOpen || this.now() - this.dropAt >= RECONNECT_WINDOW_MS) {
      this.setStatus("closed");
      return;
    }
    this.setStatus("reconnecting");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.dial();
    }, RETRY_MS);
  }
}
