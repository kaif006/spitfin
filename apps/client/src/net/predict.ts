import {
  NIP_COOLDOWN,
  NIP_DURATION,
  TICK_DT,
  TICK_HZ,
  collideFish,
  newSimPlayer,
  stepDash,
  stepFish,
  updateFacing,
} from "@spitfin/shared";
import type { Obstacle, SimPlayer, WirePlayer } from "@spitfin/shared";

/** Sim ticks a nip dash lasts after the tick on which it fires. */
export const DASH_TICKS = Math.ceil(NIP_DURATION * TICK_HZ) - 1;
export const NIP_CD_TICKS = Math.round(NIP_COOLDOWN * TICK_HZ);
const MAX_PENDING = 120;

export interface PredInput {
  ax: number;
  az: number;
  nip: boolean;
}

interface Pending extends PredInput {
  seq: number;
}

/**
 * Runs your own fish ahead of the server with the same movement rules, and corrects it whenever a
 * snapshot arrives: take the server's state, then replay every input the server has not applied yet.
 * Other fish are not simulated, so fish-versus-fish pushes show up only as small corrections.
 */
export class Predictor {
  readonly body: SimPlayer = newSimPlayer(0, 0, 0, 0);
  dashLeft = 0;
  nipCdLeft = 0;

  private pending: Pending[] = [];
  private lastAck = -1;

  constructor(private readonly obstacles: readonly Obstacle[]) { }

  get unacked(): number {
    return this.pending.length;
  }

  /** Start from the server's view of this fish. */
  reset(p: WirePlayer): void {
    this.pending.length = 0;
    this.lastAck = -1;
    this.load(p);
  }

  /** Move one tick, exactly as the server will when it reaches this input. */
  step(inp: PredInput): void {
    const b = this.body;
    if (this.dashLeft > 0) {
      this.dashLeft -= 1;
      stepDash(b, b.facing, TICK_DT);
      collideFish(b, this.obstacles);
    } else {
      stepFish(b, inp.ax, inp.az, TICK_DT);
      collideFish(b, this.obstacles);
      updateFacing(b, inp.ax, inp.az);
    }
    if (this.nipCdLeft > 0) this.nipCdLeft -= 1;
    if (inp.nip && this.nipCdLeft === 0) {
      this.nipCdLeft = NIP_CD_TICKS;
      this.dashLeft = DASH_TICKS;
    }
  }

  /** Remember an input that was sent, so it can be replayed until the server acknowledges it. */
  commit(seq: number, inp: PredInput): void {
    this.pending.push({ seq, ax: inp.ax, az: inp.az, nip: inp.nip });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  /** Apply a snapshot. Returns how far the predicted position moved because of it. */
  reconcile(me: WirePlayer, ack: number): { dx: number; dz: number } {
    const b = this.body;
    const ox = b.x;
    const oz = b.z;
    if (ack < this.lastAck) this.pending.length = 0; // the server restarted its counters (a reconnect)
    this.lastAck = ack;
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.seq <= ack) drop++;
    this.pending.splice(0, drop);
    this.load(me);
    for (const p of this.pending) this.step(p);
    return { dx: b.x - ox, dz: b.z - oz };
  }

  private load(p: WirePlayer): void {
    const b = this.body;
    b.x = p.x;
    b.z = p.z;
    b.vx = p.vx;
    b.vz = p.vz;
    b.facing = p.facing;
    this.nipCdLeft = Math.round(p.nipCd * TICK_HZ);
    this.dashLeft = p.dash ? Math.max(0, DASH_TICKS - (NIP_CD_TICKS - this.nipCdLeft)) : 0;
  }
}
