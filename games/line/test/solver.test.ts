import { describe, it, expect } from 'vitest';
import { solve, isPathLegal, countTurns, findHint, solveFrom } from '../src/core/solver';
import { CellType, Dir, type Cell } from '../src/core/types';

function mk(cells: Array<[CellType, Dir?]>, w: number, h: number): Cell[][] {
  const out: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) {
      const [t, d] = cells[y * w + x];
      row.push({ type: t, dir: d ?? Dir.UP });
    }
    out.push(row);
  }
  return out;
}

describe('solver', () => {
  it('直线可达时最短步数正确', () => {
    // 3x1：START(0,0) BRICK(1,0) END(2,0)
    const g = mk([
      [CellType.START], [CellType.BRICK], [CellType.END],
    ], 3, 1);
    const r = solve(g);
    expect(r.solvable).toBe(true);
    expect(r.steps).toBe(2);
    expect(r.pathCount).toBe(1);
  });

  it('单向块方向错误挡住时无解', () => {
    // 3x1：START(0,0) ONEWAY朝左(1,0) END(2,0)
    // 从左边进入 (1,0) 方向是 RIGHT，但箭头朝左 → 被挡 → 到不了 END
    const g = mk([
      [CellType.START], [CellType.ONEWAY, Dir.LEFT], [CellType.END],
    ], 3, 1);
    expect(solve(g).solvable).toBe(false);
  });

  it('单向块方向正确时可达', () => {
    // 3x1：START(0,0) ONEWAY朝右(1,0) END(2,0)
    const g = mk([
      [CellType.START], [CellType.ONEWAY, Dir.RIGHT], [CellType.END],
    ], 3, 1);
    const r = solve(g);
    expect(r.solvable).toBe(true);
    expect(r.steps).toBe(2);
  });

  it('多个等价解时 pathCount > 1', () => {
    // 3x3 全通，START 左上，END 右下 → 大量等价解
    const cells: Array<[CellType, Dir?]> = [];
    for (let i = 0; i < 9; i++) cells.push([CellType.BRICK]);
    cells[0] = [CellType.START];
    cells[8] = [CellType.END];
    const r = solve(mk(cells, 3, 3));
    expect(r.solvable).toBe(true);
    expect(r.pathCount).toBeGreaterThan(1);
  });

  it('isPathLegal 拒绝非 4 邻接的路径', () => {
    // 2x2：START(0,0) BRICK(1,0) / END(0,1) BRICK(1,1)
    const g = mk([
      [CellType.START], [CellType.BRICK],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    // 0=(0,0) → 1=(1,0) → 3=(1,1) → 2=(0,1)=END，全部 4 邻接且中间非 START/END
    expect(isPathLegal(g, [0, 1, 3, 2])).toBe(true);
    // 0=(0,0) → 3=(1,1) 不是邻接
    expect(isPathLegal(g, [0, 3, 2])).toBe(false);
  });

  it('isPathLegal 拒绝穿过阻挡块', () => {
    // 3x1：START(0,0) BLOCK(1,0) END(2,0)
    const g = mk([
      [CellType.START], [CellType.BLOCK], [CellType.END],
    ], 3, 1);
    expect(isPathLegal(g, [0, 1, 2])).toBe(false);
  });

  it('isPathLegal 拒绝违背单向块方向', () => {
    // 3x1：START(0,0) ONEWAY朝左(1,0) END(2,0)
    // 进入 (1,0) 的方向是 RIGHT，但箭头朝左 → 非法
    const g = mk([
      [CellType.START], [CellType.ONEWAY, Dir.LEFT], [CellType.END],
    ], 3, 1);
    expect(isPathLegal(g, [0, 1, 2])).toBe(false);
    // 箭头朝右 → 进入方向 RIGHT → 合法
    const g2 = mk([
      [CellType.START], [CellType.ONEWAY, Dir.RIGHT], [CellType.END],
    ], 3, 1);
    expect(isPathLegal(g2, [0, 1, 2])).toBe(true);
  });

  it('countTurns 正确', () => {
    // 0=(0,0) → 1=(1,0) → 2=(1,1) 拐一次
    expect(countTurns([0, 1, 2], 2)).toBe(1);
    expect(countTurns([0, 1], 2)).toBe(0);
  });

  it('findHint 从当前线头给出下一步', () => {
    const cells: Array<[CellType, Dir?]> = [];
    for (let i = 0; i < 9; i++) cells.push([CellType.BRICK]);
    cells[0] = [CellType.START];
    cells[8] = [CellType.END];
    const g = mk(cells, 3, 3);
    const hint = findHint(g, { x: 0, y: 0 }, 2);
    expect(hint.length).toBe(2);
    // 提示的每一步都必须与上一步 4 邻接
    let prev = 0;
    for (const idx of hint) {
      const dx = Math.abs((idx % 3) - (prev % 3));
      const dy = Math.abs(Math.floor(idx / 3) - Math.floor(prev / 3));
      expect(dx + dy).toBe(1);
      prev = idx;
    }
  });

  it('solveFrom 从任意点求解', () => {
    const cells: Array<[CellType, Dir?]> = [];
    for (let i = 0; i < 9; i++) cells.push([CellType.BRICK]);
    cells[0] = [CellType.START];
    cells[8] = [CellType.END];
    const g = mk(cells, 3, 3);
    // 从 (1,0)（idx=1）出发，路径应以 idx=1 开头
    const r = solveFrom(g, 1, 0);
    expect(r).not.toBeNull();
    expect(r!.path[0]).toBe(1);
  });
});
