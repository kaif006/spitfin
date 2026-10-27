import { BUG_SPAWN_INTERVAL, MATCH_DURATION, TICK_DT, TICK_HZ } from "./constants";
import { makeBugSpec } from "./bugs";
import type { BugSpec } from "./bugs";
import { resolveEating } from "./eating";
import type { EatEvent, ShotBug } from "./eating";
import { newNipper, tryNip, updateFacing } from "./nip";
import type { Nipper } from "./nip";
import { generateObstacles } from "./obstacles";
import type { Obstacle } from "./obstacles";
import { stepFish } from "./sim";
import { newSpitter, trySpit } from "./spit";
import type { SpitContext, Spitter } from "./spit";

/** The match lasts this many ticks. Integer, so the end never depends on float rounding. */
export const SIM_MATCH_TICKS = Math.round(MATCH_DURATION * TICK_HZ);
/** Players start on a ring this far from the centre (inside SPAWN_CLEAR_RADIUS, so no obstacle is there). */
export const SIM_SPAWN_RING = 2.0;

const SPAWN_EPS = 1e-9;

/** One player's input for one tick. */
export interface SimInput {
  ax: number;
  az: number; // movement axes, clamped to unit length by stepFish
  spit: boolean;
  yaw: number;
  pitch: number; // aim, used only when `spit` is true
  rewind: number; // lag compensation in seconds (the server sets this, capped by trySpit)
  nip: boolean;
}

export const IDLE_SIM_INPUT: Readonly<SimInput> = {
  ax: 0, az: 0, spit: false, yaw: 0, pitch: 0, rewind: 0, nip: false,
};

export const makeSimInput = (p: Partial<SimInput> = {}): SimInput => ({ ...IDLE_SIM_INPUT, ...p });

/** A fish with everything the rules need: movement, nipping, spitting, eating. */
export interface SimPlayer extends Nipper, Spitter {
  vx: number;
  vz: number;
}

export function newSimPlayer(id: number, x: number, z: number, facing: number): SimPlayer {
  return { ...newNipper(id, x, z, facing), ...newSpitter(x, z), vx: 0, vz: 0 };
}

export type SimEvent =
  | { type: "spit"; playerId: number; hitBugId: number; blockedBy: number; length: number }
  | { type: "nip"; thiefId: number; victimId: number }
  | { type: "eat"; bugId: number; playerId: number }
  | { type: "end" };

export interface SimState {
  seed: number;
  tick: number;
  time: number; // always tick / TICK_HZ
  over: boolean;
  obstacles: Obstacle[];
  bugs: BugSpec[]; // bug i is bugs[i]
  shot: ShotBug[];
  players: SimPlayer[]; // always sorted by id
  nextBugIndex: number;
  ctx: SpitContext; // points at the arrays above, which are only ever changed in place
}

export interface SimRank {
  id: number;
  stash: number;
  bugsEaten: number;
  nipsUsed: number;
  rank: number; // 1 = best. Players tied on every key share a rank.
}

/** Start a match. Player ids are sorted, and a duplicate id throws. */
export function newSim(seed: number, playerIds: readonly number[]): SimState {
  const ids = [...playerIds].sort((a, b) => a - b);
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === ids[i - 1]) throw new Error(`duplicate player id ${ids[i]}`);
  }
  const n = Math.max(ids.length, 1);
  const players = ids.map((id, i) => {
    const a = (2 * Math.PI * i) / n;
    return newSimPlayer(id, Math.cos(a) * SIM_SPAWN_RING, Math.sin(a) * SIM_SPAWN_RING, Math.atan2(Math.sin(a), Math.cos(a)));
  });
  const obstacles = generateObstacles(seed);
  const bugs: BugSpec[] = [];
  const shot: ShotBug[] = [];
  const s: SimState = {
    seed, tick: 0, time: 0, over: false,
    obstacles, bugs, shot, players,
    nextBugIndex: 0,
    ctx: { seed, bugs, shot, obstacles },
  };
  spawnDueBugs(s); // bug 0 appears at time 0
  return s;
}

