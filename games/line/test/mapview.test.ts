import { describe, it, expect } from 'vitest';
import {
  NODE_GAP, createMapState, mapNodePos, visibleRange, pickMapNode, scrollToLevel,
} from '../src/ui/mapview';
import { DESIGN_W } from '../src/render/layout';

describe('关卡地图', () => {
  it('节点 x 在设计宽度内', () => {
    for (let i = 1; i <= 200; i++) {
      const p = mapNodePos(i);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(DESIGN_W);
    }
  });

  it('节点 y 随关号线性递增', () => {
    expect(mapNodePos(2).y - mapNodePos(1).y).toBe(NODE_GAP);
    expect(mapNodePos(10).y - mapNodePos(9).y).toBe(NODE_GAP);
  });

  it('可视区间随滚动平移', () => {
    const r1 = visibleRange(0, 1000);
    const r2 = visibleRange(100 * NODE_GAP, 1000);
    expect(r2.first).toBeGreaterThan(r1.first);
    expect(r2.last).toBeGreaterThan(r1.last);
  });

  it('可视区间不越界', () => {
    const r = visibleRange(999 * NODE_GAP, 1000);
    expect(r.last).toBeLessThanOrEqual(1000);
    expect(visibleRange(0, 1000).first).toBe(1);
  });

  it('点击节点能选中关号', () => {
    const st = createMapState(5, 1000, {});
    const p = mapNodePos(3);
    expect(pickMapNode(p.x, p.y, st)).toBe(3);
    expect(pickMapNode(5, 5, st)).toBe(-1);
  });

  it('聚焦当前关的滚动偏移在合法区间内', () => {
    const st = createMapState(5, 1000, {});
    const y = scrollToLevel(500);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(st.maxScrollY);
  });
});
