/**
 * cover 模式求解器：在必需格集合上搜索哈密顿路径。
 *
 * 这是 v2（Cover 模式）的算法核心。与 v1 的 `solver.ts`（START→END 最短路 BFS）
 * 完全不同：哈密顿路径是 NP 难，但网格图（度 ≤ 4、规模 ≤ 121）配合三条剪枝后，
 * 实践中回溯很快。
 *
 * 三条剪枝（缺一不可）：
 * 1. **Warnsdorff 启发**：优先访问「剩余未访问邻居最少」的格子（最孤立的先走）。
 * 2. **精确死端剪枝（强制终点 F）**：对未访问格 v 统计剩余未访问邻居数 remCnt。
 *    若 remCnt=0，v 只能从当前格 cur 进入且进去后无路可走 → 只能是路径终点；
 *    若 remCnt=1 且唯一未访问邻居正是 cur，同样只能「cur 进 → 无路」→ 终点。
 *    这两种格构成强制终点集 F：路径的终点只有一个，|F| ≥ 2 即剪；
 *    |F| = 1 且还有其它未访问格 → 进 F 后无路可走、不进 F 就再进不去 → 剪。
 *    **注意**：remCnt=1 且唯一未访问邻居不是 cur 的格子**不是**强制终点——
 *    它可以「从 cur 进入、走向那个未访问邻居」作为中间格（1×4 的 0→1→2→3 里
 *    格 1、3 都是这种），不能剪。
 * 3. **连通性剪枝**：从当前格出发 BFS 走未访问格，覆盖数 ≠ 未访问数 → 剪。
 *
 * 所有剪枝都只依赖「必要条件」，因此 `countHamiltonian`（有界枚举）可以用同一套
 * 剪枝加速而不会漏解——这正是用它估算「解数上界」的安全基础。
 */
import type { Rng } from '../rng';

/** 必需格集合的邻接图。节点编号 0..n-1，与棋盘坐标无关。 */
export interface HamGraph {
  n: number;
  adj: number[][];
}

export interface HamResult {
  /** 格子序列（长度 = n）。 */
  path: number[];
  /** 搜索展开的节点数（诊断用）。 */
  expanded: number;
}

/** 单起点搜索预算（展开步数）。 */
const DFS_BUDGET = 400000;
/** 最多尝试的起点数。 */
const RESTARTS = 10;

/** 判断 v 是否 u 的邻居（小邻接表线性扫即可，deg ≤ 4）。 */
function isNeighbor(adj: number[][], v: number, u: number): boolean {
  const list = adj[v];
  for (let i = 0; i < list.length; i++) if (list[i] === u) return true;
  return false;
}

/** 找 v 的唯一未访问邻居；没有则返回 -1。 */
function onlyUnvisitedNeighbor(adj: number[][], v: number, visited: Uint8Array): number {
  const list = adj[v];
  for (let i = 0; i < list.length; i++) {
    if (!visited[list[i]]) return list[i];
  }
  return -1;
}

/** 从 cur 出发 BFS 走未访问格，返回能到达的未访问格数。 */
function reachableCount(g: HamGraph, cur: number, visited: Uint8Array, unvisited: number): number {
  const { n, adj } = g;
  const seen = new Uint8Array(n);
  const q: number[] = [cur];
  seen[cur] = 1;
  let head = 0;
  let count = 0;
  while (head < q.length) {
    const v = q[head++];
    const list = adj[v];
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (visited[u] || seen[u]) continue;
      seen[u] = 1;
      q.push(u);
      count++;
    }
  }
  return count === unvisited ? unvisited : -1;
}

/**
 * 在图上找一条哈密顿路径。
 * 多起点随机重启；任一尝试超预算则换起点。全部失败返回 null。
 */
