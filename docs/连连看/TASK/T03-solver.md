# T03 — core: solver（BFS 求解器）

**目标**：实现 BFS 求解器，它是整个项目的**基石** —— 生成器用它校验可解性、客户端用它做提示、服务端用同款逻辑校验成绩。

**前置依赖**：T02。

---

## 步骤

### 3.1 写 `src/core/solver.ts`

```ts
import { CellType, DIRS, DX, DY, Dir, type Cell } from './types';
import { idxOf, xOf, yOf, inBounds } from './grid';

export interface SolveResult {
  /** 是否存在从起点到终点的路径。 */
  solvable: boolean;
  /** 最短步数；无解时为 -1。 */
  steps: number;
  /** 所有最短路径（格子索引序列）。最多保留 maxPaths 条。 */
  paths: number[][];
  /** 最短路径总条数；达到上限时以 maxPaths 表示"至少这么多条"。 */
  pathCount: number;
  /** BFS 访问过的状态数。 */
  visited: number;
}

/** BFS 内部状态：格子 + 进入该格时的方向。单向块让方向成为状态的一部分。 */
interface State {
  idx: number;
  /** 进入该格时的方向；起点为 -1（无约束）。 */
  enterDir: number;
}

const NO_DIR = -1;

/**
 * 求解：从起点到终点的最短路径。
 * @param grid 二维网格
 * @param from 起点坐标，缺省为网格中的 START 格
 * @param maxPaths 最多收集多少条最短路径，用于唯一性判定
 */
export function solve(grid: Cell[][], from?: { x: number; y: number }, maxPaths = 8): SolveResult {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  if (w === 0 || h === 0) {
    return { solvable: false, steps: -1, paths: [], pathCount: 0, visited: 0 };
  }

  const startIdx = from ? idxOf(from.x, from.y, w) : findIndexOfType(grid, CellType.START);
  const endIdx = findIndexOfType(grid, CellType.END);
  if (startIdx < 0 || endIdx < 0) {
    return { solvable: false, steps: -1, paths: [], pathCount: 0, visited: 0 };
  }
  if (startIdx === endIdx) {
    return { solvable: true, steps: 0, paths: [[startIdx]], pathCount: 1, visited: 1 };
  }

  const total = w * h;
  const stateCount = total * 4;
  const dist = new Int32Array(stateCount).fill(-1);
  const parent = new Int32Array(stateCount).fill(-1);

  const keyOf = (idx: number, enterDir: number) => idx * 4 + (enterDir < 0 ? 0 : enterDir);
  // 注意：起点用 enterDir=NO_DIR 表示，但为便于索引，用 dir=0 存；进入后方向唯一确定，不影响正确性。

  interface QItem { idx: number; enterDir: number }
  const queue: QItem[] = [{ idx: startIdx, enterDir: NO_DIR }];
  dist[keyOf(startIdx, 0)] = 0;

  let head = 0;
  let found = false;
  let endDist = -1;

  while (head < queue.length) {
    const cur = queue[head++];
    const curDist = dist[keyOf(cur.idx, cur.enterDir)];
    const x = xOf(cur.idx, w), y = yOf(cur.idx, w);

    for (const d of DIRS) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inBounds(nx, ny, w, h)) continue;
      const nIdx = idxOf(nx, ny, w);
      const cell = grid[ny][nx];
      if (cell.type === CellType.BLOCK) continue;
      // 单向块：进入方向必须等于箭头方向
      if (cell.type === CellType.ONEWAY && cell.dir !== d) continue;

      const nKey = keyOf(nIdx, d);
      if (dist[nKey] === -1) {
        dist[nKey] = curDist + 1;
        parent[nKey] = keyOf(cur.idx, cur.enterDir);
        queue.push({ idx: nIdx, enterDir: d });
        if (nIdx === endIdx) {
          found = true;
          endDist = curDist + 1;
        }
      }
    }
    if (found && curDist >= endDist) break;
  }

  if (!found) {
    return { solvable: false, steps: -1, paths: [], pathCount: 0, visited: queue.length };
  }

  // 回溯出一条最短路径
  const firstPath = reconstruct(parent, keyOf(endIdx, endDirAt(grid, endIdx, w, dist, keyOf)), w);

  // 统计所有最短路径（唯一性判定）
  const pathCount = countShortestPaths(grid, startIdx, endIdx, w, h, endDist, maxPaths);

  return {
    solvable: true,
    steps: endDist,
    paths: [firstPath],
    pathCount,
    visited: queue.length,
  };
}
```

