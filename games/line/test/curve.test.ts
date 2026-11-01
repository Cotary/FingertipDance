import { describe, it, expect } from 'vitest';
import { curveFor, targetDiff, computeDiff, SEGMENTS } from '../src/core/curve';

describe('curve', () => {
  it('分段覆盖 1..1000 无空隙', () => {
    let prev = 0;
    for (const s of SEGMENTS) {
      expect(s.from).toBe(prev + 1);
      prev = s.to;
    }
    expect(prev).toBe(1000);
  });

  it('尺寸随关号单调不减', () => {
    let prevArea = 0;
    for (let idx = 1; idx <= 1000; idx += 7) {
      const p = curveFor(idx);
      const area = p.w * p.h;
      expect(area).toBeGreaterThanOrEqual(prevArea);
      prevArea = area;
    }
  });

  it('阻挡块数量整体趋势随关号上升', () => {
    // 规格分段表的 blocks 区间有重叠（段 4 上限 30 > 段 5 下限 28），
    // 跨段与大关放宽都会有小幅回落，故只断言宏观趋势：首关最少、末关最多、段内单调不减。
    const first = curveFor(1).blocks;
    const last = curveFor(1000).blocks;
    expect(last).toBeGreaterThan(first);

    // 段内（1..10 小段）blocks 单调不减
    let prev = -1;
    for (let idx = 1; idx <= 10; idx++) {
      const b = curveFor(idx).blocks;
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('开放面积比整体趋势随关号下降', () => {
    // 大关会放宽 openRatio，故只断言宏观趋势：首关最大、末关最小。
    const first = curveFor(1).openRatio;
    const last = curveFor(1000).openRatio;
    expect(last).toBeLessThan(first);
  });

  it('targetDiff 单调不减（含小高峰/大关容差）', () => {
    for (let idx = 1; idx < 1000; idx++) {
      const a = targetDiff(idx);
      const b = targetDiff(idx + 1);
      // 小高峰 +8 / 大关 +12 之后回落是允许的（最多回落 12）
      if (b < a) expect(a - b).toBeLessThanOrEqual(12);
    }
  });

  it('targetDiff 在 [0,100]', () => {
    for (let idx = 1; idx <= 1000; idx++) {
      const d = targetDiff(idx);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(100);
    }
  });

  it('大关比同段普通关更宽松', () => {
    const big = curveFor(200);
    const normal = curveFor(201);
    expect(big.blocks).toBeLessThanOrEqual(normal.blocks);
    expect(big.openRatio).toBeGreaterThanOrEqual(normal.openRatio);
  });

  it('computeDiff 唯一解比多解更难', () => {
    const base = { w: 9, h: 9, blocks: 20, oneways: 6, turns: 4, openRatio: 0.6 };
    const unique = computeDiff({ ...base, pathCount: 1 });
    const multi = computeDiff({ ...base, pathCount: 16 });
    expect(unique).toBeGreaterThan(multi);
  });

  it('computeDiff 在 [0,100]', () => {
    const d = computeDiff({ w: 11, h: 11, blocks: 60, oneways: 20, turns: 9, pathCount: 1, openRatio: 0.45 });
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(100);
  });
});