function spawnDueBugs(s: SimState): void {
  for (; ;) {
    const spawnAt = s.nextBugIndex * BUG_SPAWN_INTERVAL;
    if (spawnAt >= MATCH_DURATION || spawnAt > s.time + SPAWN_EPS) return;
    s.bugs.push(makeBugSpec(s.seed, s.nextBugIndex, s.obstacles));
    s.nextBugIndex += 1;
  }
}

const num = (v: number): number => (Number.isFinite(v) ? v : 0);
const eatScratch: EatEvent[] = [];

/**
 * Advance the match by exactly one tick. `inputs[i]` belongs to `players[i]`; a missing entry means idle.
 * Order inside a tick: spawn bugs, move and turn, spit, nip, eat. Players are always handled in id order.
 * If `events` is given, events from this tick are pushed to it (the caller clears it between ticks).
 */
export function stepSim(
  s: SimState,
  inputs: readonly (SimInput | undefined)[],
  events?: SimEvent[],
): void {
  if (s.over) return;
  s.tick += 1;
  s.time = s.tick / TICK_HZ;
  const t = s.time;
  const ps = s.players;

  spawnDueBugs(s);

  for (let i = 0; i < ps.length; i++) {
    const inp = inputs[i] ?? IDLE_SIM_INPUT;
    const ax = num(inp.ax);
    const az = num(inp.az);
    stepFish(ps[i], ax, az, TICK_DT);
    updateFacing(ps[i], ax, az);
  }

  for (let i = 0; i < ps.length; i++) {
    const inp = inputs[i] ?? IDLE_SIM_INPUT;
    if (!inp.spit) continue;
    const r = trySpit(ps[i], inp.yaw, inp.pitch, s.ctx, t, inp.rewind);
    if (!r.fired) continue;
    if (r.hit) s.shot.push(r.hit);
    if (events) events.push({ type: "spit", playerId: ps[i].id, hitBugId: r.bugId, blockedBy: r.blockedBy, length: r.length });
  }

  for (let i = 0; i < ps.length; i++) {
    const inp = inputs[i] ?? IDLE_SIM_INPUT;
    if (!inp.nip) continue;
    const r = tryNip(ps[i], ps, t);
    if (r.fired && events) events.push({ type: "nip", thiefId: ps[i].id, victimId: r.victimId });
  }

  eatScratch.length = 0;
  resolveEating(s.shot, ps, t, events ? eatScratch : undefined);
  if (events) for (let i = 0; i < eatScratch.length; i++) events.push({ type: "eat", bugId: eatScratch[i].bugId, playerId: eatScratch[i].playerId });

  if (s.tick >= SIM_MATCH_TICKS) {
    s.over = true;
    if (events) events.push({ type: "end" });
  }
}

/** Bugs that are flying or perched right now (spawned, not yet despawned, not shot). */
export function simAliveBugs(s: SimState): number {
  let n = 0;
  for (let i = 0; i < s.bugs.length; i++) {
    const b = s.bugs[i];
    if (s.time < b.spawnTime || s.time >= b.despawnTime) continue;
    if (s.shot.some((x) => x.fall.bugId === b.id)) continue;
    n += 1;
  }
  return n;
}

/** Ranking by stash, then bugs eaten, then fewer nips used. Works at any time, so it also serves a live scoreboard. */
export function simRanking(s: SimState): SimRank[] {
  const rows: SimRank[] = s.players.map((p) => ({
    id: p.id, stash: p.stash, bugsEaten: p.bugsEaten, nipsUsed: p.nipsUsed, rank: 0,
  }));
  const cmp = (a: SimRank, b: SimRank) => b.stash - a.stash || b.bugsEaten - a.bugsEaten || a.nipsUsed - b.nipsUsed;
  rows.sort((a, b) => cmp(a, b) || a.id - b.id);
  for (const r of rows) r.rank = 1 + rows.filter((o) => cmp(o, r) < 0).length;
  return rows;
}