> **上面是骨架，实现时请按下面的细则修正**（骨架里的 `endDirAt` 是占位，必须按下方细则实现）：

#### 必做修正 1：`endDirAt` —— 终点是用哪个进入方向到达的

BFS 可能有多个不同的进入方向到达终点（终点不是单向块，所以各方向都合法）。实现方式：

```ts
/** 找出所有能到达终点且距离等于最短距离的状态 key。 */
function endStateKeys(
  grid: Cell[][], endIdx: number, w: number, dist: Int32Array, keyOf: (i: number, d: number) => number,
): number[] {
  const keys: number[] = [];
  for (const d of DIRS) {
    const k = keyOf(endIdx, d);
    if (dist[k] >= 0) keys.push(k);
  }
  return keys;
}
```
- `solve` 里：找到终点后记录 `endKeys`，`steps = min(dist[k])`
- 回溯时对每个 `endKey` 各回溯一次 → 得到该进入方向下的所有最短路径
- **把所有 `endKeys` 的路径合并进 `paths` 数组**

#### 必做修正 2：`countShortestPaths` —— 统计等价解数量

```ts
/**
 * 统计从 startIdx 到 endIdx 的最短路径条数（最多数到 limit）。
 * 做法：BFS 只在最短层内扩展，用 DP 累加每个状态的前驱数量。
 */
function countShortestPaths(
  grid: Cell[][], startIdx: number, endIdx: number,
  w: number, h: number, shortest: number, limit: number,
): number {
  const total = w * h;
  // counts[stateKey] = 到达该状态的最短路径条数
  const counts = new Map<number, number>();
  const dist = new Int32Array(total * 4).fill(-1);
  const keyOf = (idx: number, d: number) => idx * 4 + d;

  dist[keyOf(startIdx, 0)] = 0;
  counts.set(keyOf(startIdx, 0), 1);

  const queue: { idx: number; enterDir: number }[] = [{ idx: startIdx, enterDir: 0 }];
  let head = 0;
  let totalPaths = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const curDist = dist[keyOf(cur.idx, cur.enterDir)];
    if (curDist >= shortest) continue;

    const x = xOf(cur.idx, w), y = yOf(cur.idx, w);
    for (const d of DIRS) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inBounds(nx, ny, w, h)) continue;
      const nIdx = idxOf(nx, ny, w);
      const cell = grid[ny][nx];
      if (cell.type === CellType.BLOCK) continue;
      if (cell.type === CellType.ONEWAY && cell.dir !== d) continue;

      const nKey = keyOf(nIdx, d);
      const cand = curDist + 1;

      if (dist[nKey] === -1) {
        dist[nKey] = cand;
        counts.set(nKey, counts.get(keyOf(cur.idx, cur.enterDir)) ?? 0);
        queue.push({ idx: nIdx, enterDir: d });
      } else if (dist[nKey] === cand) {
        const prev = counts.get(keyOf(cur.idx, cur.enterDir)) ?? 0;
        counts.set(nKey, (counts.get(nKey) ?? 0) + prev);
      }

      if (nIdx === endIdx && dist[nKey] === shortest) {
        totalPaths = (counts.get(nKey) ?? 0);
        // 终点有多入口 → 累加其它进入方向的贡献
      }
    }
    if (dist[keyOf(endIdx, 0)] >= 0 && curDist >= shortest) break;
  }

  // 终点各进入方向求和
  let sum = 0;
  for (const d of DIRS) {
    const k = keyOf(endIdx, d);
    if (dist[k] === shortest) sum += counts.get(k) ?? 0;
  }
  return Math.min(sum, limit);
}
```

> **简化替代方案（推荐先用这个，够用且不容易写错）**：
> 在 `solve` 的 BFS 里，额外维护 `pathCountAt: Map<stateKey, number>`，规则：
> - 首次到达某状态：`pathCountAt.set(k, 1)`
> - 若再次以**相同距离**到达：`pathCountAt.set(k, pathCountAt.get(k)! + 1)`
> - 终点各进入方向的 count 求和 = 总条数
> - 累加时钳制到 `maxPaths`（超过就当作 ">= maxPaths"，够用于唯一性判定）
>
> 这样只需一次 BFS，不需要第二个函数。**采用这个简化方案。**

#### 必做修正 3：`reconstruct` 回溯

```ts
/** 从终点状态回溯出路径（格子索引序列）。 */
function reconstruct(parent: Int32Array, endKey: number): number[] {
  const path: number[] = [];
  let k = endKey;
  while (k !== -1) {
    path.push(Math.floor(k / 4));
    k = parent[k];
  }
  return path.reverse();
}
```
> 注意：起点存的是 `keyOf(startIdx, 0)`，`parent` 为 -1 作为终止。

