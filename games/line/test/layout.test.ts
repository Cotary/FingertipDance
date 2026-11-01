import { describe, it, expect } from 'vitest';
import { computeLayout, DESIGN_W, DESIGN_H } from '../src/render/layout';

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

  it('棋盘宽高等于格数乘格子尺寸', () => {
    const l = computeLayout(9, 9);
    expect(l.boardW).toBe(l.cell * 9);
    expect(l.boardH).toBe(l.cell * 9);
  });
});
