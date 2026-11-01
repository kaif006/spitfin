export type Pt = { x: number; y: number };
export type Leaf = {
  x: number;
  y: number;
  z: number;
  size: number;
  rot: number;
  tx: number;
  ty: number;
  phase: number;
  color: number;
};
export type Bounds = { left: number; right: number; bottom: number; top: number };

export const LEAF_CELL = 2;
export const LEAF_PALETTE_SIZE = 5;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (monotone chain). */
export function convexHull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** True if the point is inside (or on the edge of) a convex polygon of either winding. */
export function insideConvex(poly: readonly Pt[], px: number, py: number): boolean {
  if (poly.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function touches(poly: readonly Pt[], px: number, py: number, r: number): boolean {
  if (insideConvex(poly, px, py)) return true;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (insideConvex(poly, px + Math.cos(a) * r, py + Math.sin(a) * r)) return true;
  }
  return false;
}

/** Points around a rectangle centred on the origin, at most `step` apart (x, z world units). */
export function rectPerimeter(hx: number, hz: number, step: number): { x: number; z: number }[] {
  const nx = Math.max(1, Math.ceil((2 * hx) / step));
  const nz = Math.max(1, Math.ceil((2 * hz) / step));
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < nx; i++) out.push({ x: -hx + (2 * hx * i) / nx, z: -hz });
  for (let i = 0; i < nz; i++) out.push({ x: hx, z: -hz + (2 * hz * i) / nz });
  for (let i = 0; i < nx; i++) out.push({ x: hx - (2 * hx * i) / nx, z: hz });
  for (let i = 0; i < nz; i++) out.push({ x: -hx, z: hz - (2 * hz * i) / nz });
  return out;
}

/**
 * One leaf per edge point, pushed outward from `center` so the leaf overlaps the edge by about
 * a third of its length and covers it. Same seed, same leaves.
 */
export function rimLeaves(points: readonly Pt[], center: Pt, seed: number): Leaf[] {
  const r = rng((seed ^ 0x9e3779b9) >>> 0);
  return points.map((p) => {
    const size = 1.2 + r() * 0.7;
    const jitter = (r() - 0.5) * 0.4;
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = size * 0.5;
    return {
      x: p.x + (dx / len) * off + jitter,
      y: p.y + (dy / len) * off + jitter,
      z: r() * 0.3,
      size,
      rot: r() * Math.PI * 2,
      tx: (r() - 0.5) * 0.5,
      ty: (r() - 0.5) * 0.5,
      phase: r() * Math.PI * 2,
      color: Math.floor(r() * LEAF_PALETTE_SIZE),
    };
  });
}

/**
 * Scatters leaves over the view (`bounds`) but not on the pond (`poly`).
 * `reach` (0 to 1) is how much of a leaf's radius is tested against the pond: 1 keeps the whole leaf
 * off it, smaller values let leaves overlap it.
 */
export function placeLeaves(poly: readonly Pt[], b: Bounds, seed: number, max: number, reach = 1): Leaf[] {
  const r = rng(seed);
  const out: Leaf[] = [];
  for (let gy = b.bottom - LEAF_CELL; gy < b.top + LEAF_CELL; gy += LEAF_CELL) {
    for (let gx = b.left - LEAF_CELL; gx < b.right + LEAF_CELL; gx += LEAF_CELL) {
      // Draw every random number first so the layout stays stable when a leaf is skipped.
      const x = gx + r() * LEAF_CELL;
      const y = gy + r() * LEAF_CELL;
      const size = 1.1 + r() * 1.3;
      const rot = r() * Math.PI * 2;
      const tx = (r() - 0.5) * 0.5;
      const ty = (r() - 0.5) * 0.5;
      const phase = r() * Math.PI * 2;
      const color = Math.floor(r() * LEAF_PALETTE_SIZE);
      const z = r() * 0.3;
      if (out.length >= max) continue;
      if (touches(poly, x, y, size * 0.7 * reach)) continue;
      out.push({ x, y, z, size, rot, tx, ty, phase, color });
    }
  }
  return out;
}
