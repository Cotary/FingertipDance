/**
 * Cover 模式 v3：度量与难度评分。
 *
 * 核心原则（v2 的教训）：**难度来自拓扑结构与机制，不来自规模**。
 * 121 格的蛇形盘比 49 格的迷宫更容易 —— 玩家只在转弯、分叉、隘口处决策。
 *
 * 删掉的项（v1/v2 的实测教训）：
 *   - `blocks`（障碍数）：方向是反的，障碍越多玩家反而越好找路。
 *   - `branches`（分叉数）：与规模双重计数；且哈密顿谜题里分叉多往往更好找路。
 *   - `deadEnds` 连续项：改为按世界门控的 `endTerm`。
 *
 * ## 难度分的两段式结构
 *
 * ```
 * diff = raw * sizeScale * 100
 * ```
 *
 * - **raw**（0..1）：这盘「本身有多难」
 *   - 唯一性 U：解数越少越难（核心）
 *   - 决策负担：转弯数
 *   - 拓扑压力：强制走廊占比
 *   - 机制项 / 诱饵项 / 端点固定度
 * - **sizeScale**（0.5..1.0）：按规模缩放。
 *   12 格的小盘即使只有一个解，也只是「一眼看完」的小题；
 *   121 格的唯一解才是真正的硬骨头。
 *   没有这一项，早期世界的难度分会全部顶到 40+，根本压不进目标区间。
 */
import type { RuleSet } from './rules';
import { CoverCell } from './types';

/** 度量结果（全部是「量出来的事实」，不是目标）。 */
export interface Metrics {
  /** 可走格数。 */
  required: number;
  /** 解的转弯数（决策负担的主指标）。 */
  turns: number;
  /** 死端数（= D：起终点自由度）。 */
  deadEnds: number;
  /** 分叉数（deg >= 3）。 */
  branches: number;
  /** 最长的 deg=2 长链长度（强制走廊 / 隘口）。 */
  longestCorridor: number;
  /** 最长走廊占可走格的比例。 */
  corridorRatio: number;
  /** 诱饵数量（走进去就走不通的分支）。 */
  baits: number;
  /** 最大诱饵深度（走进去多少步才发现走不通）。 */
  maxBaitDepth: number;
  /** 机制格数量。 */
  mechCount: number;
  /** 机制种类数。 */
  mechKinds: number;
  /** 解数（分档计数，上界 9）。 */
  solutionCount: number;
}

/** 解的转弯数（拍平索引序列的方向变化次数）。 */
export function countTurns(path: number[], w: number): number {
  let turns = 0;
  let prev = -1;
  for (let i = 1; i < path.length; i++) {
    const d = path[i] - path[i - 1];
    const dir = d === -w ? 0 : d === w ? 1 : d === -1 ? 2 : 3;
    if (prev !== -1 && dir !== prev) turns++;
    prev = dir;
  }
  return turns;
}

/**
 * 最长的 deg=2 长链长度。
 * deg=2 的格构成「必须连续通过」的强制走廊 —— cover 模式下唯一性的主力构造。
 * 注意：只看度=2 的连续段（deg=2 的格连成的链），度 >=3 的格打断链。
 */
export function longestCorridor(rs: RuleSet): number {
  const n = rs.n;
  const deg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < 4; k++) if (rs.nbr[i * 4 + k] >= 0) d++;
    deg[i] = d;
  }
  let best = 0;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (deg[i] !== 2 || seen[i]) continue;
    // 沿链向两侧延伸
    let len = 1;
    seen[i] = 1;
    for (const dir of [0, 1]) {
      let cur = i;
      let prev = -1;
      for (;;) {
        const nb = rs.nbr[cur * 4 + dir];
        if (nb < 0 || deg[nb] !== 2 || seen[nb]) break;
        if (nb === prev) break;
        const back = rs.nbr[cur * 4 + (dir ^ 1)];
        if (back === nb) break;
        seen[nb] = 1;
        len++;
        prev = cur;
        cur = nb;
      }
    }
    if (len > best) best = len;
  }
  return best;
}

