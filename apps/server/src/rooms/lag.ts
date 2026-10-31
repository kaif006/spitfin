import { LAG_REWIND_MAX } from "@spitfin/shared";

/** How much of each new round-trip sample is blended in (the rest is the old average). */
export const RTT_SMOOTHING = 0.2;

/** Blends a new round-trip sample (ms) into the running average. A bad sample is ignored. */
export function smoothRtt(prev: number | null, sample: number): number {
  if (!Number.isFinite(sample) || sample < 0) return prev ?? 0;
  return prev === null ? sample : prev + (sample - prev) * RTT_SMOOTHING;
}

/** Seconds of rewind for a round-trip time in ms: one way is half the round trip, capped. */
export function rewindFromRtt(rttMs: number): number {
  if (!Number.isFinite(rttMs) || rttMs <= 0) return 0;
  return Math.min(LAG_REWIND_MAX, rttMs / 2000);
}
