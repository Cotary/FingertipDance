# T05 — core: generator（关卡生成器）

**目标**：实现「必可解」的关卡生成器。这是整个项目的技术核心。

**前置依赖**：T04。

---

## 步骤

### 5.1 写 `src/core/generator.ts`

```ts
import { CellType, DIRS, DX, DY, Dir, type Cell } from './types';
import { idxOf, xOf, yOf, inBounds, canEnter } from './grid';
import { solve, isPathLegal, countTurns, dirOfDelta } from './solver';
import { curveFor, computeDiff, targetDiff, type CurveParams } from './curve';
import { mulberry32, levelSeed, type Rng } from './rng';

const MAX_ATTEMPT = 40;

/** 生成结果（不含最终难度字段，难度由调用方或 pipeline 填充）。 */
export interface GeneratedLevel {
  idx: number;
  seed: number;
  w: number;
  h: number;
  grid: Cell[][];
  shortest: number;
  turns: number;
  blocks: number;
  oneways: number;
  diff: number;
}

/**
 * 生成一关，保证可解。
 * @param idx 关号（1 起）
 * @param globalSeed 全局种子
 */
export function generateLevel(idx: number, globalSeed: number): GeneratedLevel {
  const params = curveFor(idx);
  const seed = levelSeed(globalSeed, idx);
  const rng = mulberry32(seed);

  let best: GeneratedLevel | null = null;
  let bestDelta = Infinity;

  for (let attempt = 0; attempt < MAX_ATTEMPT; attempt++) {
    const level = attemptGenerate(idx, params, rng);
    if (!level) continue;

    const res = solve(level.grid);
    if (!res.solvable) continue;                        // 情况 A：无解
    if (res.steps < params.minPathLen) continue;        // 情况 A'：太短

    let pathCount = res.pathCount;
    if (pathCount > 1) {
      // 情况 C：分叉太多 → 尝试收窄
      const narrowed = narrowBranches(level.grid, res.paths, rng, params.branchPenalty);
      if (!narrowed) continue;
      const res2 = solve(level.grid);
      if (!res2.solvable || res2.pathCount > 1) continue;
      pathCount = res2.pathCount;
    }

    level.shortest = res.steps;
    level.turns = countTurns(res.paths[0], level.w);
    const openRatio = 1 - level.blocks / (level.w * level.h);
    level.diff = computeDiff({
      w: level.w, h: level.h,
      blocks: level.blocks, oneways: level.oneways,
      turns: level.turns, pathCount, openRatio,
    });

    const delta = Math.abs(level.diff - targetDiff(idx));
    if (delta <= 6) return level;

    // 情况 B：难度偏离 → 微调
    const adjusted = adjust(level, params, rng, res.paths[0]);
    if (adjusted) {
      const adjDelta = Math.abs(adjusted.diff - targetDiff(idx));
      if (adjDelta < bestDelta) { best = adjusted; bestDelta = adjDelta; }
      if (adjDelta <= 6) return adjusted;
    }
    if (delta < bestDelta) { best = level; bestDelta = delta; }
  }

  if (best) return best;
  // 极端兜底：生成一个最简单的关卡，保证流水线不崩
  return fallbackLevel(idx, params, seed);
}
```

### 5.2 `attemptGenerate` —— 单次尝试

