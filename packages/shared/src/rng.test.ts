import { describe, it, expect } from 'vitest';
import { mulberry32, hash01 } from './rng';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('hash01', () => {
  it('is deterministic', () => {
    expect(hash01(42, 7, 3)).toBe(hash01(42, 7, 3));
  });

  it('stays inside [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = hash01(99, i, i * 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('changes with seed and inputs', () => {
    expect(hash01(1, 5)).not.toBe(hash01(2, 5));
    expect(hash01(1, 5)).not.toBe(hash01(1, 6));
    expect(hash01(1, 5, 0)).not.toBe(hash01(1, 5, 1));
  });

  it('is roughly uniform (mean near 0.5)', () => {
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) sum += hash01(7, i);
    expect(sum / n).toBeGreaterThan(0.47);
    expect(sum / n).toBeLessThan(0.53);
  });
});