/**
 * 诱饵分析。
 *
 * 判定：对每个 deg >= 3 的格 v 的每个邻居 d，模拟「先走 v->d」，
 * 检查此后剩余图**是否还存在哈密顿路径**（用与求解器同源的必要条件判定，
 * 不做完整搜索 —— 必要条件全通过时才算「不是诱饵」，宁可漏判不可误判）。
 *
 * 深度 = 沿该分支实际能走的步数（直到该分支变成无叉链或走不通）。
 */
export function analyzeBaits(rs: RuleSet): { baits: number; maxDepth: number } {
  const n = rs.n;
  let baits = 0;
  let maxDepth = 0;

  for (let v = 0; v < n; v++) {
    let deg = 0;
    for (let k = 0; k < 4; k++) if (rs.nbr[v * 4 + k] >= 0) deg++;
    if (deg < 3) continue;

    for (let d = 0; d < 4; d++) {
      const u = rs.nbr[v * 4 + d];
      if (u < 0) continue;

      // 模拟：先走 v->d，之后从 d 出发还能走多远
      const visited = new Uint8Array(n);
      visited[v] = 1;
      visited[u] = 1;
      const depth = walkBranch(rs, visited, u, v);

      // 剩余格（不含 v,u）+ 当前头 u 是否还可能走完
      const remaining = n - 2;
      if (remaining <= 0) continue;
      // 必要条件：剩余格奇偶平衡
      let black = 0;
      let white = 0;
      for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        const c = rs.flatOf[i];
        if (((c % rs.w) + Math.floor(c / rs.w)) % 2 === 0) black++;
        else white++;
      }
      if (Math.abs(black - white) > 1) {
        baits++;
        maxDepth = Math.max(maxDepth, depth);
        continue;
      }
      // 必要条件：剩余格连通（不含 v,u）
      if (!connectedExcept(rs, visited)) {
        baits++;
        maxDepth = Math.max(maxDepth, depth);
      }
    }
  }
  return { baits, maxDepth };
}

/** 沿分支走到底，返回步数（走到无路可走或形成环为止）。 */
function walkBranch(rs: RuleSet, visited: Uint8Array, from: number, blocked: number): number {
  const n = rs.n;
  const seen = visited.slice();
  let cur = from;
  let prev = blocked;
  let depth = 0;
  for (;;) {
    const cands: number[] = [];
    for (let d = 0; d < 4; d++) {
      const u = rs.nbr[cur * 4 + d];
      if (u >= 0 && u !== prev && !seen[u]) cands.push(u);
    }
    if (cands.length === 0) break;
    // 分叉处停止（深度只在无叉链上可算）
    if (cands.length > 1) break;
    const next = cands[0];
    seen[next] = 1;
    prev = cur;
    cur = next;
    depth++;
    if (depth > n) break;
  }
  return depth;
}

/** 剩余格（不在 visited 中）是否连通。 */
function connectedExcept(rs: RuleSet, visited: Uint8Array): boolean {
  let start = -1;
  let total = 0;
  for (let i = 0; i < rs.n; i++) {
    if (visited[i]) continue;
    total++;
    if (start < 0) start = i;
  }
  if (total === 0) return true;
  const seen = new Uint8Array(rs.n);
  const q: number[] = [start];
  seen[start] = 1;
  let head = 0;
  let count = 0;
  while (head < q.length) {
    const v = q[head++];
    count++;
    for (let d = 0; d < 4; d++) {
      const u = rs.nbr[v * 4 + d];
      if (u < 0 || visited[u] || seen[u]) continue;
      seen[u] = 1;
      q.push(u);
    }
  }
  return count === total;
}

/** 统计度量（不含解数 —— 解数需要额外枚举，成本较高，由调用方按需填）。 */
export function measure(rs: RuleSet, path: number[]): Metrics {
  const n = rs.n;
  let deadEnds = 0;
  let branches = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let k = 0; k < 4; k++) if (rs.nbr[i * 4 + k] >= 0) d++;
    if (d <= 1) deadEnds++;
    else if (d >= 3) branches++;
  }
  const corridor = longestCorridor(rs);
  const baits = analyzeBaits(rs);
  const mechKindsSet = new Set<number>();
  let mechCount = 0;
  for (let i = 0; i < n; i++) {
    const t = rs.typeOf[i];
    if (t === CoverCell.ONEWAY || t === CoverCell.SHARD || t === CoverCell.KEY ||
        t === CoverCell.GATE || t === CoverCell.PORTAL || t === CoverCell.ICE) {
      mechKindsSet.add(t);
      mechCount++;
    }
  }
  return {
    required: n,
    turns: countTurns(path.map((i) => rs.flatOf[i]), rs.w),
    deadEnds,
    branches,
    longestCorridor: corridor,
    corridorRatio: n > 0 ? corridor / n : 0,
    baits: baits.baits,
    maxBaitDepth: baits.maxDepth,
    mechCount,
    mechKinds: mechKindsSet.size,
    solutionCount: 0,
  };
}

