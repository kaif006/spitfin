import { describe, expect, it } from "vitest";
import { barPercents, chartPoints, oneDecimal, ordinal, pct, signed, toPolyline } from "./format";

describe("stats format", () => {
  it("formats ratios and decimals, with a dash for no data", () => {
    expect(pct(0.256)).toBe("26%");
    expect(pct(null)).toBe("–");
    expect(oneDecimal(12.34)).toBe("12.3");
    expect(oneDecimal(null)).toBe("–");
  });

  it("formats signed deltas and placements", () => {
    expect(signed(12)).toBe("+12");
    expect(signed(-12)).toBe("-12");
    expect(signed(0)).toBe("0");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });

  it("has no chart points for no data and centres a single point", () => {
    expect(chartPoints([], 100, 100, 10)).toEqual([]);
    expect(chartPoints([5], 100, 100, 10)).toEqual([{ x: 50, y: 10 }]);
  });

  it("scales a rising series between the padding", () => {
    expect(chartPoints([0, 10], 100, 100, 10)).toEqual([
      { x: 10, y: 90 },
      { x: 90, y: 10 },
    ]);
    expect(toPolyline([{ x: 10, y: 90 }, { x: 90.04, y: 10 }])).toBe("10.0,90.0 90.0,10.0");
  });

  it("puts an all-zero series on the middle line", () => {
    expect(chartPoints([0, 0, 0], 100, 100, 10).map((p) => p.y)).toEqual([50, 50, 50]);
  });

  it("sizes bars relative to the largest value", () => {
    expect(barPercents([2, 4, 0])).toEqual([50, 100, 0]);
    expect(barPercents([0, 0])).toEqual([0, 0]);
  });
});
