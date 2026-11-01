# T02 — core: rng + grid + types

**目标**：实现确定性随机、坐标/方向/邻居、网格 base64 编解码，以及全部核心类型定义。

**前置依赖**：T01。

---

## 步骤

### 2.1 写 `src/core/types.ts`
```ts
/** 方向：移动方向。UP 表示向上移动（y 减小）。 */
export const Dir = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];
export const DIRS: Dir[] = [Dir.UP, Dir.DOWN, Dir.LEFT, Dir.RIGHT];

/** 方向在 x/y 上的增量，索引与 Dir 对应。 */
export const DX: Readonly<number[]> = [0, 0, -1, 1];
export const DY: Readonly<number[]> = [-1, 1, 0, 0];

/** 格子类型。 */
export const CellType = {
  BLOCK: 0,
  BRICK: 1,
  ONEWAY: 2,
  START: 3,
  END: 4,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

/** 单个格子的内容。 */
export interface Cell {
  type: CellType;
  /** 仅当 type === CellType.ONEWAY 时有效。 */
  dir: Dir;
}

/** 一个关卡。 */
export interface Level {
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** grid[y][x]，行优先。 */
  grid: Cell[][];
  /** 理论最少步数（BFS 得出）。 */
  shortest: number;
  /** canonical 路径的转弯数。 */
  turns: number;
  blocks: number;
  oneways: number;
  /** 难度分 0..100。 */
  diff: number;
  unlockSkin: string | null;
}

/** 关卡表（公开部分）。 */
export interface LevelTable {
  version: string;
  count: number;
  generatedAt: string;
  levels: Level[];
}

/** 关卡表中每关的公开字段（不含内部 grid 的类型细节）。 */
export type PublicLevel = Level;
```

### 2.2 写 `src/core/rng.ts`
```ts
import type { Rng } from './types-rng';
```
> 直接写进 `rng.ts`：

```ts
/** 种子化随机数发生器。所有生成逻辑必须使用它，禁止 Math.random。 */
export interface Rng {
  /** 返回 [0, 1) 的浮点数。 */
  next(): number;
  /** 返回 [minInclusive, maxExclusive) 的整数。 */
  int(minInclusive: number, maxExclusive: number): number;
  /** 从数组中随机取一个元素（数组不能为空）。 */
  pick<T>(arr: readonly T[]): T;
  /** 返回打乱后的新数组（不修改入参）。 */
  shuffle<T>(arr: readonly T[]): T[];
  /** 以概率 p 返回 true。 */
  chance(p: number): boolean;
}

/** mulberry32：32 位种子、快速、分布均匀，适合关卡生成。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => {
    if (max <= min) throw new Error(`int: max(${max}) 必须 > min(${min})`);
    return min + Math.floor(next() * (max - min));
  };
  return {
    next,
    int,
    pick: <T,>(arr: readonly T[]) => {
      if (arr.length === 0) throw new Error('pick: 数组为空');
      return arr[int(0, arr.length)];
    },
    shuffle: <T,>(arr: readonly T[]) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance: (p: number) => next() < p,
  };
}

/** FNV-1a 32 位字符串哈希，用于把 seed 字符串转成数字种子。 */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由全局种子和关号派生每关独立种子，保证关卡之间互不相关。 */
export function levelSeed(globalSeed: number, idx: number): number {
  return hashSeed(`${globalSeed}:${idx}`);
}
```

### 2.3 写 `src/core/grid.ts`
```ts
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
 * 判断能否从 fromIdx 进入 toIdx。
 * 规则：目标不是 BLOCK；若目标是 ONEWAY，进入方向必须等于箭头方向。
 * @param enterDir 从 fromIdx 指向 toIdx 的方向
 */
export function canEnter(grid: Cell[][], fromIdx: number, toIdx: number, enterDir: Dir): boolean {
  const cell = grid[toIdx];
  if (!cell) return false;
  if (cell.type === CellType.BLOCK) return false;
  if (cell.type === CellType.ONEWAY && cell.dir !== enterDir) return false;
  return true;
}

/** 找到网格中所有指定类型的格子索引。 */
export function findByType(grid: Cell[], type: CellType): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i].type === type) out.push(i);
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
export function countSpecial(grid: Cell[]): { blocks: number; oneways: number } {
  let blocks = 0, oneways = 0;
  for (const c of grid) {
    if (c.type === CellType.BLOCK) blocks++;
    else if (c.type === CellType.ONEWAY) oneways++;
  }
  return { blocks, oneways };
}
```

