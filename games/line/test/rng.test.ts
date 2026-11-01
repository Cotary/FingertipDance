import { describe, it, expect } from 'vitest';
import { mulberry32, levelSeed } from '../src/core/rng';

describe('rng', () => {
  it('同种子产生同序列', () => {
    const a = mulberry32(12345), b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('不同种子产生不同序列', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it('int 落在 [min, max)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle 不修改入参且元素集合不变', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = mulberry32(9).shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.slice().sort((a, b) => a - b)).toEqual(src);
  });

  it('levelSeed 对不同关号产出不同种子', () => {
    expect(levelSeed(1, 1)).not.toBe(levelSeed(1, 2));
    expect(levelSeed(1, 1)).toBe(levelSeed(1, 1));
  });
});
