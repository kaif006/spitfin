import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { LAG_REWIND_MAX, TICK_HZ } from "@spitfin/shared";
import type { Connection } from "./rooms/lobby.js";
import { fakeRedis } from "./test-support/fakeRedis.js";
import { issueTicket } from "./security/ticket.js";
import { attachWs, type AuthedSocket, type WsDeps, type WsLobby } from "./ws.js";

let server: Server;
let wss: WebSocketServer;
let store: ReturnType<typeof fakeRedis>;
let lobby: ReturnType<typeof fakeLobby>;
let base: string;
const opened: WebSocket[] = [];

/** Records what the socket layer asks of the lobby. */
function fakeLobby() {
  const calls: unknown[][] = [];
  const conns = new Map<string, Connection>();
  const lobby: WsLobby & { calls: unknown[][]; conns: Map<string, Connection> } = {
    calls,
    conns,
    connect(userId, name, conn) {
      calls.push(["connect", userId, name]);
      conns.set(userId, conn);
    },
    disconnect(userId) {
      calls.push(["disconnect", userId]);
    },
    join(userId) {
      calls.push(["join", userId]);
    },
    leave(userId) {
      calls.push(["leave", userId]);
    },
    input(userId, msg) {
      calls.push(["input", userId, msg]);
      return true;
    },
    setRewind(userId, seconds) {
      calls.push(["setRewind", userId, seconds]);
    },
  };
  return lobby;
}

const findName = async (id: string) => (id === "ghost" ? null : `Name of ${id}`);

async function start(extra: Partial<WsDeps> = {}) {
  server = createServer();
  wss = attachWs(server, { tickets: store, lobby, findName, ...extra });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  for (const c of wss.clients) c.terminate();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeEach(async () => {
  store = fakeRedis();
  lobby = fakeLobby();
  await start();
});

afterEach(async () => {
  for (const c of opened.splice(0)) c.terminate();
  await stop();
});

type Outcome = { status: number } | { ws: WebSocket; first: unknown };

function attempt(url: string, origin?: string): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : undefined);
    opened.push(ws);
    ws.once("message", (data) => resolve({ ws, first: JSON.parse(data.toString()) }));
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    ws.once("error", reject);
  });
}

async function open(url: string, origin?: string) {
  const out = await attempt(url, origin);
  if (!("ws" in out)) throw new Error(`expected an open socket, got HTTP ${out.status}`);
  return out;
}

async function refusedWith(url: string, origin?: string): Promise<number> {
  const out = await attempt(url, origin);
  if ("ws" in out) throw new Error("expected the connection to be refused");
  return out.status;
}

/** A signed-in socket, already past the welcome message. */
async function signedIn(userId = "user-1") {
  const ticket = await issueTicket(store, userId);
  return (await open(`${base}/ws?ticket=${ticket}`)).ws;
}

function closing(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) =>
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
}

