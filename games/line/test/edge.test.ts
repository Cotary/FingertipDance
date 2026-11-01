import { describe, it, expect } from 'vitest';
import { solve, isPathLegal, findHint, solveFrom } from '../src/core/solver';
import { generateLevel } from '../src/core/generator';
import { encodeGrid, decodeGrid } from '../src/core/codec';
import { CellType, Dir, type Cell } from '../src/core/types';

const C = (type: CellType, dir: Dir = Dir.UP): Cell => ({ type, dir });

describe('边界情况', () => {
  it('空网格不崩溃', () => {
    expect(() => solve([])).not.toThrow();
    expect(solve([]).solvable).toBe(false);
  });

  it('没有终点时返回不可解', () => {
    const g: Cell[][] = [[C(CellType.START)]];
    expect(solve(g).solvable).toBe(false);
  });

  it('起点等于终点时步数为 0', () => {
    // 从外部传入 from，让起点恰好落在 END 格上 → solve 内部 startIdx===endIdx 分支 → 步数 0
    const g2: Cell[][] = [[{ type: CellType.END, dir: Dir.UP }]];
    const r = solve(g2, { x: 0, y: 0 });
    expect(r.solvable).toBe(true);
    expect(r.steps).toBe(0);
  });

  it('isPathLegal 拒绝空路径与单点路径', () => {
    const g: Cell[][] = [[C(CellType.START), C(CellType.END)]];
    expect(isPathLegal(g, [])).toBe(false);
    expect(isPathLegal(g, [0])).toBe(false);
  });

  it('isPathLegal 拒绝起点终点出现在中间', () => {
    // 2x2：START(0) BRICK(1) / BRICK(2) END(3)；路径 [0,1,0,3] 中 0 重复出现于中间
    const g: Cell[][] = [
      [C(CellType.START), C(CellType.BRICK)],
      [C(CellType.BRICK), C(CellType.END)],
    ];
    expect(isPathLegal(g, [0, 1, 0, 3])).toBe(false);
  });

  it('编码遇到尺寸不符会抛错', () => {
    expect(() => encodeGrid([], 3, 3)).toThrow();
    expect(() => decodeGrid('AAAA', 2, 2)).toThrow();
  });

  it('findHint 在走岔时返回空数组而非崩溃', () => {
    const g: Cell[][] = [
      [C(CellType.START), C(CellType.BLOCK)],
      [C(CellType.BLOCK), C(CellType.END)],
    ];
    // head 在 START，但 START 被 BLOCK 包围无法到达 END → 返回空数组
    expect(() => findHint(g, { x: 0, y: 0 })).not.toThrow();
    expect(findHint(g, { x: 0, y: 0 })).toEqual([]);
  });

  it('solveFrom 对不可达点返回 null', () => {
    const g: Cell[][] = [
      [C(CellType.START), C(CellType.BLOCK)],
      [C(CellType.BLOCK), C(CellType.END)],
    ];
    expect(solveFrom(g, 1, 1)).toBeNull();
  });

  it('solveFrom 越界返回 null', () => {
    const g: Cell[][] = [[C(CellType.START), C(CellType.END)]];
    expect(solveFrom(g, 5, 5)).toBeNull();
    expect(solveFrom(g, -1, 0)).toBeNull();
  });

  it('生成器在极端关号仍能产出可解关卡', () => {
    for (const idx of [1, 500, 1000]) {
      const lv = generateLevel(idx, 999);
      expect(solve(lv.grid).solvable, `第 ${idx} 关应可解`).toBe(true);
    }
  });

  it('生成器同种子同关号可复现', () => {
    const a = generateLevel(42, 123456);
    const b = generateLevel(42, 123456);
    expect(encodeGrid(a.grid, a.w, a.h)).toBe(encodeGrid(b.grid, b.w, b.h));
  });
});
