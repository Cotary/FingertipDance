import { describe, it, expect } from 'vitest';
import {
  WORLDS, GATE_ROWS, createMapState, mapNodePos, visibleRange, pickMapNode, scrollToLevel,
  worldOf, rowCenterY, gateCenterY,
} from '../src/ui/mapview';
import { DESIGN_W } from '../src/render/layout';

const PER_ROW = 4;

describe('关卡地图', () => {
  it('节点不出界（含节点半径）', () => {
    for (let i = 1; i <= 400; i++) {
      const p = mapNodePos(i);
      expect(p.x).toBeGreaterThanOrEqual(40);
      expect(p.x).toBeLessThanOrEqual(DESIGN_W - 40);
    }
  });

  it('蛇形：同一行 y 相同，左右往返，折返处同列', () => {
    // 同一行的四个节点 y 必须一致
    for (let row = 0; row < 3; row++) {
      const base = row * PER_ROW + 1;
      for (let k = 1; k < PER_ROW; k++) {
        expect(mapNodePos(base + k).y).toBe(mapNodePos(base).y);
      }
    }
    // 第 1 行左→右，第 2 行右→左
    expect(mapNodePos(1).x).toBeLessThan(mapNodePos(2).x);
    expect(mapNodePos(5).x).toBeGreaterThan(mapNodePos(6).x);
    // 折返处两节点同列 —— 路径才能是垂直的一截而不是斜穿整行
    expect(mapNodePos(4).x).toBe(mapNodePos(5).x);
    expect(mapNodePos(5).y).toBeGreaterThan(mapNodePos(4).y);
  });

  it('世界边界必须对齐行首，否则门会插在同一行的两个节点之间', () => {
    for (const w of WORLDS) expect((w.from - 1) % PER_ROW).toBe(0);
    for (let i = 1; i < WORLDS.length; i++) {
      expect(WORLDS[i - 1].to + 1).toBe(WORLDS[i].from);
    }
    expect(WORLDS[WORLDS.length - 1].to).toBe(1000);
  });

  it('关号能映射到所属世界', () => {
    expect(worldOf(1)).toBe(0);
    expect(worldOf(12)).toBe(0);
    expect(worldOf(13)).toBe(1);
    expect(worldOf(900)).toBe(6);
  });

  it('世界门正好落在两行中间，且不与节点重叠', () => {
    const GATE_HALF = 38;   // 门高 76
    const NODE_MAX_R = 40;  // 当前关节点半径
    for (let gi = 0; gi < GATE_ROWS.length; gi++) {
      const row = GATE_ROWS[gi];
      const gy = gateCenterY(gi);
      const above = rowCenterY(row - 1);
      const below = rowCenterY(row);
      expect(Math.abs((gy - above) - (below - gy))).toBeLessThan(1);
      expect(gy - GATE_HALF).toBeGreaterThan(above + NODE_MAX_R);
      expect(gy + GATE_HALF).toBeLessThan(below - NODE_MAX_R);
    }
  });

  it('可视区间随滚动平移', () => {
    const r1 = visibleRange(0, 1000);
    const r2 = visibleRange(scrollToLevel(400), 1000);
    expect(r2.first).toBeGreaterThan(r1.first);
    expect(r2.last).toBeGreaterThan(r1.last);
  });

  it('可视区间不越界', () => {
    const st = createMapState(1, 1000, {});
    const r = visibleRange(st.maxScrollY, 1000);
    expect(r.last).toBeLessThanOrEqual(1000);
    expect(visibleRange(0, 1000).first).toBe(1);
  });

  it('一屏可见关卡数在 12~18 之间', () => {
    const r = visibleRange(0, 1000);
    expect(r.last - r.first + 1).toBeGreaterThanOrEqual(12);
    expect(r.last - r.first + 1).toBeLessThanOrEqual(18);
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
