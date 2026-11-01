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
import { planSteal } from "./test-support/steal-plan.js";

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
let seed = SEED;
let lobbyErrors: unknown[];
const bots: Bot[] = [];

beforeEach(async () => {
  clock = 0;
  seed = SEED;
  lobbyErrors = [];
  store = fakeRedis();
  lobby = new Lobby({
    now: () => clock,
    makeSeed: () => seed,
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

describe("stealing", () => {
  it(
    "a nip takes a bug from a stash and the next snapshots show it",
    async () => {
      const plan = planSteal();
      seed = plan.seed;
      const { a, b, room } = await startTwoBotMatch();
      const victim = a.start?.you === 0 ? a : b;
      const thief = victim === a ? b : a;
      expect(victim.start?.you).toBe(0);
      expect(thief.start?.you).toBe(1);

      const step = async (v: Partial<InputFields>, t: Partial<InputFields>): Promise<void> => {
        victim.input(v);
        thief.input(t);
        await yieldIo();
        clock += TICK_MS;
        room.pump();
      };

      const stashOf = (bot: Bot, id: number) => bot.lastSnap?.players[id]?.stash ?? 0;

      // Phase 1: fish 0 spits at the planned tick and stands still until the bug is in its stash.
      for (let i = 0; i < 400 && stashOf(victim, 0) < 1; i++) {
        const spit = room.tick === plan.tick - 1;
        await step(spit ? { spit: true, yaw: plan.yaw, pitch: plan.pitch } : {}, {});
      }
      expect(stashOf(victim, 0)).toBe(1);
      const spitEvent = victim.events.find((e) => e.type === "spit" && e.playerId === 0);
      expect(spitEvent).toBeDefined();
      expect(spitEvent?.type === "spit" ? spitEvent.hit : null).not.toBeNull();

      // Phase 2: fish 1 swims straight at fish 0 and nips once it is close.
      let nipped = false;
      let nipTick = -1;
      for (let i = 0; i < 400 && nipTick < 0; i++) {
        const me = thief.lastSnap?.players[1];
        const him = thief.lastSnap?.players[0];
        const close = me !== undefined && him !== undefined && Math.hypot(me.x - him.x, me.z - him.z) <= 1.3;
        const fire = close && !nipped;
        if (fire) nipped = true;
        await step({}, { ax: 1, nip: fire });
        const ev = thief.events.find((e) => e.type === "nip" && e.thiefId === 1);
        if (ev) nipTick = ev.tick;
      }
      expect(nipTick).toBeGreaterThan(0);

      const nip = thief.events.find((e) => e.type === "nip" && e.thiefId === 1);
      expect(nip).toMatchObject({ type: "nip", thiefId: 1, victimId: 0 });

      // Phase 3: a later snapshot shows the bug moved from the victim to the thief.
      for (let i = 0; i < 10; i++) await step({}, {});
      await waitUntil(
        () => (thief.lastSnap?.tick ?? 0) > nipTick && (victim.lastSnap?.tick ?? 0) > nipTick,
        "snapshots after the nip",
      );
      for (const bot of [thief, victim]) {
        expect(stashOf(bot, 0)).toBe(0);
        expect(stashOf(bot, 1)).toBe(1);
      }
      expect(thief.errors).toEqual([]);
      expect(victim.errors).toEqual([]);
      expect(lobbyErrors).toEqual([]);
    },
    60_000,
  );
});