```ts
/**
 * 构造一关（不保证可解，由调用方校验）。
 * 步骤：摆起终点 → 造正解路径 → 放单向块 → 放阻挡块 → 检查开放比。
 */
function attemptGenerate(idx: number, params: CurveParams, rng: Rng): GeneratedLevel | null {
  const { w, h } = params;
  const total = w * h;
  const grid: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) row.push({ type: CellType.BRICK, dir: Dir.UP });
    grid.push(row);
  }

  // ── 步骤 1：摆 START / END ──
  const start = pickEdgePoint(rng, w, h);
  const end = pickEdgePoint(rng, w, h, start);
  if (!start || !end) return null;
  grid[start.y][start.x] = { type: CellType.START, dir: Dir.UP };
  grid[end.y][end.x] = { type: CellType.END, dir: Dir.UP };

  // ── 步骤 2：造正解路径 ──
  const path = growPath(grid, start, end, params, rng);
  if (!path || path.length < params.minPathLen + 1) return null;

  // ── 步骤 3：放单向块（必须在路径上，且箭头 = 该处的离开方向）──
  const onewayCount = Math.min(params.oneways, Math.max(0, path.length - 3));
  if (onewayCount > 0) {
    // 候选位置：路径中间部分（避开前 2 格与后 2 格）
    const candidates: number[] = [];
    for (let i = 2; i < path.length - 2; i++) candidates.push(i);
    const chosen = rng.shuffle(candidates).slice(0, onewayCount);
    for (const i of chosen) {
      const idxPath = path[i];
      const x = xOf(idxPath, w), y = yOf(idxPath, w);
      const next = path[i + 1];
      const leaveDir = dirOfDelta(xOf(next, w) - x, yOf(next, w) - y);
      grid[y][x] = { type: CellType.ONEWAY, dir: leaveDir };
    }
  }

  // ── 步骤 4：放阻挡块（避开路径、避开起点周围）──
  const pathSet = new Set(path);
  const startIdx = idxOf(start.x, start.y, w);
  const protectedCells = new Set<number>([startIdx, ...neighborsOf(startIdx, w, h)]);
  const freeCells: number[] = [];
  for (let i = 0; i < total; i++) {
    if (pathSet.has(i)) continue;
    if (protectedCells.has(i)) continue;
    freeCells.push(i);
  }
  let blockCount = Math.min(params.blocks, freeCells.length);
  // 开放面积比下限约束
  const maxBlocksByRatio = Math.max(0, Math.floor(total * (1 - params.openRatio)) - params.blocks);
  const shuffled = rng.shuffle(freeCells);
  const blocks: number[] = [];
  for (const cellIdx of shuffled) {
    if (blocks.length >= blockCount) break;
    blocks.push(cellIdx);
  }
  for (const cellIdx of blocks) {
    grid[yOf(cellIdx, w)][xOf(cellIdx, w)] = { type: CellType.BLOCK, dir: Dir.UP };
  }

  const blocksCount = blocks.length;
  const onewaysCount = countOneways(grid);

  return {
    idx, seed: 0, w, h, grid,
    shortest: -1, turns: 0,
    blocks: blocksCount, oneways: onewaysCount,
    diff: 0,
  };
}
```

### 5.3 `growPath` —— 造带强制转弯的正解路径

```ts
/**
 * 生长一条从 start 到 end 的路径，尽量少转弯但满足 minTurns。
 * @returns 格子索引序列（含 start 与 end），失败返回 null
 */
function growPath(
  grid: Cell[][], start: { x: number; y: number }, end: { x: number; y: number },
  params: CurveParams, rng: Rng,
): number[] | null {
  const { w, h } = params;
  const path: number[] = [idxOf(start.x, start.y, w)];
  const used = new Set<number>(path);
  let cur = { x: start.x, y: start.y };
  let lastDir: Dir | null = null;
  let turns = 0;

  const maxSteps = w * h * 2;
  for (let step = 0; step < maxSteps; step++) {
    // 到达终点？检查长度与转弯是否达标
    if (cur.x === end.x && cur.y === end.y) {
      if (path.length - 1 >= params.minPathLen && turns >= params.minTurns) return path;
      return null;
    }

    // 候选方向：排除回退，优先靠近终点
    const candidates = DIRS.filter((d) => {
      const nx = cur.x + DX[d], ny = cur.y + DY[d];
      if (!inBounds(nx, ny, w, h)) return false;
      const ni = idxOf(nx, ny, w);
      if (used.has(ni)) return false;
      return true;
    });
    if (candidates.length === 0) return null;

    const scored = candidates.map((d) => {
      const nx = cur.x + DX[d], ny = cur.y + DY[d];
      const distToEnd = Math.abs(nx - end.x) + Math.abs(ny - end.y);
      const isTurn = lastDir !== null && d !== lastDir;
      const needTurn = turns < params.minTurns;
      // 分数越大越优先
      let score = -distToEnd * 10 + rng.next() * 6;
      if (needTurn && isTurn) score += 12;
      if (!needTurn && !isTurn) score += 4;
      return { d, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0].d;

    const nx = cur.x + DX[chosen], ny = cur.y + DY[chosen];
    const ni = idxOf(nx, ny, w);
    if (lastDir !== null && chosen !== lastDir) turns++;
    path.push(ni);
    used.add(ni);
    cur = { x: nx, y: ny };
    lastDir = chosen;

    // 长度够了但还没到终点 → 继续走（随机漂移）
  }
  return null;
}
```

> **重要**：路径不能经过 END 之后又折返（`used` 集合保证不重复经过任何格）。
> **注意**：路径**不要求最短**，只要合法即可 —— 求解器会算出真实最短步数。

### 5.4 `narrowBranches` —— 收窄分叉

