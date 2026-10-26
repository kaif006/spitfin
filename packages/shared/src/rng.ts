/**
 * Deterministic random helpers. No Math.random anywhere in the sim,
 * so the server and client always agree.
 */

/** Stateful generator: call it repeatedly to get a stream of numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stateless hash: the same (seed, a, b) always returns the same number in [0, 1).
 * Used to derive per-bug properties, so any bug can be computed without history.
 */
export function hash01(seed: number, a: number, b = 0): number {
  let h =
    (seed ^ Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
