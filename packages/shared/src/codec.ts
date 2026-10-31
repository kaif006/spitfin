import {
  SERVER_ERROR_CODES,
  type ClientMsg,
  type ServerMsg,
  type WireEvent,
  type WirePlayer,
  type WireRank,
  type WireRosterEntry,
} from "./protocol";

/** Largest axis value accepted. The client's diagonal mapping reaches 1.414, and stepFish clamps to unit length. */
export const WIRE_MAX_AXIS = 2;
export const WIRE_MAX_PLAYERS = 4;
export const WIRE_MAX_EVENTS = 64;

const MAX_YAW = 7; // a little over 2π
const MAX_PITCH = 2; // a little over π/2
const MAX_NAME_LENGTH = 32;
const U32 = 0xffffffff;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isFin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInRange = (v: unknown, limit: number): v is number => isFin(v) && Math.abs(v) <= limit;
const isUint = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= U32;
const isNonNegative = (v: unknown): v is number => isFin(v) && v >= 0;
const isAck = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= -1 && v <= U32;

function parseObject(raw: string): Obj | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return isObj(v) ? v : null;
}

function parseList<T>(v: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const item of v) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

// ---------- client to server ----------

export const encodeClient = (m: ClientMsg): string => JSON.stringify(m);

/**
 * Parse a message from a client. Returns null for anything that is not exactly a known message.
 * Only known fields are copied, so a client cannot smuggle in extra values such as `rewind`.
 */
export function decodeClient(raw: string): ClientMsg | null {
  const o = parseObject(raw);
  if (!o) return null;
  switch (o.t) {
    case "ping": {
      const { n } = o;
      return isFin(n) ? { t: "ping", n } : null;
    }
    case "join":
      return { t: "join" };
    case "leave":
      return { t: "leave" };
    case "input": {
      const { seq, ax, az, spit, yaw, pitch, nip } = o;
      if (
        !isUint(seq) ||
        !isInRange(ax, WIRE_MAX_AXIS) ||
        !isInRange(az, WIRE_MAX_AXIS) ||
        typeof spit !== "boolean" ||
        !isInRange(yaw, MAX_YAW) ||
        !isInRange(pitch, MAX_PITCH) ||
        typeof nip !== "boolean"
      ) {
        return null;
      }
      return { t: "input", seq, ax, az, spit, yaw, pitch, nip };
    }
    default:
      return null;
  }
}

// ---------- server to client ----------

export const encodeServer = (m: ServerMsg): string => JSON.stringify(m);

function parsePlayer(v: unknown): WirePlayer | null {
  if (!isObj(v)) return null;
  const { id, x, z, vx, vz, facing, stash, eaten, shots, hits, nips, spitCd, nipCd, dash, immune } = v;
  if (
    !isUint(id) || !isFin(x) || !isFin(z) || !isFin(vx) || !isFin(vz) || !isFin(facing) ||
    !isUint(stash) || !isUint(eaten) || !isUint(shots) || !isUint(hits) || !isUint(nips) ||
    !isNonNegative(spitCd) || !isNonNegative(nipCd) ||
    typeof dash !== "boolean" || typeof immune !== "boolean"
  ) {
    return null;
  }
  return { id, x, z, vx, vz, facing, stash, eaten, shots, hits, nips, spitCd, nipCd, dash, immune };
}

function parseEvent(v: unknown): WireEvent | null {
  if (!isObj(v)) return null;
  const { type, tick } = v;
  if (!isUint(tick)) return null;
  switch (type) {
    case "spit": {
      const { playerId, length, hit, blockedBy } = v;
      if (!isUint(playerId) || !isNonNegative(length)) return null;
      if (blockedBy !== null && !isUint(blockedBy)) return null;
      if (hit === null) return { type, tick, playerId, length, hit: null, blockedBy };
      if (!isObj(hit)) return null;
      const { bugId, x, y, z } = hit;
      if (!isUint(bugId) || !isFin(x) || !isFin(y) || !isFin(z)) return null;
      return { type, tick, playerId, length, hit: { bugId, x, y, z }, blockedBy };
    }
    case "nip": {
      const { thiefId, victimId } = v;
      if (!isUint(thiefId)) return null;
      if (victimId !== null && !isUint(victimId)) return null;
      return { type, tick, thiefId, victimId };
    }
    case "eat": {
      const { playerId, bugId } = v;
      if (!isUint(playerId) || !isUint(bugId)) return null;
      return { type, tick, playerId, bugId };
    }
    default:
      return null;
  }
}

function parseRoster(v: unknown): WireRosterEntry | null {
  if (!isObj(v)) return null;
  const { id, name } = v;
  if (!isUint(id) || typeof name !== "string" || name.length > MAX_NAME_LENGTH) return null;
  return { id, name };
}

function parseRank(v: unknown): WireRank | null {
  if (!isObj(v)) return null;
  const { id, rank, stash, eaten, nips } = v;
  if (!isUint(id) || !isUint(rank) || rank < 1 || !isUint(stash) || !isUint(eaten) || !isUint(nips)) {
    return null;
  }
  return { id, rank, stash, eaten, nips };
}

/**
 * Parse a message from the server. The client does not blindly trust it: a bug or a bad proxy
 * must not be able to crash the game loop, so anything malformed becomes null.
 */
export function decodeServer(raw: string): ServerMsg | null {
  const o = parseObject(raw);
  if (!o) return null;
  switch (o.t) {
    case "welcome": {
      const { tickHz } = o;
      return isFin(tickHz) && tickHz > 0 ? { t: "welcome", tickHz } : null;
    }
    case "pong": {
      const { n } = o;
      return isFin(n) ? { t: "pong", n } : null;
    }
    case "queued": {
      const { waiting } = o;
      return isUint(waiting) ? { t: "queued", waiting } : null;
    }
    case "start": {
      const { seed, you } = o;
      const players = parseList(o.players, WIRE_MAX_PLAYERS, parseRoster);
      if (!isUint(seed) || !isUint(you) || !players || players.length < 1) return null;
      const ids = new Set(players.map((p) => p.id));
      if (ids.size !== players.length || !ids.has(you)) return null;
      return { t: "start", seed, you, players };
    }
    case "snap": {
      const { tick, ack } = o;
      const players = parseList(o.players, WIRE_MAX_PLAYERS, parsePlayer);
      const events = parseList(o.events, WIRE_MAX_EVENTS, parseEvent);
      if (!isUint(tick) || !isAck(ack) || !players || players.length < 1 || !events) return null;
      return { t: "snap", tick, ack, players, events };
    }
    case "end": {
      const ranking = parseList(o.ranking, WIRE_MAX_PLAYERS, parseRank);
      return ranking && ranking.length >= 1 ? { t: "end", ranking } : null;
    }
    case "error": {
      const code = SERVER_ERROR_CODES.find((c) => c === o.code);
      return code ? { t: "error", code } : null;
    }
    default:
      return null;
  }
}
