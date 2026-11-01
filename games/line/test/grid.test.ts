import { describe, it, expect } from 'vitest';
import { neighbors, canEnter, idxOf, xOf, yOf, countSpecial } from '../src/core/grid';
import { CellType, Dir, type Cell } from '../src/core/types';

describe('grid', () => {
  it('索引与坐标互转', () => {
    const w = 5;
    expect(idxOf(3, 2, w)).toBe(13);
    expect(xOf(13, w)).toBe(3);
    expect(yOf(13, w)).toBe(2);
  });

  it('邻居数量：角落 2 / 边 3 / 内部 4', () => {
    const w = 3, h = 3;
    const at = (x: number, y: number) => idxOf(x, y, w);
    expect(neighbors(at(0, 0), w, h).length).toBe(2);
    expect(neighbors(at(1, 0), w, h).length).toBe(3);
    expect(neighbors(at(1, 1), w, h).length).toBe(4);
  });

  it('单向块只允许按箭头方向进入', () => {
    // 3x1 网格：idx0 ONEWAY 朝右，idx1/idx2 BRICK
    const grid: Cell[][] = [[
      { type: CellType.ONEWAY, dir: Dir.RIGHT },
      { type: CellType.BRICK, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.UP },
    ]];
    // 进入 idx0 的方向是 LEFT，但箭头朝右 → 不可
    expect(canEnter(grid, 0, Dir.LEFT)).toBe(false);
    // 进入 idx1（目标非单向块）→ 可
    expect(canEnter(grid, 1, Dir.RIGHT)).toBe(true);
  });

  it('阻挡块不可进入', () => {
    const grid: Cell[][] = [[
      { type: CellType.BLOCK, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.UP },
    ]];
    expect(canEnter(grid, 0, Dir.LEFT)).toBe(false);
  });

  it('countSpecial 正确统计', () => {
    const grid: Cell[][] = [[
      { type: CellType.BLOCK, dir: Dir.UP },
      { type: CellType.ONEWAY, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.UP },
    ]];
    expect(countSpecial(grid)).toEqual({ blocks: 1, oneways: 1 });
  });
});