### 2.4 写 `src/core/codec.ts`（编码解码，单独文件便于测试）
```ts
import { CellType, Dir, type Cell } from './types';

/**
 * 把网格编码成 base64。
 * 每格 1 字节：bit7 = 是否单向块，bit6..4 = 方向，bit3..1 = 类型，bit0 = 保留位。
 */
export function encodeGrid(grid: Cell[], w: number, h: number): string {
  if (grid.length !== w * h) throw new Error(`encodeGrid: 期望 ${w * h} 格，实际 ${grid.length}`);
  const bytes = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    const isOneWay = c.type === CellType.ONEWAY ? 1 : 0;
    const dir = isOneWay ? (c.dir & 0b111) : 0;
    bytes[i] = (isOneWay << 7) | (dir << 4) | ((c.type & 0b111) << 1);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // 浏览器与 Node 都能用
  const btoaFn = typeof btoa === 'function' ? btoa : (s: string) => Buffer.from(s, 'binary').toString('base64');
  return btoaFn(bin);
}

/** 解码 base64 网格。 */
export function decodeGrid(b64: string, w: number, h: number): Cell[] {
  const atobFn = typeof atob === 'function'
    ? atob
    : (s: string) => Buffer.from(s, 'base64').toString('binary');
  const bin = atobFn(b64);
  if (bin.length !== w * h) throw new Error(`decodeGrid: 期望 ${w * h} 字节，实际 ${bin.length}`);
  const out: Cell[] = [];
  for (let i = 0; i < bin.length; i++) {
    const byte = bin.charCodeAt(i);
    const isOneWay = (byte >> 7) & 1;
    const dir = ((byte >> 4) & 0b111) as Dir;
    const type = ((byte >> 1) & 0b111) as CellType;
    out.push({ type: isOneWay ? CellType.ONEWAY : type, dir });
  }
  return out;
}
```
> **注意**：BLOCK/BRICK/START/END 的 `dir` 一律存 0；只有 ONEWAY 存真实方向。往返测试要验证这一点。

### 2.5 写 `src/test/`（实际放 `games/line/test/`）单元测试
`games/line/test/codec.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { encodeGrid, decodeGrid } from '../src/core/codec';
import { CellType, Dir, type Cell } from '../src/core/types';

describe('grid codec', () => {
  it('往返一致（含所有类型与方向）', () => {
    const w = 4, h = 3;
    const grid: Cell[] = [
      { type: CellType.BLOCK, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.DOWN },
      { type: CellType.ONEWAY, dir: Dir.LEFT },
      { type: CellType.ONEWAY, dir: Dir.RIGHT },
      { type: CellType.START, dir: Dir.UP },
      { type: CellType.END, dir: Dir.DOWN },
      { type: CellType.BRICK, dir: Dir.LEFT },
      { type: CellType.ONEWAY, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.RIGHT },
      { type: CellType.BLOCK, dir: Dir.DOWN },
      { type: CellType.BRICK, dir: Dir.UP },
      { type: CellType.ONEWAY, dir: Dir.DOWN },
    ];
    const b64 = encodeGrid(grid, w, h);
    const back = decodeGrid(b64, w, h);
    expect(back.length).toBe(grid.length);
    for (let i = 0; i < grid.length; i++) {
      expect(back[i].type).toBe(grid[i].type);
      expect(back[i].dir).toBe(grid[i].dir);
    }
  });

  it('单向块保留方向，其他类型方向归零', () => {
    const grid: Cell[] = [
      { type: CellType.ONEWAY, dir: Dir.LEFT },
      { type: CellType.BRICK, dir: Dir.RIGHT },
    ];
    const back = decodeGrid(encodeGrid(grid, 2, 1), 2, 1);
    expect(back[0].dir).toBe(Dir.LEFT);
    expect(back[1].dir).toBe(Dir.RIGHT); // BRICK 保留原 dir（不参与逻辑）
  });

  it('尺寸不匹配时抛错', () => {
    expect(() => encodeGrid([{ type: CellType.BRICK, dir: Dir.UP }], 2, 2)).toThrow();
  });
});
```

