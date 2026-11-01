import { describe, it, expect } from 'vitest';
import { computeRankScore } from '../src/platform/openData';

describe('好友榜分数', () => {
  it('关卡数优先', () => {
    expect(computeRankScore(10, 1000)).toBeGreaterThan(computeRankScore(9, 999999));
  });

  it('同关卡数时用时少者靠前', () => {
    expect(computeRankScore(10, 1000)).toBeGreaterThan(computeRankScore(10, 2000));
  });

  it('与服务端公式一致（maxLevel*1e6 - seconds）', () => {
    expect(computeRankScore(5, 3000)).toBe(5 * 1000000 - 3);
  });

  it('秒数上限 999999，不会溢出为负', () => {
    expect(computeRankScore(1, 99999999999)).toBe(1000000 - 999999);
  });
});