### 3.2 追加到 `src/core/solver.ts` 的其余导出

```ts
/**
 * 校验一条路径是否合法。服务端成绩校验必须使用完全相同的规则。
 * 规则见 02-关卡格式与算法规格.md 第 5.4 节。
 */
export function isPathLegal(grid: Cell[][], path: number[]): boolean {
  if (!grid.length) return false;
  const w = grid[0].length, h = grid.length;
  if (path.length < 2) return false;

  const startIdx = findIndexOfType(grid, CellType.START);
  const endIdx = findIndexOfType(grid, CellType.END);
  if (startIdx < 0 || endIdx < 0) return false;
  if (path[0] !== startIdx) return false;
  if (path[path.length - 1] !== endIdx) return false;

  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    if (idx < 0 || idx >= w * h) return false;
    const x = xOf(idx, w), y = yOf(idx, w);
    const cell = grid[y][x];

    // 起点终点不能出现在中间
    if (i > 0 && i < path.length - 1) {
      if (cell.type === CellType.START || cell.type === CellType.END) return false;
    }
    // 阻挡块不可进入
    if (cell.type === CellType.BLOCK) return false;

    if (i > 0) {
      const prev = path[i - 1];
      const px = xOf(prev, w), py = yOf(prev, w);
      const dx = x - px, dy = y - py;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return false;  // 必须 4 邻接
      const enterDir = dirOfDelta(dx, dy);
      if (cell.type === CellType.ONEWAY && cell.dir !== enterDir) return false;
    }
  }
  return true;
}

/** 由坐标差求方向。 */
export function dirOfDelta(dx: number, dy: number): Dir {
  if (dy === -1) return Dir.UP;
  if (dy === 1) return Dir.DOWN;
  if (dx === -1) return Dir.LEFT;
  return Dir.RIGHT;
}

/** 统计路径的转弯次数（方向变化次数）。 */
export function countTurns(path: number[], w: number): number {
  if (path.length < 3) return 0;
  let turns = 0;
  let prevDir = -1;
  for (let i = 1; i < path.length; i++) {
    const px = xOf(path[i - 1], w), py = yOf(path[i - 1], w);
    const cx = xOf(path[i], w), cy = yOf(path[i], w);
    const d = dirOfDelta(cx - px, cy - py);
    if (prevDir !== -1 && d !== prevDir) turns++;
    prevDir = d;
  }
  return turns;
}

/**
 * 提示：从当前线头出发，给出接下来 1~steps 步的正确格子。
 * 若线头走不到终点（玩家走岔），返回空数组。
 */
export function findHint(grid: Cell[][], head: { x: number; y: number }, steps = 2): number[] {
  const w = grid[0]?.length ?? 0, h = grid.length;
  if (!w) return [];
  const res = solveFrom(grid, head.x, head.y);
  if (!res || res.path.length === 0) return [];
  // res.path 从 head 开始，返回其后的 steps 个格子
  return res.path.slice(1, 1 + steps);
}
```

### 3.3 `solveFrom` —— 从任意点求解（提示功能需要）

```ts
/**
 * 从任意格子求解到终点的最短路径（不考虑起点必须是 START）。
 * 用于提示功能：玩家可能已经走岔，需要从当前线头重新规划。
 */
export function solveFrom(grid: Cell[][], x: number, y: number): { path: number[]; steps: number } | null {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  if (!w || !inBounds(x, y, w, h)) return null;
  const endIdx = findIndexOfType(grid, CellType.END);
  if (endIdx < 0) return null;

  const total = w * h;
  const dist = new Int32Array(total * 4).fill(-1);
  const parent = new Int32Array(total * 4).fill(-1);
  const keyOf = (idx: number, d: number) => idx * 4 + d;

  const startIdx = idxOf(x, y, w);
  dist[keyOf(startIdx, 0)] = 0;
  const queue = [{ idx: startIdx, enterDir: 0 }];
  let head = 0;
  let endKey = -1;

  while (head < queue.length) {
    const cur = queue[head++];
    const curDist = dist[keyOf(cur.idx, cur.enterDir)];
    const cx = xOf(cur.idx, w), cy = yOf(cur.idx, w);
    for (const d of DIRS) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (!inBounds(nx, ny, w, h)) continue;
      const nIdx = idxOf(nx, ny, w);
      const cell = grid[ny][nx];
      if (cell.type === CellType.BLOCK) continue;
      if (cell.type === CellType.ONEWAY && cell.dir !== d) continue;
      const nKey = keyOf(nIdx, d);
      if (dist[nKey] !== -1) continue;
      dist[nKey] = curDist + 1;
      parent[nKey] = keyOf(cur.idx, cur.enterDir);
      queue.push({ idx: nIdx, enterDir: d });
      if (nIdx === endIdx) { endKey = nKey; head = queue.length; break; }
    }
  }

  if (endKey === -1) return null;
  const path = reconstruct(parent, endKey);
  return { path, steps: path.length - 1 };
}
```