`games/line/test/rng.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { mulberry32, levelSeed, hashSeed } from '../src/core/rng';

describe('rng', () => {
  it('同种子产生同序列', () => {
    const a = mulberry32(12345), b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('不同种子产生不同序列', () => {
    expect(mulberry32(1).next()).not.toBe(mulberry32(2).next());
  });

  it('int 落在 [min, max)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle 不修改入参且元素集合不变', () => {
    const src = [1,2,3,4,5,6,7,8];
    const out = mulberry32(9).shuffle(src);
    expect(src).toEqual([1,2,3,4,5,6,7,8]);
    expect(out.slice().sort((a,b)=>a-b)).toEqual(src);
  });

  it('levelSeed 对不同关号产出不同种子', () => {
    expect(levelSeed(1, 1)).not.toBe(levelSeed(1, 2));
    expect(levelSeed(1, 1)).toBe(levelSeed(1, 1));
  });
});
```

`games/line/test/grid.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { neighbors, canEnter, idxOf, xOf, yOf } from '../src/core/grid';
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
    expect(neighbors(at(0,0), w, h).length).toBe(2);
    expect(neighbors(at(1,0), w, h).length).toBe(3);
    expect(neighbors(at(1,1), w, h).length).toBe(4);
  });

  it('单向块只允许按箭头方向进入', () => {
    const grid: Cell[] = [
      { type: CellType.ONEWAY, dir: Dir.RIGHT },  // idx0，箭头朝右
      { type: CellType.BRICK, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.UP },
    ];
    // 从 idx1 向右进入 idx0 → 方向是 LEFT，不是 RIGHT → 不可
    expect(canEnter(grid, 1, 0, Dir.LEFT)).toBe(false);
    // 从 idx2 方向 RIGHT 进入 idx0？不可能（0 在 2 左边）→ 用反向验证
    expect(canEnter(grid, 0, 1, Dir.RIGHT)).toBe(true);  // 从单向块向右离开：目标不是单向块
  });

  it('阻挡块不可进入', () => {
    const grid: Cell[] = [
      { type: CellType.BLOCK, dir: Dir.UP },
      { type: CellType.BRICK, dir: Dir.UP },
    ];
    expect(canEnter(grid, 1, 0, Dir.LEFT)).toBe(false);
  });
});
```

---

## 验收

```powershell
cd I:\work\f-game\games\line
npm run typecheck
npm test
```
**期望**：3 个测试文件全部通过（codec 3 + rng 5 + grid 4 ≈ 12 个用例）。

---

## 坑
- `atob`/`btoa` 在 Node 18+ 有全局，但在 vitest 的 node 环境可能没有 → 已用 `typeof` 做兜底，**保持这个写法**
- `exactOptionalPropertyTypes` 若开了会报错 → 已在 tsconfig 设为 false
- `noUnusedLocals` 会让未使用的导入报错 → 写完及时清理

---

## 产出物
- `src/core/types.ts` `rng.ts` `grid.ts` `codec.ts`
- `test/codec.test.ts` `rng.test.ts` `grid.test.ts`

---

## 遗留问题

| 日期 | 问题 | 处理方式 |
|---|---|---|
| 2026-11-01 | 任务书 2.3 节 `canEnter`/`findByType`/`countSpecial` 用一维 `Cell[]`，与规格 00/02 及 T03 solver 的二维 `Cell[][]`（`grid[y][x]`）冲突 | 以规格为准，统一改二维 `Cell[][]`；`canEnter` 移除冗余的 `fromIdx` 参数，改为 `canEnter(grid, toIdx, enterDir)` |
| 2026-11-01 | 任务书 codec 测试「往返一致」与「非 ONEWAY 方向归零」两断言矛盾（规格 02 §1.2 规定非 ONEWAY 的 dir 一律归 0） | 以规格为准：仅 ONEWAY 的 dir 往返保留，其余类型 dir 归零，测试已修正 |
| 2026-11-01 | vitest 默认 threads 池在 Windows 沙箱下并发写 vite-node SSR 缓存临时文件报 EPERM（`fs.promises.writeFile` → `AppData\Local\Temp\...\ssr\<hash>`），导致 vitest 退出码非 0（测试用例本身全通过） | 在 `vitest.config.ts` 设 `pool: 'forks'` + `poolOptions.forks.singleFork: true`，规避并发写冲突 |
