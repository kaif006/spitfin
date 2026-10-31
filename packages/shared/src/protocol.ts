// The wire protocol shared by the server and the client.
//
// Messages are JSON text for now (a Milestone 3 decision: easy to debug and test). All encoding
// lives in codec.ts, so a binary codec can replace it later without touching these types.

/** A fish as sent in a snapshot. Cooldowns are seconds left (0 means ready). */
export interface WirePlayer {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  stash: number;
  eaten: number;
  shots: number;
  hits: number;
  nips: number;
  spitCd: number;
  nipCd: number;
  dash: boolean;
  immune: boolean;
}

/** Where a jet hit a bug. The client rebuilds the falling bug from this and the event's tick. */
export interface WireHit {
  bugId: number;
  x: number;
  y: number;
  z: number;
}

/** Things that happened since the previous snapshot. `tick` is the sim tick they happened on. */
export type WireEvent =
  | {
    type: "spit";
    tick: number;
    playerId: number;
    length: number;
    hit: WireHit | null;
    blockedBy: number | null; // obstacle id, if a reed or rock cut the jet short
  }
  | { type: "nip"; tick: number; thiefId: number; victimId: number | null }
  | { type: "eat"; tick: number; playerId: number; bugId: number };

export interface WireRosterEntry {
  id: number;
  name: string;
}

export interface WireRank {
  id: number;
  rank: number;
  stash: number;
  eaten: number;
  nips: number;
}

export const SERVER_ERROR_CODES = ["already_playing"] as const;
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

export type ServerMsg =
  | { t: "welcome"; tickHz: number }
  | { t: "pong"; n: number }
  | { t: "queued"; waiting: number }
  | { t: "start"; seed: number; you: number; players: WireRosterEntry[] }
  | { t: "snap"; tick: number; ack: number; players: WirePlayer[]; events: WireEvent[] }
  | { t: "end"; ranking: WireRank[] }
  | { t: "error"; code: ServerErrorCode };

export type ClientMsg =
  | { t: "ping"; n: number }
  | { t: "join" }
  | { t: "leave" }
  | {
    t: "input";
    seq: number; // counts up per input; the server echoes the last one it applied as `ack`
    ax: number;
    az: number;
    spit: boolean;
    yaw: number;
    pitch: number;
    nip: boolean;
  };
