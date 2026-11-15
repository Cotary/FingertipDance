import { describe, it, expect } from 'vitest';
import { computeLayout, cardOf, DESIGN_W, DESIGN_H, BOARD_CARD_W, BOARD_GAP, BOARD_TOP } from '../src/render/layout';

describe('layout', () => {
  it('棋盘在设计区域内居中', () => {
    const l = computeLayout(6, 6);
    expect(l.originX).toBeGreaterThanOrEqual(0);
    expect(l.originY).toBeGreaterThanOrEqual(0);
    expect(l.originX + l.boardW).toBeLessThanOrEqual(DESIGN_W);
    expect(l.originY + l.boardH).toBeLessThanOrEqual(DESIGN_H);
  });

  it('格子尺寸随棋盘变大而变小', () => {
    expect(computeLayout(6, 6).cell).toBeGreaterThan(computeLayout(11, 11).cell);
  });

  it('格子是整数像素', () => {
    expect(Number.isInteger(computeLayout(9, 9).cell)).toBe(true);
  });

  it('棋盘宽高 = 槽位数 × 槽位宽 − 末尾一格间距', () => {
    // boardW 是**棋子群**的外接宽度：槽位含半格间距，首尾各让半个，
    // 所以 n 个槽位真实铺开只有 n×cell − gap。断言既有的 n×cell 会把
    // 每块盘多算 14px，卡片就和棋子群对不上
    const l = computeLayout(9, 9);
    expect(l.boardW).toBe(l.cell * 9 - BOARD_GAP);
    expect(l.boardH).toBe(l.cell * 9 - BOARD_GAP);
  });

  it('卡片固定器型：宽度恒定，8×8 时是正方形', () => {
    const c8 = cardOf(computeLayout(8, 8));
    expect(c8.w).toBe(BOARD_CARD_W);
    expect(c8.y).toBe(BOARD_TOP);
    expect(c8.h).toBe(BOARD_CARD_W);

    // 换关时卡片高度只在 654~662 之间浮动（格子变、器物不变）
    for (const n of [6, 7, 8, 9, 10, 11]) {
      const c = cardOf(computeLayout(n, n));
      expect(c.w).toBe(BOARD_CARD_W);
      expect(c.h).toBeGreaterThanOrEqual(650);
      expect(c.h).toBeLessThanOrEqual(BOARD_CARD_W);
    }
  });
});