async function until(cond: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for a condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const calls = (name: string) => lobby.calls.filter((c) => c[0] === name);

describe("websocket tickets", () => {
  it("accepts a valid ticket, greets the client, and registers it with the lobby", async () => {
    const ticket = await issueTicket(store, "user-1");
    const { first } = await open(`${base}/ws?ticket=${ticket}`);
    expect(first).toEqual({ t: "welcome", tickHz: TICK_HZ });
    const [client] = [...wss.clients] as AuthedSocket[];
    expect(client?.userId).toBe("user-1");
    expect(client?.displayName).toBe("Name of user-1");
    expect(lobby.calls).toEqual([["connect", "user-1", "Name of user-1"]]);
  });

  it("lets a ticket work only once", async () => {
    const ticket = await issueTicket(store, "user-1");
    await open(`${base}/ws?ticket=${ticket}`);
    expect(await refusedWith(`${base}/ws?ticket=${ticket}`)).toBe(401);
  });

  it("refuses a missing, malformed or unknown ticket with 401", async () => {
    for (const q of ["", "?ticket=", "?ticket=short", `?ticket=${"A".repeat(43)}`]) {
      expect(await refusedWith(`${base}/ws${q}`)).toBe(401);
    }
  });

  it("refuses a foreign Origin with 403 and leaves the ticket unused", async () => {
    const ticket = await issueTicket(store, "user-1");
    const url = `${base}/ws?ticket=${ticket}`;
    expect(await refusedWith(url, "https://evil.example")).toBe(403);
    expect(await refusedWith(url, "null")).toBe(403);
    await open(url);
  });

  it("accepts an Origin that matches the host", async () => {
    const ticket = await issueTicket(store, "user-1");
    await open(`${base}/ws?ticket=${ticket}`, base.replace("ws://", "http://"));
  });

  it("refuses other paths with 404", async () => {
    const ticket = await issueTicket(store, "user-1");
    expect(await refusedWith(`${base}/other?ticket=${ticket}`)).toBe(404);
    expect(await refusedWith(`${base}/ws/extra?ticket=${ticket}`)).toBe(404);
  });

  it("answers 503 when the ticket store fails", async () => {
    // Restart the server with a store that always errors.
    await stop();
    store = {
      set: async () => "OK",
      getdel: async () => {
        throw new Error("redis down");
      },
    } as unknown as ReturnType<typeof fakeRedis>;
    await start();
    expect(await refusedWith(`${base}/ws?ticket=${"A".repeat(43)}`)).toBe(503);
  });

  it("refuses a ticket for a user that no longer exists with 401", async () => {
    const ticket = await issueTicket(store, "ghost");
    expect(await refusedWith(`${base}/ws?ticket=${ticket}`)).toBe(401);
    expect(lobby.calls).toEqual([]);
  });

  it("answers 503 when the name lookup fails", async () => {
    await stop();
    await start({
      findName: async () => {
        throw new Error("postgres down");
      },
    });
    const ticket = await issueTicket(store, "user-1");
    expect(await refusedWith(`${base}/ws?ticket=${ticket}`)).toBe(503);
  });
});

describe("messages", () => {
  it("answers ping with pong", async () => {
    const ws = await signedIn();
    const reply = new Promise<unknown>((resolve) =>
      ws.once("message", (d) => resolve(JSON.parse(d.toString()))),
    );
    ws.send(JSON.stringify({ t: "ping", n: 7 }));
    expect(await reply).toEqual({ t: "pong", n: 7 });
  });

  it("routes join, leave and input to the lobby for this user", async () => {
    const ws = await signedIn("user-2");
    const input = { t: "input", seq: 5, ax: 1, az: 0, spit: false, yaw: 0.5, pitch: 0.1, nip: false };
    ws.send(JSON.stringify({ t: "join" }));
    ws.send(JSON.stringify(input));
    ws.send(JSON.stringify({ t: "leave" }));
    await until(() => lobby.calls.length >= 4);
    expect(calls("join")).toEqual([["join", "user-2"]]);
    expect(calls("leave")).toEqual([["leave", "user-2"]]);
    expect(calls("input")).toHaveLength(1);
    expect(calls("input")[0]?.[1]).toBe("user-2");
    expect(calls("input")[0]?.[2]).toMatchObject({ seq: 5, ax: 1, az: 0, yaw: 0.5, pitch: 0.1 });
  });

  it("delivers what the lobby sends and obeys its close", async () => {
    const ws = await signedIn();
    const conn = lobby.conns.get("user-1")!;
    const got = new Promise<string>((resolve) => ws.once("message", (d) => resolve(d.toString())));
    conn.send('{"t":"queued","waiting":1}');
    expect(await got).toBe('{"t":"queued","waiting":1}');
    const closed = closing(ws);
    conn.close(4001, "replaced");
    expect(await closed).toEqual({ code: 4001, reason: "replaced" });
  });

  it("closes with 1008 on anything the codec rejects", async () => {
    const bad = [
      "not json",
      JSON.stringify({ t: "nope" }),
      JSON.stringify({ t: "input", seq: 0, ax: 99, az: 0, spit: false, yaw: 0, pitch: 0, nip: false }),
    ];
    for (const text of bad) {
      const ws = await signedIn();
      const closed = closing(ws);
      ws.send(text);
      expect((await closed).code).toBe(1008);
    }
    expect(calls("input")).toEqual([]);
  });

  it("closes with 1003 on a binary frame", async () => {
    const ws = await signedIn();
    const closed = closing(ws);
    ws.send(Buffer.from([1, 2, 3]));
    expect((await closed).code).toBe(1003);
  });

  it("closes a socket that sends too fast", async () => {
    await stop();
    await start({ rate: { perSecond: 1, burst: 5 } });
    const ws = await signedIn();
    const closed = closing(ws);
    for (let i = 0; i < 20; i++) ws.send(JSON.stringify({ t: "ping", n: i }));
    expect(await closed).toEqual({ code: 1008, reason: "rate" });
  });

  it("measures latency with ping frames and passes it to the lobby", async () => {
    await stop();
    await start({ pingMs: 20 });
    await signedIn("user-4");
    await until(() => calls("setRewind").length >= 1);
    const [, id, seconds] = calls("setRewind")[0]!;
    expect(id).toBe("user-4");
    expect(seconds as number).toBeGreaterThanOrEqual(0);
    expect(seconds as number).toBeLessThanOrEqual(LAG_REWIND_MAX);
  });
});

describe("closing", () => {
  it("tells the lobby when the socket closes", async () => {
    const ws = await signedIn("user-3");
    expect(calls("disconnect")).toEqual([]);
    ws.close();
    await until(() => calls("disconnect").length === 1);
    expect(calls("disconnect")).toEqual([["disconnect", "user-3"]]);
  });
});