```ts
/**
 * 通过放置阻挡块消除等价最短路径。
 * @param grid 会被就地修改
 * @param paths solver 返回的最短路径集合（至少 2 条）
 */
function narrowBranches(
  grid: Cell[][], paths: number[][], rng: Rng, penalty: number,
): boolean {
  if (paths.length < 2) return true;
  const w = grid[0].length, h = grid.length;

  // 尝试最多 3 轮收窄
  for (let round = 0; round < 3; round++) {
    const res = solve(grid);
    if (!res.solvable || res.pathCount <= 1) return true;

    // 取第一条路径与其它路径的公共前缀，找分叉点
    const p0 = res.paths[0];
    let forkPos = -1;
    for (const other of res.paths.slice(1)) {
      const common = commonPrefixLen(p0, other);
      // 选最靠后的公共前缀作为分叉点（更靠近终点，封口更有效）
      if (common > forkPos) forkPos = common;
    }
    if (forkPos <= 0 || forkPos >= p0.length - 1) {
      // 分叉点在起点或终点附近 → 换个策略：在分叉点的"另一分支"上放阻挡
      forkPos = Math.max(1, Math.min(p0.length - 2, Math.floor(p0.length / 2)));
    }

    const forkCell = p0[forkPos];
    const prevCell = p0[forkPos - 1];
    const dir = dirOfDelta(xOf(forkCell, w) - xOf(prevCell, w), yOf(forkCell, w) - yOf(prevCell, w));

    // 找分叉点的其它候选方向（非主路径方向）
    const fx = xOf(forkCell, w), fy = yOf(forkCell, w);
    const altDirs = DIRS.filter((d) => d !== dir);
    const placed = rng.shuffle(altDirs);

    let done = false;
    for (const d of placed) {
      const nx = fx + DX[d], ny = fy + DY[d];
      if (!inBounds(nx, ny, w, h)) continue;
      const ni = idxOf(nx, ny, w);
      if (grid[ny][nx].type === CellType.START || grid[ny][nx].type === CellType.END) continue;
      // 不能挡掉主路径
      if (p0.includes(ni)) continue;
      // 尝试放置阻挡
      const backup = { ...grid[ny][nx] };
      grid[ny][nx] = { type: CellType.BLOCK, dir: Dir.UP };
      const check = solve(grid);
      if (check.solvable) {
        done = true;
        break;
      }
      grid[ny][nx] = backup;  // 回滚
    }
    if (!done) return false;
  }
  return true;
}
```

> **注意**：`res.paths` 在 T03 的简化实现里只包含一条路径。要让 `narrowBranches` 能工作，**必须让 solver 返回多条路径**。
> → 在 T03 的 `solve` 里实现「必做修正 2」的简化方案时，**同时把各条最短路径都收集进 `paths`**（上限 `maxPaths`）。
> 若 `paths.length < 2`，`narrowBranches` 退化为「用 `pathCount > 1` 的信息 + 分叉点猜测」→ 改为：`pathCount > 1` 时直接在**路径中段**的旁侧放阻挡（试 4 个方向），只要放完 `pathCount` 变 1 就成功。

### 5.5 `adjust` —— 难度微调

```ts
/**
 * 依据偏差方向微调关卡难度。返回 null 表示无法调整。
 */
function adjust(
  level: GeneratedLevel, params: CurveParams, rng: Rng, canonical: number[],
): GeneratedLevel | null {
  const { w, h } = level;
  const target = targetDiff(level.idx);
  const delta = level.diff - target;

  // 深拷贝，避免污染原关卡
  const grid = level.grid.map((row) => row.map((c) => ({ ...c })));
  const pathSet = new Set(canonical);

  if (delta < 0) {
    // 太简单 → 加阻挡
    const free: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = idxOf(x, y, w);
        if (pathSet.has(i)) continue;
        if (grid[y][x].type === CellType.BLOCK) continue;
        if (grid[y][x].type === CellType.START || grid[y][x].type === CellType.END) continue;
        free.push(i);
      }
    }
    const add = Math.min(rng.int(1, 4), free.length);
    for (const i of rng.shuffle(free).slice(0, add)) {
      grid[yOf(i, w)][xOf(i, w)] = { type: CellType.BLOCK, dir: Dir.UP };
    }
  } else {
    // 太难 → 移除阻挡
    const blocks: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x].type === CellType.BLOCK) blocks.push(idxOf(x, y, w));
      }
    }
    const remove = Math.min(rng.int(1, 4), blocks.length);
    for (const i of rng.shuffle(blocks).slice(0, remove)) {
      grid[yOf(i, w)][xOf(i, w)] = { type: CellType.BRICK, dir: Dir.UP };
    }
  }

  const res = solve(grid);
  if (!res.solvable) return null;
  const turns = countTurns(res.paths[0], w);
  const blocks = countBlocks(grid);
  const oneways = countOneways(grid);
  const openRatio = 1 - blocks / (w * h);

  return {
    ...level,
    grid,
    shortest: res.steps,
    turns,
    blocks,
    oneways,
    diff: computeDiff({ w, h, blocks, oneways, turns, pathCount: res.pathCount, openRatio }),
  };
}
```

### 5.6 辅助函数

