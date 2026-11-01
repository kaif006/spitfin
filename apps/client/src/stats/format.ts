export function pct(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "–" : `${Math.round(v * 100)}%`;
}

export function oneDecimal(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "–" : v.toFixed(1);
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function ordinal(n: number): string {
  return ["1st", "2nd", "3rd", "4th"][n - 1] ?? `${n}th`;
}

export type Pt = { x: number; y: number };

/**
 * Screen points for a line chart. The y range runs from min(0, lowest value) to the highest value,
 * so a stash chart always has its zero line at the bottom.
 */
export function chartPoints(values: readonly number[], w: number, h: number, pad: number): Pt[] {
  const n = values.length;
  if (n === 0) return [];
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const iw = w - 2 * pad;
  const ih = h - 2 * pad;
  return values.map((v, i) => ({
    x: pad + (n === 1 ? iw / 2 : (i / (n - 1)) * iw),
    y: pad + (span === 0 ? ih / 2 : (1 - (v - lo) / span) * ih),
  }));
}

export function toPolyline(pts: readonly Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** Bar widths in percent, relative to the largest value. */
export function barPercents(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? (v / max) * 100 : 0));
}