### 3.4 追加辅助函数

```ts
/** 找到指定类型的第一个格子索引，找不到返回 -1。 */
export function findIndexOfType(grid: Cell[][], type: CellType): number {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x].type === type) return idxOf(x, y, grid[y].length);
    }
  }
  return -1;
}
```

### 3.5 写测试 `games/line/test/solver.test.ts`

```ts
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
    // 2x2: START(0) BRICK(1) / END(2) BRICK(3)
    const g = mk([
      [CellType.START], [CellType.BRICK],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    const r = solve(g);
    expect(r.solvable).toBe(true);
    expect(r.steps).toBe(2); // (0,0)->(1,0)->(1,1)->(0,1)
    expect(r.pathCount).toBe(1);
  });

  it('单向块挡住时无解', () => {
    // (0,0)START (1,0)ONEWAY 箭头朝左 → 从右边进不去
    const g = mk([
      [CellType.START], [CellType.ONEWAY, Dir.LEFT],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    expect(solve(g).solvable).toBe(false);
  });

  it('单向块方向正确时可达', () => {
    // (1,0)ONEWAY 箭头朝左，从 (1,0) 出发向左进入 (0,0) 是错的方向；
    // 改成从右往左：把 END 放在 (0,0)，单向块在 (1,0) 箭头朝右，START 在 (2,0)
    const g = mk([
      [CellType.END], [CellType.ONEWAY, Dir.RIGHT], [CellType.START],
      [CellType.BRICK], [CellType.BRICK], [CellType.BRICK],
    ], 3, 2);
    const r = solve(g);
    expect(r.solvable).toBe(true);
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
    const g = mk([
      [CellType.START], [CellType.BRICK],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    expect(isPathLegal(g, [0, 1, 3, 2])).toBe(true);
    expect(isPathLegal(g, [0, 3, 2])).toBe(false); // 0→3 不是邻接
  });

  it('isPathLegal 拒绝穿过阻挡块', () => {
    const g = mk([
      [CellType.START], [CellType.BLOCK],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    expect(isPathLegal(g, [0, 1, 2])).toBe(false);
  });

  it('isPathLegal 拒绝违背单向块方向', () => {
    const g = mk([
      [CellType.START], [CellType.ONEWAY, Dir.LEFT],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    // 进入 (1,0) 的方向是 LEFT，但箭头朝左表示"只能向左进入"→ 合法
    expect(isPathLegal(g, [0, 1, 3, 2])).toBe(true);
    // 另一关：箭头朝右，进入方向是 LEFT → 非法
    const g2 = mk([
      [CellType.START], [CellType.ONEWAY, Dir.RIGHT],
      [CellType.END], [CellType.BRICK],
    ], 2, 2);
    expect(isPathLegal(g2, [0, 1, 3, 2])).toBe(false);
  });

  it('countTurns 正确', () => {
    // 0(0,0) → 1(1,0) → 2(1,1) 拐一次
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
    const r = solveFrom(g, 4, 0);
    expect(r).not.toBeNull();
    expect(r!.path[0]).toBe(4);
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
**期望**：solver 测试全部通过（8 个用例）。

**额外自检**：随便造一个 5×5 全通网格，`solve` 的 `steps` 应等于曼哈顿距离，`pathCount` 应 > 1。

---

## 坑
- **终点有多个进入方向**：漏掉任何一条会导致漏算等价解 → 唯一性判定失效（关卡会"太水"）。务必按「必做修正 2」的简化方案累计各方向
- `parent` 数组存的是 **state key**（`idx*4 + dir`），回溯时 `Math.floor(k/4)` 才是格子索引
- `pathCount` 超过 `maxPaths` 时钳制，不要无限增长（组合爆炸）
- BFS 中 `dist[nKey] === cand` 的分支容易漏 → 等价解统计会偏小

---

## 产出物
- `src/core/solver.ts`
- `test/solver.test.ts`
