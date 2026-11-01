import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeClient, encodeServer } from "@spitfin/shared";
import type { ServerMsg } from "@spitfin/shared";
import { NetClient, type NetSocket, type NetStatus } from "./client";

class FakeSocket implements NetSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  opened() { this.readyState = 1; this.onopen?.(); }
  receive(m: ServerMsg) { this.onmessage?.({ data: encodeServer(m) }); }
}

let sockets: FakeSocket[];
let statuses: NetStatus[];
let received: ServerMsg[];
let net: NetClient;

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  statuses = [];
  received = [];
  net = new NetClient(
    { onMessage: (m) => received.push(m), onStatus: (s) => statuses.push(s) },
    async () => "ticket",
    (t) => `ws://x/ws?ticket=${t}`,
    () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  );
});

afterEach(() => {
  net.disconnect();
  vi.useRealTimers();
});

describe("NetClient", () => {
  it("opens, delivers messages and numbers inputs", async () => {
    net.connect();
    await flush();
    sockets[0]!.opened();
    sockets[0]!.receive({ t: "welcome", tickHz: 30 });
    expect(statuses).toEqual(["connecting", "open"]);
    expect(received).toEqual([{ t: "welcome", tickHz: 30 }]);
    expect(net.sendInput({ ax: 1 })).toBe(1);
    expect(net.sendInput({ nip: true })).toBe(2);
    const last = decodeClient(sockets[0]!.sent[sockets[0]!.sent.length - 1]!);
    expect(last).toMatchObject({ t: "input", seq: 2, nip: true });
  });

  it("reconnects with a fresh socket after a drop and keeps counting seq", async () => {
    net.connect();
    await flush();
    sockets[0]!.opened();
    net.sendInput();
    sockets[0]!.close();
    expect(net.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(600);
    expect(sockets).toHaveLength(2);
    sockets[1]!.opened();
    expect(net.status).toBe("open");
    expect(net.sendInput()).toBe(2);
  });

  it("gives up once the reconnect window has passed", async () => {
    net.connect();
    await flush();
    sockets[0]!.opened();
    sockets[0]!.close();
    for (let i = 0; i < 40 && net.status === "reconnecting"; i++) {
      await vi.advanceTimersByTimeAsync(500);
      sockets[sockets.length - 1]!.close();
    }
    expect(net.status).toBe("closed");
  });
});
