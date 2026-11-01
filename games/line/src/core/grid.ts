import { Dir, DIRS, DX, DY, CellType, type Cell } from './types';

export interface Point { x: number; y: number }

/** 格子索引与坐标互转。 */
export function idxOf(x: number, y: number, w: number): number { return y * w + x; }
export function xOf(idx: number, w: number): number { return idx % w; }
export function yOf(idx: number, w: number): number { return Math.floor(idx / w); }

/** 判断坐标是否在网格内。 */
export function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && x < w && y >= 0 && y < h;
}

/** 返回某格的四邻接格子索引（越界的会被剔除）。 */
export function neighbors(idx: number, w: number, h: number): number[] {
  const x = xOf(idx, w), y = yOf(idx, w);
  const out: number[] = [];
  for (const d of DIRS) {
    const nx = x + DX[d], ny = y + DY[d];
    if (inBounds(nx, ny, w, h)) out.push(idxOf(nx, ny, w));
  }
  return out;
}

/** 反向方向：d 的相反方向。 */
export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

/**
 * 判断能否进入 toIdx（网格为二维 grid[y][x]）。
 * 规则：目标不是 BLOCK；若目标是 ONEWAY，进入方向必须等于箭头方向。
 * @param enterDir 进入 toIdx 的方向
 */
export function canEnter(grid: Cell[][], toIdx: number, enterDir: Dir): boolean {
  const w = grid[0]?.length ?? 0;
  if (w === 0) return false;
  const x = xOf(toIdx, w), y = yOf(toIdx, w);
  if (!inBounds(x, y, w, grid.length)) return false;
  const cell = grid[y][x];
  if (cell.type === CellType.BLOCK) return false;
  if (cell.type === CellType.ONEWAY && cell.dir !== enterDir) return false;
  return true;
}

/** 找到网格中所有指定类型的格子索引。 */
export function findByType(grid: Cell[][], type: CellType): number[] {
  const out: number[] = [];
  const w = grid[0]?.length ?? 0;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x].type === type) out.push(idxOf(x, y, w));
    }
  }
  return out;
}

/** 把二维 grid 拍平成一维（行优先）。 */
export function flatten(grid: Cell[][]): Cell[] {
  const out: Cell[] = [];
  for (const row of grid) for (const c of row) out.push(c);
  return out;
}

/** 把一维 grid 还原成二维。 */
export function unflatten(flat: Cell[], w: number, h: number): Cell[][] {
  const out: Cell[][] = [];
  for (let y = 0; y < h; y++) out.push(flat.slice(y * w, (y + 1) * w));
  return out;
}

/** 统计阻挡块与单向块数量。 */
export function countSpecial(grid: Cell[][]): { blocks: number; oneways: number } {
  let blocks = 0, oneways = 0;
  for (const row of grid) {
    for (const c of row) {
      if (c.type === CellType.BLOCK) blocks++;
      else if (c.type === CellType.ONEWAY) oneways++;
    }
  }
  return { blocks, oneways };
}
