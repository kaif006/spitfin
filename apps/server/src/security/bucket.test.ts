import { describe, expect, it } from "vitest";
import { TokenBucket } from "./bucket.js";

describe("TokenBucket", () => {
  it("allows a burst and then refuses", () => {
    let t = 0;
    const b = new TokenBucket(10, 3, () => t);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it("refills at the given rate", () => {
    let t = 0;
    const b = new TokenBucket(10, 3, () => t);
    for (let i = 0; i < 3; i++) b.take();
    expect(b.take()).toBe(false);
    t = 100; // 0.1 s at 10 per second is one token
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it("never holds more than the burst", () => {
    let t = 0;
    const b = new TokenBucket(10, 3, () => t);
    t = 60_000;
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it("keeps a steady stream at the rate allowed", () => {
    let t = 0;
    const b = new TokenBucket(30, 5, () => t);
    for (let i = 0; i < 300; i++) {
      t += 1000 / 30;
      expect(b.take()).toBe(true);
    }
  });

  it("ignores a clock that goes backwards", () => {
    let t = 1000;
    const b = new TokenBucket(10, 1, () => t);
    expect(b.take()).toBe(true);
    t = 0;
    expect(b.take()).toBe(false);
  });
});
