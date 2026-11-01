import { describe, it, expect } from 'vitest';
import { starOf } from '../src/ui/hud';

describe('星级', () => {
  it('边界：恰好 1.15 倍为 3 星', () => {
    expect(starOf(115, 100)).toBe(3);
    expect(starOf(116, 100)).toBe(2);
  });
  it('边界：恰好 1.5 倍为 2 星', () => {
    expect(starOf(150, 100)).toBe(2);
    expect(starOf(151, 100)).toBe(1);
  });
  it('最短步数异常时兜底 1 星', () => {
    expect(starOf(10, 0)).toBe(1);
  });
});
