import { describe, expect, it } from "vitest";
import { convexHull, insideConvex, placeLeaves, rectPerimeter, rimLeaves } from "./foregroundLayout";

const square = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];
const view = { left: -12, right: 12, bottom: -8, top: 8 };

describe("foreground layout", () => {
  it("keeps only the outer corners in the hull", () => {
    expect(convexHull([...square, { x: 0, y: 0 }, { x: 1, y: 2 }])).toHaveLength(4);
  });

  it("tests points against a polygon of either winding", () => {
    expect(insideConvex(square, 0, 0)).toBe(true);
    expect(insideConvex(square, 6, 0)).toBe(false);
    expect(insideConvex([...square].reverse(), 0, 0)).toBe(true);
    expect(insideConvex([...square].reverse(), 6, 0)).toBe(false);
  });

  it("never puts a leaf centre on the pond", () => {
    const leaves = placeLeaves(square, view, 7, 500, 0.5);
    expect(leaves.length).toBeGreaterThan(20);
    for (const l of leaves) expect(insideConvex(square, l.x, l.y)).toBe(false);
  });

  it("lets leaves overlap the pond more when reach is smaller", () => {
    expect(placeLeaves(square, view, 7, 500, 0.2).length).toBeGreaterThan(placeLeaves(square, view, 7, 500, 1).length);
  });

  it("gives the same layout for the same seed and never more than the maximum", () => {
    expect(placeLeaves(square, view, 7, 500)).toEqual(placeLeaves(square, view, 7, 500));
    expect(placeLeaves(square, view, 7, 3)).toHaveLength(3);
  });

  it("walks the whole rectangle edge", () => {
    const p = rectPerimeter(2, 1, 1);
    expect(p).toHaveLength(12);
    for (const q of p) expect(Math.abs(q.x) === 2 || Math.abs(q.z) === 1).toBe(true);
  });

  it("puts one rim leaf per edge point, outside the edge point", () => {
    const pts = [
      { x: 10, y: 0 },
      { x: 0, y: 8 },
      { x: -10, y: 0 },
    ];
    const leaves = rimLeaves(pts, { x: 0, y: 0 }, 5);
    expect(leaves).toHaveLength(3);
    leaves.forEach((l, i) => {
      expect(Math.hypot(l.x, l.y)).toBeGreaterThan(Math.hypot(pts[i]!.x, pts[i]!.y) - 0.3);
    });
    expect(rimLeaves(pts, { x: 0, y: 0 }, 5)).toEqual(leaves);
  });
});
