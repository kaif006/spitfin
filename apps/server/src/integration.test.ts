import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocketServer } from "ws";
import { TICK_HZ } from "@spitfin/shared";
import { Lobby } from "./rooms/lobby.js";
import { Room } from "./rooms/room.js";
import { issueTicket } from "./security/ticket.js";
import { Bot, waitUntil, type InputFields } from "./test-support/bot.js";
import { fakeRedis } from "./test-support/fakeRedis.js";
import { attachWs } from "./ws.js";

const TICK_MS = 1000 / TICK_HZ;
const SEED = 4242;
/** Real milliseconds: the lobby's reconnect timer is a real timer. */
const RECONNECT_WINDOW = 300;
/** Generous guard: a match is 150 s, this allows 300 s of ticks. */
const MAX_TICKS = 300 * TICK_HZ;

let server: Server;
let wss: WebSocketServer;
let lobby: Lobby;
let store: ReturnType<typeof fakeRedis>;
let base: string;
let clock: number; // the lobby's and every room's clock, in ms. The tests move it by hand.
let lobbyErrors: unknown[];
const bots: Bot[] = [];

beforeEach(async () => {
  clock = 0;
  lobbyErrors = [];
  store = fakeRedis();
  lobby = new Lobby({
    now: () => clock,
    makeSeed: () => SEED,
    reconnectWindowMs: RECONNECT_WINDOW,
    onError: (err) => lobbyErrors.push(err),
  });
  server = createServer();
  wss = attachWs(server, {
    tickets: store,
    lobby,
    findName: async (id) => `Name of ${id}`,
    // Bots send faster than real time, so the per-socket cap must not get in the way.
    rate: { perSecond: 1_000_000, burst: 1_000_000 },
    pingMs: 60_000,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const b of bots.splice(0)) b.terminate();
  lobby.stop();
  for (const c of wss.clients) c.terminate();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connectBot(userId: string): Promise<Bot> {
  const ticket = await issueTicket(store, userId);
  const bot = await Bot.connect(`${base}/ws?ticket=${ticket}`);
  bots.push(bot);
  await waitUntil(() => bot.welcome !== null, `welcome for ${userId}`);
  return bot;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Lets the sockets deliver what was just sent. */
async function yieldIo(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** What bot number `k` does on tick `i`: swim about, spit now and then, nip now and then. */
function script(k: number, i: number): Partial<InputFields> {
  const phase = (i + k * 17) % 120;
  return {
    ax: phase < 60 ? 1 : -1,
    az: k % 2 === 0 ? 0.5 : -0.5,
    yaw: ((i + k * 40) % 62) / 10 - 3.1,
    pitch: 0.3,
    spit: i % 20 === k,
    nip: i % 45 === k * 5,
  };
}

/** One server tick: every bot sends an input, the clock moves on by one tick, the room runs it. */
async function tickOnce(room: Room, i: number, active: readonly Bot[]): Promise<void> {
  active.forEach((bot, k) => bot.input(script(k, i)));
  await yieldIo();
  clock += TICK_MS;
  room.pump();
}

/** Two bots in a running match. The second join leaves the queue short of full, so the fill wait is moved past. */
async function startTwoBotMatch(): Promise<{ a: Bot; b: Bot; room: Room }> {
  const a = await connectBot("u1");
  const b = await connectBot("u2");
  a.join();
  b.join();
  await waitUntil(() => lobby.queueSize === 2, "both bots queued");
  clock += 5000;
  lobby.pump();
  await waitUntil(() => a.start !== null && b.start !== null, "start for both bots");
  const room = lobby.roomOf("u1");
  expect(room).toBeInstanceOf(Room);
  return { a, b, room: room as unknown as Room };
}

describe("a whole match through the real socket layer", () => {
  it(
    "four bots play from the queue to the end card",
    async () => {
      const ids = ["u1", "u2", "u3", "u4"];
      const four: Bot[] = [];
      for (const id of ids) four.push(await connectBot(id));
      for (const b of four) {
        expect(b.welcome?.tickHz).toBe(TICK_HZ);
        b.join();
      }

      // A full queue starts at once, with no fill wait.
      await waitUntil(() => four.every((b) => b.start !== null), "start for all four bots");
      const first = four[0]!;
      for (const [n, b] of four.entries()) {
        expect(b.start?.seed).toBe(SEED);
        expect(b.start?.players).toEqual(first.start?.players);
        const me = b.start?.players.find((p) => p.id === b.start?.you);
        expect(me?.name).toBe(`Name of ${ids[n]}`);
      }
      expect(four.map((b) => b.start?.you).sort()).toEqual([0, 1, 2, 3]);

      const roomLike = lobby.roomOf("u1");
      expect(roomLike).toBeInstanceOf(Room);
      expect(lobby.roomCount).toBe(1);
      const room = roomLike as unknown as Room;

      for (let i = 0; i < MAX_TICKS && four.some((b) => b.end === null); i++) {
        await tickOnce(room, i, four);
      }
      await waitUntil(() => four.every((b) => b.end !== null), "end for all four bots");

      for (const b of four) {
        expect(b.undecodable).toBe(0);
        expect(b.errors).toEqual([]);
        expect(b.closed).toBeNull();
        expect(b.ticksNeverGoBack).toBe(true);
        expect(b.snapCount).toBeGreaterThan(500);
        expect(b.travel).toBeGreaterThan(5);
        expect(b.lastSnap?.ack).toBeGreaterThan(0);
        expect(b.lastSnap?.ack).toBeLessThanOrEqual(b.lastSeq);
        for (const type of b.eventTypes.keys()) expect(["spit", "nip", "eat"]).toContain(type);
      }

      // Everyone is told the same result.
      const ranking = first.end?.ranking;
      expect(ranking).toHaveLength(4);
      for (const b of four) expect(b.end?.ranking).toEqual(ranking);
      expect(ranking?.map((r) => r.id).sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);

      // The room is released, so a player can queue again.
      await waitUntil(() => lobby.roomCount === 0, "room released");
      expect(lobby.roomOf("u1")).toBeUndefined();
      const before = first.queued.length;
      first.join();
      await waitUntil(() => first.queued.length > before, "queued again");
      expect(first.queued[first.queued.length - 1]).toBe(1);
      expect(lobbyErrors).toEqual([]);
    },
    60_000,
  );
});

describe("reconnecting", () => {
  it(
    "a bot that returns inside the window gets its fish back",
    async () => {
      const { a, b, room } = await startTwoBotMatch();
      for (let i = 0; i < 10; i++) await tickOnce(room, i, [a, b]);
      await waitUntil(() => a.snapCount > 1, "snapshots before the drop");

      a.close();
      await waitUntil(() => !lobby.isConnected("u1"), "the drop to be noticed");
      const tickAtDrop = room.tick;

      const a2 = await connectBot("u1");
      await waitUntil(() => lobby.isConnected("u1"), "the new connection");
      for (let i = 10; i < 22; i++) await tickOnce(room, i, [a2, b]);
      await waitUntil(() => a2.snapCount > 0, "snapshots after the return");

      expect(lobby.roomOf("u1")).toBe(room);
      expect(a2.lastSnap?.tick).toBeGreaterThan(tickAtDrop);
      expect(a2.errors).toEqual([]);

      // The window was cancelled: waiting it out does not free the player.
      await sleep(RECONNECT_WINDOW + 150);
      expect(lobby.roomOf("u1")).toBe(room);
      expect(lobbyErrors).toEqual([]);
    },
    60_000,
  );

  it(
    "a bot that returns after the window is free to queue again",
    async () => {
      const { a, b, room } = await startTwoBotMatch();
      for (let i = 0; i < 5; i++) await tickOnce(room, i, [a, b]);

      a.close();
      await waitUntil(() => !lobby.isConnected("u1"), "the drop to be noticed");
      await sleep(RECONNECT_WINDOW + 150);

      expect(lobby.roomOf("u1")).toBeUndefined();
      expect(lobby.roomOf("u2")).toBe(room);

      const a3 = await connectBot("u1");
      a3.join();
      await waitUntil(() => a3.queued.length > 0, "queued after the window");
      expect(a3.queued[0]).toBe(1);
      expect(a3.errors).toEqual([]);
      expect(lobbyErrors).toEqual([]);
    },
    60_000,
  );
});
