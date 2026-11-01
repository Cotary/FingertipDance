import { CellType, DIRS, DX, DY, Dir, type Cell } from './types';
import { idxOf, xOf, yOf, inBounds } from './grid';
import { solve, countTurns, dirOfDelta, type SolveResult } from './solver';
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
    level.seed = seed;

    const res = solve(level.grid);
    if (!res.solvable) continue;                        // 情况 A：无解
    if (res.steps < params.minPathLen) continue;        // 情况 A'：太短

    let pathCount = res.pathCount;
    let solved = res;
    if (pathCount > 1) {
      // 情况 C：分叉太多 → 尝试收窄（尽力而为，不强求唯一解）
      narrowBranches(level.grid, res, rng);
      const res2 = solve(level.grid);
      if (res2.solvable) {
        solved = res2;
        pathCount = res2.pathCount;
      }
    }

    // narrowBranches 可能新增阻挡块，重新统计
    level.blocks = countBlocks(level.grid);
    level.oneways = countOneways(level.grid);

    level.shortest = solved.steps;
    level.turns = countTurns(solved.paths[0], level.w);
    const openRatio = 1 - level.blocks / (level.w * level.h);
    level.diff = computeDiff({
      w: level.w, h: level.h,
      blocks: level.blocks, oneways: level.oneways,
      turns: level.turns, pathCount, openRatio,
    });

    const delta = Math.abs(level.diff - targetDiff(idx));
    if (delta <= 6) return level;

    // 情况 B：难度偏离 → 微调
    const adjusted = adjust(level, rng, solved.paths[0]);
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

  // ── 步骤 1：摆 START / END（START 在左/上边，END 在右/下边，天然不同边）──
  // 保证 START/END 曼哈顿距离足够，否则 growPath 无法绕出 minPathLen 步
  const start = pickStart(rng, w, h);
  if (!start) return null;
  const end = pickEnd(rng, w, h, start, params.minPathLen);
  if (!end) return null;
  grid[start.y][start.x] = { type: CellType.START, dir: Dir.UP };
  grid[end.y][end.x] = { type: CellType.END, dir: Dir.UP };

  // ── 步骤 2：造正解路径 ──
  const path = growPath(start, end, params, rng);
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
  // 逐个放置并验证「放完仍可达」，堵死通路的候选位置直接跳过，
  // 保证放完阻挡块后 START→END 依然可达（任务书步骤 4 的要求）。
  const pathSet = new Set(path);
  const startIdx = idxOf(start.x, start.y, w);
  const protectedCells = new Set<number>([startIdx, ...neighborsOf(startIdx, w, h)]);
  const freeCells: number[] = [];
  for (let i = 0; i < total; i++) {
    if (pathSet.has(i)) continue;
    if (protectedCells.has(i)) continue;
    freeCells.push(i);
  }
  const blockTarget = Math.min(params.blocks, freeCells.length);
  const shuffled = rng.shuffle(freeCells);
  const blocks: number[] = [];
  for (const cellIdx of shuffled) {
    if (blocks.length >= blockTarget) break;
    // 试放：放上去后若 START→END 不可达则回滚，跳过此位置
    grid[yOf(cellIdx, w)][xOf(cellIdx, w)] = { type: CellType.BLOCK, dir: Dir.UP };
    if (solve(grid).solvable) {
      blocks.push(cellIdx);
    } else {
      grid[yOf(cellIdx, w)][xOf(cellIdx, w)] = { type: CellType.BRICK, dir: Dir.UP };
    }
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

/**
 * 生长一条从 start 到 end 的路径，尽量少转弯但满足 minTurns。
 * @returns 格子索引序列（含 start 与 end），失败返回 null
 */
function growPath(
  start: { x: number; y: number }, end: { x: number; y: number },
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

    // 候选方向：排除回退（已访问）；长度/转弯不够时禁止直接进入终点（绕行）
    const needLen = path.length - 1 < params.minPathLen;
    const needTurn = turns < params.minTurns;
    const candidates = DIRS.filter((d) => {
      const nx = cur.x + DX[d], ny = cur.y + DY[d];
      if (!inBounds(nx, ny, w, h)) return false;
      const isEnd = nx === end.x && ny === end.y;
      if (isEnd) {
        // 长度或转弯不达标时不允许进入终点，逼它绕行
        return !needLen && !needTurn;
      }
      const ni = idxOf(nx, ny, w);
      if (used.has(ni)) return false;
      return true;
    });
    if (candidates.length === 0) return null;

    const scored = candidates.map((d) => {
      const nx = cur.x + DX[d], ny = cur.y + DY[d];
      const distToEnd = Math.abs(nx - end.x) + Math.abs(ny - end.y);
      const isTurn = lastDir !== null && d !== lastDir;
      // 分数越大越优先
      let score = -distToEnd * 10 + rng.next() * 6;
      if (needTurn && isTurn) score += 14;          // 转弯不够 → 优先转弯
      if (!needTurn && !isTurn) score += 4;          // 转弯够了 → 优先直行（少转弯）
      if (needLen) score += distToEnd * 2;           // 长度不够 → 稍远离终点（绕行）
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
  }
  return null;
}

/**
 * 通过放置阻挡块消除等价最短路径（收窄分叉）。
 * @param grid 会被就地修改
 * @param res 当前的求解结果（含多条最短路径）
 */
function narrowBranches(grid: Cell[][], res: SolveResult, rng: Rng): boolean {
  const w = grid[0].length, h = grid.length;

  // 最多 3 轮收窄
  for (let round = 0; round < 3; round++) {
    if (res.pathCount <= 1) return true;

    // 取第一条路径作为基准，找与其它路径的分叉点
    const p0 = res.paths[0];
    let forkPos = -1;
    for (const other of res.paths.slice(1)) {
      const common = commonPrefixLen(p0, other);
      if (common > forkPos) forkPos = common;
    }
    if (forkPos <= 0 || forkPos >= p0.length - 1) {
      // 分叉点无效 → 退化为在路径中段旁侧放阻挡
      forkPos = Math.max(1, Math.min(p0.length - 2, Math.floor(p0.length / 2)));
    }

    // 在分叉点附近尝试放阻挡，堵掉非主路径分支
    let done = false;
    // 候选：分叉点及其前后若干格，逐个尝试在旁侧放阻挡
    const anchorIdxs: number[] = [];
    for (let i = Math.max(1, forkPos - 1); i <= Math.min(p0.length - 2, forkPos + 1); i++) {
      anchorIdxs.push(i);
    }
    const anchors = rng.shuffle(anchorIdxs);
    for (const ai of anchors) {
      const anchorCell = p0[ai];
      const ax = xOf(anchorCell, w), ay = yOf(anchorCell, w);
      // 主路径上的下一步方向（前进方向）
      const nextCell = p0[ai + 1];
      const fwdDir = dirOfDelta(xOf(nextCell, w) - ax, yOf(nextCell, w) - ay);
      // 其它方向（旁侧）
      const altDirs = rng.shuffle(DIRS.filter((d) => d !== fwdDir));
      for (const d of altDirs) {
        const nx = ax + DX[d], ny = ay + DY[d];
        if (!inBounds(nx, ny, w, h)) continue;
        const ni = idxOf(nx, ny, w);
        const cell = grid[ny][nx];
        if (cell.type === CellType.START || cell.type === CellType.END) continue;
        if (cell.type === CellType.BLOCK) continue;
        if (p0.includes(ni)) continue; // 不能挡主路径
        const backup: Cell = { ...cell };
        grid[ny][nx] = { type: CellType.BLOCK, dir: Dir.UP };
        const check = solve(grid);
        if (check.solvable && check.pathCount < res.pathCount) {
          res = check;
          done = true;
          break;
        }
        grid[ny][nx] = backup; // 回滚
      }
      if (done) break;
    }
    if (!done) return res.pathCount <= 1;
  }
  return res.pathCount <= 1;
}

/**
 * 依据偏差方向微调关卡难度。返回 null 表示无法调整。
 */
function adjust(
  level: GeneratedLevel, rng: Rng, canonical: number[],
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

/** 在左/上边随机取起点。 */
function pickStart(rng: Rng, w: number, h: number): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < w; x++) candidates.push({ x, y: 0 });       // 上边
  for (let y = 1; y < h - 1; y++) candidates.push({ x: 0, y });   // 左边（不含角）
  if (candidates.length === 0) return null;
  return rng.pick(candidates);
}

/**
 * 在右/下边随机取终点，并保证与起点曼哈顿距离 >= minDist（否则 growPath 绕不出足够步数）。
 */
function pickEnd(
  rng: Rng, w: number, h: number,
  start: { x: number; y: number }, minDist: number,
): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < w; x++) candidates.push({ x, y: h - 1 });   // 下边
  for (let y = 1; y < h - 1; y++) candidates.push({ x: w - 1, y }); // 右边（不含角）
  const far = candidates.filter((p) => {
    const d = Math.abs(p.x - start.x) + Math.abs(p.y - start.y);
    return d >= minDist;
  });
  const pool = far.length > 0 ? far : candidates;
  if (pool.length === 0) return null;
  return rng.pick(pool);
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