```ts
/** 在网格边缘随机取一点。 */
function pickEdgePoint(rng: Rng, w: number, h: number, avoid?: { x: number; y: number }): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < w; x++) { candidates.push({ x, y: 0 }); candidates.push({ x, y: h - 1 }); }
  for (let y = 0; y < h; y++) { candidates.push({ x: 0, y }); candidates.push({ x: w - 1, y }); }
  const filtered = candidates.filter((p) => !avoid || p.x !== avoid.x || p.y !== avoid.y);
  if (filtered.length === 0) return null;
  return rng.pick(filtered);
}

/** 两数组的公共前缀长度。 */
function commonPrefixLen(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** 某格的索引邻居。 */
function neighborsOf(idx: number, w: number, h: number): number[] {
  const x = xOf(idx, w), y = yOf(idx, w);
  const out: number[] = [];
  for (const d of DIRS) {
    const nx = x + DX[d], ny = y + DY[d];
    if (inBounds(nx, ny, w, h)) out.push(idxOf(nx, ny, w));
  }
  return out;
}

function countBlocks(grid: Cell[][]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c.type === CellType.BLOCK) n++;
  return n;
}

function countOneways(grid: Cell[][]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c.type === CellType.ONEWAY) n++;
  return n;
}

/** 兜底关卡：一条直线路径，保证可解。 */
function fallbackLevel(idx: number, params: CurveParams, seed: number): GeneratedLevel {
  const { w, h } = params;
  const grid: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) row.push({ type: CellType.BRICK, dir: Dir.UP });
    grid.push(row);
  }
  grid[0][0] = { type: CellType.START, dir: Dir.UP };
  grid[h - 1][w - 1] = { type: CellType.END, dir: Dir.UP };
  return {
    idx, seed, w, h, grid,
    shortest: w + h - 2, turns: 1, blocks: 0, oneways: 0, diff: 0,
  };
}
```

### 5.7 写测试 `games/line/test/generator.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { generateLevel } from '../src/core/generator';
import { solve, isPathLegal } from '../src/core/solver';
import { CellType } from '../src/core/types';
import { findByType } from '../src/core/grid';

const GLOBAL_SEED = 20261101;

describe('generator', () => {
  it('生成的关卡全部可解（抽样 60 关）', () => {
    for (const idx of [1, 2, 5, 10, 11, 20, 30, 31, 45, 60, 61, 80, 100, 120, 150, 151, 200, 250, 300, 350, 400, 401, 450, 500, 550, 600, 650, 700, 701, 750, 800, 850, 900, 950, 1000]) {
      const lv = generateLevel(idx, GLOBAL_SEED);
      const res = solve(lv.grid);
      expect(res.solvable, `第 ${idx} 关应可解`).toBe(true);
    }
  });

  it('每关恰好一个 START 和一个 END', () => {
    for (const idx of [1, 50, 200, 700]) {
      const lv = generateLevel(idx, GLOBAL_SEED);
      const flat = lv.grid.flat();
      expect(findByType(flat, CellType.START).length).toBe(1);
      expect(findByType(flat, CellType.END).length).toBe(1);
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
```

---

## 验收

```powershell
cd I:\work\f-game\games\line
npm run typecheck
npm test
```
**期望**：generator 测试全部通过。

**额外自检**：生成 100 关，统计 `diff` 与 `targetDiff` 的偏差分布：
```ts
// tools/gen-print.ts
import { generateLevel } from '../src/core/generator';
import { targetDiff } from '../src/core/curve';
let sum = 0;
for (let i = 1; i <= 100; i++) {
  const lv = generateLevel(i, 20261101);
  const d = Math.abs(lv.diff - targetDiff(i));
  sum += d;
  if (d > 12) console.log('偏离过大:', i, lv.diff, targetDiff(i));
}
console.log('平均偏差', (sum / 100).toFixed(2));
```
**期望**：平均偏差 ≤ 8。

---

## 坑
- **`solve` 必须返回多条最短路径**，否则 `narrowBranches` 无从下手（见 5.4 的注释）→ 若 T03 未实现多路径收集，先回去补
- `pickEdgePoint` 可能让 START 与 END 在同一条边（例如都在 y=0）→ 用 `avoid` 排除同一点，但同边不同点仍可能。**追加约束**：START 与 END 不在同一条边（在 `attemptGenerate` 里检查 `start.y !== end.y && start.x !== end.x` 的至少一个成立，即不在同一行也同列的极端情况）
- `growPath` 可能死循环 → 用 `used` 集合 + `maxSteps` 限制
- `adjust` 后必须重跑 solver，若不可解则返回 null（不要返回不可解的关卡）
- 单向块放在路径上时，箭头方向必须是**离开方向**，不是进入方向 → 写反会直接导致无解

---

## 产出物
- `src/core/generator.ts`
- `test/generator.test.ts`
