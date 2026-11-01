import { describe, it, expect } from 'vitest';
import { encodeGrid, decodeGrid } from '../src/core/codec';
import { CellType, Dir, type Cell } from '../src/core/types';

describe('grid codec', () => {
  it('往返一致（含所有类型与方向）', () => {
    const w = 4, h = 3;
    const grid: Cell[][] = [
      [
        { type: CellType.BLOCK, dir: Dir.UP },
        { type: CellType.BRICK, dir: Dir.DOWN },
        { type: CellType.ONEWAY, dir: Dir.LEFT },
        { type: CellType.ONEWAY, dir: Dir.RIGHT },
      ],
      [
        { type: CellType.START, dir: Dir.UP },
        { type: CellType.END, dir: Dir.DOWN },
        { type: CellType.BRICK, dir: Dir.LEFT },
        { type: CellType.ONEWAY, dir: Dir.UP },
      ],
      [
        { type: CellType.BRICK, dir: Dir.RIGHT },
        { type: CellType.BLOCK, dir: Dir.DOWN },
        { type: CellType.BRICK, dir: Dir.UP },
        { type: CellType.ONEWAY, dir: Dir.DOWN },
      ],
    ];
    const b64 = encodeGrid(grid, w, h);
    const back = decodeGrid(b64, w, h);
    expect(back.length).toBe(h);
    for (let y = 0; y < h; y++) {
      expect(back[y].length).toBe(w);
      for (let x = 0; x < w; x++) {
        expect(back[y][x].type).toBe(grid[y][x].type);
        // 只有 ONEWAY 的方向需要往返一致，其余类型方向编码时归零
        if (grid[y][x].type === CellType.ONEWAY) {
          expect(back[y][x].dir).toBe(grid[y][x].dir);
        } else {
          expect(back[y][x].dir).toBe(Dir.UP);
        }
      }
    }
  });

  it('单向块保留方向，其他类型方向归零', () => {
    const grid: Cell[][] = [
      [
        { type: CellType.ONEWAY, dir: Dir.LEFT },
        { type: CellType.BRICK, dir: Dir.RIGHT },
      ],
    ];
    const back = decodeGrid(encodeGrid(grid, 2, 1), 2, 1);
    expect(back[0][0].dir).toBe(Dir.LEFT);
    // 非单向块编码时方向强制归零
    expect(back[0][1].dir).toBe(Dir.UP);
  });

  it('尺寸不匹配时抛错', () => {
    expect(() => encodeGrid([[{ type: CellType.BRICK, dir: Dir.UP }]], 2, 2)).toThrow();
  });
});
