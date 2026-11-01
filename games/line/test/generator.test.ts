import { describe, it, expect } from 'vitest';
import { generateLevel } from '../src/core/generator';
import { solve, isPathLegal } from '../src/core/solver';
import { CellType, type Cell } from '../src/core/types';

const GLOBAL_SEED = 20261101;

function countType(grid: Cell[][], type: number): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c.type === type) n++;
  return n;
}

describe('generator', () => {
  it('生成的关卡全部可解（抽样 60 关）', () => {
    const samples = [1, 2, 5, 10, 11, 20, 30, 31, 45, 60, 61, 80, 100, 120, 150, 151, 200, 250, 300, 350, 400, 401, 450, 500, 550, 600, 650, 700, 701, 750, 800, 850, 900, 950, 1000];
    for (const idx of samples) {
      const lv = generateLevel(idx, GLOBAL_SEED);
      const res = solve(lv.grid);
      expect(res.solvable, `第 ${idx} 关应可解`).toBe(true);
    }
  });

  it('每关恰好一个 START 和一个 END', () => {
    for (const idx of [1, 50, 200, 700]) {
      const lv = generateLevel(idx, GLOBAL_SEED);
      expect(countType(lv.grid, CellType.START)).toBe(1);
      expect(countType(lv.grid, CellType.END)).toBe(1);
    }
  });

  it('同种子生成结果稳定（可复现）', () => {
    const a = generateLevel(42, GLOBAL_SEED);
    const b = generateLevel(42, GLOBAL_SEED);
    expect(a.grid).toEqual(b.grid);
    expect(a.shortest).toBe(b.shortest);
    expect(a.diff).toBe(b.diff);
  });

  it('不同关号生成不同布局', () => {
    const a = generateLevel(1, GLOBAL_SEED);
    const b = generateLevel(2, GLOBAL_SEED);
    expect(JSON.stringify(a.grid)).not.toBe(JSON.stringify(b.grid));
  });

  it('canonical 路径合法', () => {
    for (const idx of [3, 17, 88, 333, 900]) {
      const lv = generateLevel(idx, GLOBAL_SEED);
      const res = solve(lv.grid);
      expect(isPathLegal(lv.grid, res.paths[0]), `第 ${idx} 关路径应合法`).toBe(true);
    }
  });

  it('shortest 与求解器一致', () => {
    for (const idx of [5, 55, 555]) {
      const lv = generateLevel(idx, GLOBAL_SEED);
      const res = solve(lv.grid);
      expect(lv.shortest).toBe(res.steps);
    }
  });

  it('难度随关号总体递增', () => {
    const early = generateLevel(10, GLOBAL_SEED).diff;
    const mid = generateLevel(300, GLOBAL_SEED).diff;
    const late = generateLevel(950, GLOBAL_SEED).diff;
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
  });

  it('diff 落在 [0,100]', () => {
    for (const idx of [1, 50, 500, 1000]) {
      const d = generateLevel(idx, GLOBAL_SEED).diff;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(100);
    }
  });
});