/** 世界参数（难度门控用）。 */
export interface DiffContext {
  /** 机制项归一（0 = 本世界无机制）。 */
  mechTerm: number;
  /** 诱饵项归一。 */
  baitTerm: number;
}

/**
 * 规模归一区间。
 *
 * 下界取 10（4x4=16 格的实际起步规模），上界取 121（11x11）。
 */
const SIZE_FLOOR = 10;
const SIZE_CEIL = 121;

/**
 * 难度分 0..100。
 *
 * 权重为先验值，第一次全量生成后必须用实测回填。
 *
 * 端点固定度用 **m.deadEnds**（可逐关度量），不用世界常量 —— 这样同一世界内
 * D=1 与 D=2 的关卡能被区分开。世界常量只用于机制项与诱饵项的归一。
 */
/**
 * Difficulty score, 0..100.
 *
 * ## Structure: size baseline x structure multiplier
 *
 * ```
 * diff = 100 * sizeBaseline(required) * (0.60 + 0.55 * structureTerm)
 * ```
 *
 * ### sizeBaseline: the "how big is this board" curve
 *
 * This is the PRIMARY difficulty driver across worlds. A 4x4 board and a
 * 11x11 board differ far more in difficulty than their topology does.
 *
 * The curve is calibrated against measured levels (see the calibration
 * script) so that the world midpoint lands on the world target range:
 *
 * | cells | sizeBaseline | diff baseline | world target |
 * |-------|-------------|---------------|--------------|
 * |   16  |     0.111   |      11       |   8 - 14    |
 * |   34  |     0.334   |      33       |  24 - 36    |
 * |   48  |     0.489   |      49       |  36 - 48    |
 * |   60  |     0.610   |      61       |  48 - 60    |
 * |   71  |     0.710   |      71       |  60 - 72    |
 * |   87  |     0.861   |      86       |  72 - 86    |
 *
 * The exponent 0.8 shapes the curve: without it, small boards would score
 * far too high (a 12-cell board is "one glance" easy) and large boards
 * would score too low.
 *
 * ### structureTerm: the "how tricky is this board" factor
 *
 * The multiplier ranges 0.60..1.15, so topology can push a level up or down
 * by roughly +-25% around its size baseline. Within a single world the
 * board size barely changes, so structureTerm is what actually separates
 * one level of that world from another -- it is what the orchestrator sorts
 * on.
 *
 *   - uniqueness (solution count): the core signal. Fewer solutions = harder.
 *   - decision load (turns): how many direction changes the player must make.
   - mechanics: world-configured (one-way doors, shards, keys, portals, ice).
 *   - baits: branches that look walkable but lead nowhere.
 */
export function computeDiff(m: Metrics, ctx: DiffContext): number {
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Uniqueness: fewer solutions = harder (core signal).
  const uniqTerm = m.solutionCount > 0 ? clamp01(1 - (m.solutionCount - 1) / 8) : 1;
  // Decision load: turn count. Normalize at 50 (measured max is around 62).
  const turnTerm = clamp01(m.turns / 50);
  // Topology pressure: long forced corridor ratio.
  const topologyTerm = clamp01(m.corridorRatio / 0.35);

  const structureTerm = clamp01(
    0.35 * uniqTerm +
    0.30 * turnTerm +
    0.15 * topologyTerm +
    0.12 * ctx.mechTerm +
    0.08 * ctx.baitTerm
  );

  // Size baseline curve (calibrated).
  const sizeNorm = clamp01((m.required - SIZE_FLOOR) / (SIZE_CEIL - SIZE_FLOOR));
  const sizeBaseline = Math.pow(sizeNorm, 0.8) * 1.15;

  const diff = 100 * sizeBaseline * (0.6 + 0.55 * structureTerm);
  return Math.max(0, Math.min(100, Math.round(diff)));
}