export function findHamiltonian(g: HamGraph, rng: Rng, budget = DFS_BUDGET): HamResult | null {
  const { n, adj } = g;
  if (n === 0) return null;
  if (n === 1) return { path: [0], expanded: 0 };

  const visited = new Uint8Array(n);
  const remCnt = new Int32Array(n);
  // 起点优先级：图论死端（度=1）必为路径端点，必须从它出发；
  // 随机起点在「两个死端」的盘上必然失败（终点只能容纳一个死端）。
  const starts = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => adj[a].length - adj[b].length || rng.next() - 0.5,
  );
  const path: number[] = [];

  for (let s = 0; s < starts.length && s < RESTARTS; s++) {
    const start = starts[s];
    visited.fill(0);
    for (let i = 0; i < n; i++) remCnt[i] = adj[i].length;
    visited[start] = 1;
    for (const u of adj[start]) remCnt[u]--;
    path.length = 0;
    path.push(start);

    const res = dfs(g, start, visited, remCnt, rng, budget, path);
    if (res.path) return { path: res.path, expanded: res.expanded };
    budget -= res.expanded;
    if (budget <= 0) break;
  }
  return null;
}

/**
 * 有界枚举：数出最多 `limit` 条哈密顿路径。
 * 返回值达到 limit 表示「至少 limit 条」。用于「解数 ≤2 / 3~8 / >8」三档分类。
 * 剪枝与 findHamiltonian 完全相同（都是必要条件），不会漏解。
 */
export function countHamiltonian(g: HamGraph, limit = 9, budget = 4000000): number {
  const { n, adj } = g;
  if (n === 0) return 0;
  if (n === 1) return 1;

  const visited = new Uint8Array(n);
  const remCnt = new Int32Array(n);
  const path: number[] = [];
  let count = 0;

  // 枚举必须遍历所有起点（路径起终点自由），死端优先（死端必为端点，先枚举剪枝更快）
  const starts = Array.from({ length: n }, (_, i) => i).sort((a, b) => adj[a].length - adj[b].length);
  for (const start of starts) {
    if (count >= limit) break;
    visited.fill(0);
    for (let i = 0; i < n; i++) remCnt[i] = adj[i].length;
    visited[start] = 1;
    for (const u of adj[start]) remCnt[u]--;
    path.length = 0;
    path.push(start);
    budget = enumDfs(
      g, start, visited, remCnt, budget, path,
      () => { count++; return count >= limit; },
    ).budget;
    if (count >= limit || budget <= 0) break;
  }
  return count;
}

/** 递归回溯：onFound 返回 true 表示「已够，停止枚举」。返回剩余预算与停止标志。 */
function enumDfs(
  g: HamGraph,
  cur: number,
  visited: Uint8Array,
  remCnt: Int32Array,
  budget: number,
  path: number[],
  onFound: () => boolean,
): { budget: number; stop: boolean } {
  const { n, adj } = g;
  const unvisited = n - path.length;
  if (unvisited === 0) {
    return { budget, stop: onFound() };
  }
  if (budget <= 0) return { budget, stop: false };

  // ---- 死端剪枝（强制终点集 F + 图论死端计数 UD，与 find 版同一规则）----
  let F = 0;
  let UD = 0;
  let single = -1;
  for (let v = 0; v < n; v++) {
    if (visited[v]) continue;
    if (adj[v].length === 1) UD++;
    single = v;
    const c = remCnt[v];
    if (c === 0) {
      if (!isNeighbor(adj, v, cur)) return { budget, stop: false };
      F++;
    } else if (c === 1) {
      if (onlyUnvisitedNeighbor(adj, v, visited) === cur) F++;
    }
  }
  if (unvisited === 1) {
    if (!isNeighbor(adj, single, cur)) return { budget, stop: false };
    visited[single] = 1;
    path.push(single);
    const stop = onFound();
    path.pop();
    visited[single] = 0;
    return { budget, stop };
  }
  if (F >= 2 || F === 1) return { budget, stop: false };
  if (UD >= 2) return { budget, stop: false };

  // ---- 连通性剪枝 ----
  if (reachableCount(g, cur, visited, unvisited) < 0) return { budget, stop: false };

  // ---- 枚举：遍历全部候选（排序只影响顺序，不影响完整性）----
  const cand: number[] = [];
  for (const u of adj[cur]) if (!visited[u]) cand.push(u);
  cand.sort((a, b) => {
    const da = adj[a].length === 1 ? 1 : 0;
    const db = adj[b].length === 1 ? 1 : 0;
    return da - db || remCnt[a] - remCnt[b];
  });

  for (const u of cand) {
    if (budget <= 0) break;
    visited[u] = 1;
    for (const w of adj[u]) remCnt[w]--;
    path.push(u);
    const res = enumDfs(g, u, visited, remCnt, budget, path, onFound);
    budget = res.budget;
    path.pop();
    for (const w of adj[u]) remCnt[w]++;
    visited[u] = 0;
    if (res.stop) return { budget, stop: true };
  }
  return { budget, stop: false };
}

