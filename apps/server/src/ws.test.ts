import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { TICK_HZ } from "@spitfin/shared";
import { fakeRedis } from "./test-support/fakeRedis.js";
import { issueTicket } from "./security/ticket.js";
import { attachWs, type AuthedSocket } from "./ws.js";

let server: Server;
let wss: WebSocketServer;
let store: ReturnType<typeof fakeRedis>;
let base: string;
const opened: WebSocket[] = [];

async function start(tickets: Parameters<typeof attachWs>[1]["tickets"]) {
  server = createServer();
  wss = attachWs(server, { tickets });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  store = fakeRedis();
  await start(store);
});

afterEach(async () => {
  for (const c of opened.splice(0)) c.terminate();
  for (const c of wss.clients) c.terminate();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

describe("websocket tickets", () => {
  it("accepts a valid ticket, greets the client and records who it is", async () => {
    const ticket = await issueTicket(store, "user-1");
    const { first } = await open(`${base}/ws?ticket=${ticket}`);
    expect(first).toEqual({ t: "welcome", tickHz: TICK_HZ });
    const [client] = [...wss.clients] as AuthedSocket[];
    expect(client?.userId).toBe("user-1");
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
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await start({
      set: async () => "OK",
      getdel: async () => {
        throw new Error("redis down");
      },
    });
    expect(await refusedWith(`${base}/ws?ticket=${"A".repeat(43)}`)).toBe(503);
  });

  it("still answers ping with pong after the upgrade", async () => {
    const ticket = await issueTicket(store, "user-1");
    const { ws } = await open(`${base}/ws?ticket=${ticket}`);
    const reply = new Promise<unknown>((resolve) =>
      ws.once("message", (d) => resolve(JSON.parse(d.toString()))),
    );
    ws.send(JSON.stringify({ t: "ping", n: 7 }));
    expect(await reply).toEqual({ t: "pong", n: 7 });
  });
});
