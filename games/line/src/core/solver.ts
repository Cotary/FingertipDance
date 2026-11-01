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

const NO_DIR = -1;

/** 状态 key = idx * 4 + dir，dir 为进入方向。 */
const keyOf = (idx: number, dir: number): number => idx * 4 + (dir < 0 ? 0 : dir);

/**
 * 从指定类型出发，找它在网格中的第一个格子索引；找不到返回 -1。
 */
export function findIndexOfType(grid: Cell[][], type: CellType): number {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x].type === type) return idxOf(x, y, grid[y].length);
    }
  }
  return -1;
}

/**
 * 求解：从起点到终点的最短路径。
 * @param grid 二维网格 grid[y][x]
 * @param from 起点坐标，缺省为网格中的 START 格
 * @param maxPaths 最多收集多少条最短路径，用于唯一性判定
 */
export function solve(
  grid: Cell[][],
  from?: { x: number; y: number },
  maxPaths = 8,
): SolveResult {
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
  const dist = new Int32Array(total * 4).fill(-1);
  // 多前驱：parents[k] = 到达状态 k 的所有前驱状态 key 列表（用于枚举多条最短路径）
  const parents: number[][] = new Array(total * 4);
  for (let i = 0; i < parents.length; i++) parents[i] = [];
  // 到达每个状态的最短路径条数（一次 BFS 内 DP 累加）
  const pathCountAt = new Map<number, number>();

  interface QItem { idx: number; enterDir: number }
  const queue: QItem[] = [{ idx: startIdx, enterDir: NO_DIR }];
  const startKey = keyOf(startIdx, NO_DIR);
  dist[startKey] = 0;
  pathCountAt.set(startKey, 1);

  let head = 0;
  let endDist = -1;
  const endKeys: number[] = [];

  while (head < queue.length) {
    const cur = queue[head++];
    const curKey = keyOf(cur.idx, cur.enterDir);
    const curDist = dist[curKey];
    // 已找到终点且当前层超过最短距离时，无需再扩展更远
    if (endDist >= 0 && curDist >= endDist) break;

    const x = xOf(cur.idx, w), y = yOf(cur.idx, w);
    const curCount = pathCountAt.get(curKey) ?? 1;

    for (const d of DIRS) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inBounds(nx, ny, w, h)) continue;
      const nIdx = idxOf(nx, ny, w);
      const cell = grid[ny][nx];
      if (cell.type === CellType.BLOCK) continue;
      // 单向块：进入方向必须等于箭头方向
      if (cell.type === CellType.ONEWAY && cell.dir !== d) continue;

      const nKey = keyOf(nIdx, d);
      const cand = curDist + 1;

      if (dist[nKey] === -1) {
        dist[nKey] = cand;
        parents[nKey].push(curKey);
        pathCountAt.set(nKey, curCount);
        queue.push({ idx: nIdx, enterDir: d });
      } else if (dist[nKey] === cand) {
        // 以相同最短距离再次到达 → 累加等价路径条数 + 记录额外前驱
        parents[nKey].push(curKey);
        const acc = (pathCountAt.get(nKey) ?? 0) + curCount;
        pathCountAt.set(nKey, acc > maxPaths ? maxPaths : acc);
      }

      if (nIdx === endIdx) {
        if (endDist === -1) endDist = cand;
        if (cand === endDist && !endKeys.includes(nKey)) endKeys.push(nKey);
      }
    }
  }

  if (endDist === -1 || endKeys.length === 0) {
    return { solvable: false, steps: -1, paths: [], pathCount: 0, visited: queue.length };
  }

  // 终点各进入方向的路径条数求和 = 总等价解数
  let pathCount = 0;
  for (const k of endKeys) pathCount += pathCountAt.get(k) ?? 0;
  if (pathCount > maxPaths) pathCount = maxPaths;

  // 从所有终点状态 DFS 枚举多条最短路径（去重，最多 maxPaths 条）
  const paths = enumeratePaths(parents, startKey, endKeys, maxPaths);

  return { solvable: true, steps: endDist, paths, pathCount, visited: queue.length };
}

/** 从终点状态沿多前驱 DFS 回溯，枚举最多 limit 条最短路径（去重）。 */
function enumeratePaths(
  parents: number[][],
  startKey: number,
  endKeys: number[],
  limit: number,
): number[][] {
  const paths: number[][] = [];
  const seen = new Set<string>();
  const buf: number[] = [];

  const dfs = (k: number): boolean => {
    buf.push(Math.floor(k / 4));
    if (k === startKey) {
      const p = buf.slice().reverse();
      const sig = p.join(',');
      if (!seen.has(sig)) {
        seen.add(sig);
        paths.push(p);
      }
      buf.pop();
      return paths.length >= limit;
    }
    for (const pk of parents[k]) {
      if (dfs(pk)) { buf.pop(); return true; }
    }
    buf.pop();
    return false;
  };

  for (const ek of endKeys) {
    if (dfs(ek)) break;
  }
  return paths;
}

/** 从终点状态沿单前驱回溯出路径（格子索引序列）。 */
function reconstruct(parent: Int32Array, endKey: number): number[] {
  const path: number[] = [];
  let k = endKey;
  while (k !== -1) {
    path.push(Math.floor(k / 4));
    k = parent[k];
  }
  return path.reverse();
}

/**
 * 校验一条路径是否合法。服务端成绩校验必须使用完全相同的规则。
 * 规则见 02-关卡格式与算法规格.md 第 5.4 节。
 */
export function isPathLegal(grid: Cell[][], path: number[]): boolean {
  if (grid.length === 0) return false;
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

    // 起点/终点不能出现在中间
    if (i > 0 && i < path.length - 1) {
      if (cell.type === CellType.START || cell.type === CellType.END) return false;
    }
    // 阻挡块不可进入
    if (cell.type === CellType.BLOCK) return false;

    if (i > 0) {
      const prev = path[i - 1];
      const px = xOf(prev, w), py = yOf(prev, w);
      const dx = x - px, dy = y - py;
      // 必须 4 邻接
      if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
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
  const w = grid[0]?.length ?? 0;
  if (!w) return [];
  const res = solveFrom(grid, head.x, head.y);
  if (!res || res.path.length === 0) return [];
  // res.path 从 head 开始，返回其后的 steps 个格子
  return res.path.slice(1, 1 + steps);
}

/**
 * 从任意格子求解到终点的最短路径（不考虑起点必须是 START）。
 * 用于提示功能：玩家可能已经走岔，需要从当前线头重新规划。
 */
export function solveFrom(
  grid: Cell[][],
  x: number,
  y: number,
): { path: number[]; steps: number } | null {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  if (!w || !inBounds(x, y, w, h)) return null;
  const endIdx = findIndexOfType(grid, CellType.END);
  if (endIdx < 0) return null;

  const total = w * h;
  const dist = new Int32Array(total * 4).fill(-1);
  const parent = new Int32Array(total * 4).fill(-1);

  const startIdx = idxOf(x, y, w);
  const startKey = keyOf(startIdx, NO_DIR);
  dist[startKey] = 0;
  const queue = [{ idx: startIdx, enterDir: NO_DIR }];
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