/** 带随机 tie-break 的 Warnsdorff 候选排序（找解模式用，保证多次生成结果多样）。 */
function dfs(
  g: HamGraph,
  cur: number,
  visited: Uint8Array,
  remCnt: Int32Array,
  rng: Rng,
  budget: number,
  path: number[],
): { path: number[] | null; expanded: number } {
  const { n, adj } = g;
  const unvisited = n - path.length;
  if (unvisited === 0) return { path: path.slice(), expanded: 1 };
  if (budget <= 0) return { path: null, expanded: 0 };

  // ---- 死端剪枝（强制终点集 F + 图论死端计数 UD）----
  let F = 0;
  let UD = 0;
  let single = -1;
  for (let v = 0; v < n; v++) {
    if (visited[v]) continue;
    if (adj[v].length === 1) UD++;
    single = v;
    const c = remCnt[v];
    if (c === 0) {
      if (!isNeighbor(adj, v, cur)) return { path: null, expanded: 1 };
      F++;
    } else if (c === 1) {
      if (onlyUnvisitedNeighbor(adj, v, visited) === cur) F++;
    }
  }
  if (unvisited === 1) {
    if (!isNeighbor(adj, single, cur)) return { path: null, expanded: 1 };
    path.push(single);
    return { path: path.slice(), expanded: 1 };
  }
  if (F >= 2) return { path: null, expanded: 1 };
  if (F === 1) return { path: null, expanded: 1 };
  // 图论死端必为路径端点：路径只剩一个终点位置，两个未访问死端无解
  if (UD >= 2) return { path: null, expanded: 1 };

  // ---- 连通性剪枝 ----
  if (reachableCount(g, cur, visited, unvisited) < 0) return { path: null, expanded: 1 };

  // ---- Warnsdorff + 噪声 tie-break ----
  // 图论死端（度=1）必为路径端点：另一个死端要留到最后一格，别急着进。
  // remCnt 主序上叠加幅度 2.5 的噪声（大于 remCnt 步长 1）：相邻档偶尔交换，
  // 路径形态才多样化 —— 纯确定性 Warnsdorff 会让满矩形的解全部趋同成蛇形，
  // 1000 关的布局指纹会大量重复。
  const cand: Array<{ u: number; k: number }> = [];
  for (const u of adj[cur]) if (!visited[u]) cand.push({ u, k: rng.next() });
  cand.sort((a, b) => {
    const da = adj[a.u].length === 1 ? 1 : 0;
    const db = adj[b.u].length === 1 ? 1 : 0;
    if (da !== db) return da - db;
    const ka = remCnt[a.u] + a.k * 2.5;
    const kb = remCnt[b.u] + b.k * 2.5;
    return ka - kb;
  });

  let expanded = 1;
  for (const c of cand) {
    const u = c.u;
    visited[u] = 1;
    for (const w of adj[u]) remCnt[w]--;
    path.push(u);
    const res = dfs(g, u, visited, remCnt, rng, budget - expanded, path);
    expanded += res.expanded;
    if (res.path) return { path: res.path, expanded };
    path.pop();
    for (const w of adj[u]) remCnt[w]++;
    visited[u] = 0;
    if (expanded >= budget) break;
  }
  return { path: null, expanded };
}
