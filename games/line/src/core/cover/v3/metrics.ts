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

/**
 * 解的转弯数（拍平索引序列的方向变化次数）。
 *
 * ## 传送跳跃步
 *
 * 「进入即传送」下，解里**相邻两格可能几何上不相邻** ——
 * 那是传送跳跃（从入口格跳到搭档格）。
 *
 * 跳跃步**不能**用「差值等于 ±w / ±1」来判方向 ——
 * 差值可能是任意值，会掉进「不是 -w / w / -1 就是 +1」的兜底分支，
 * 被误判成「向右」（dir = 3）。那样一来：
 *   - 跳跃前后的方向对比全是噪声；
 *   - 转弯数被严重低估 → 难度分失真。
 *
 * 所以跳跃步用**哨兵方向 4** 标记：它与任何方向都不同，
 * 于是「进入跳跃」和「离开跳跃」各算一次转弯 —— 合理，
 * 因为跳跃前后的走向确实发生了实质变化。
 */
export function countTurns(path: number[], w: number): number {
  let turns = 0;
  let prev = -1;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = Math.abs((b % w) - (a % w));
    const dy = Math.abs(Math.floor(b / w) - Math.floor(a / w));
    let dir: number;
    if (dx + dy === 1) {
      // 几何邻接：按差值定方向
      const d = b - a;
      dir = d === -w ? 0 : d === w ? 1 : d === -1 ? 2 : 3;
    } else {
      // 非邻接 = 传送跳跃：哨兵方向 4（与任何方向都不同）
      dir = 4;
    }
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
  /**
   * 规模归一的下界（可走格数）。
   *
   * `null` = 用默认值 `SIZE_FLOOR`。
   */
  sizeFloor?: number;
  /**
   * 规模归一的上界（可走格数）。
   *
   * `null` = 用默认值 `SIZE_CEIL`。
   */
  sizeCeil?: number;
  /**
   * **世界项**：难度阶梯的位置（0 = 第一世界，1 = 最后世界）。
   *
   * ## 为什么必须显式引入
   *
   * 早期公式只有「规模 × 结构」两段。规模统一之后：
   *   - 规模项对所有关卡恒等（无区分度）；
   *   - 结构项的世界间差异很小（实测各世界结构分几乎一样）。
   * 于是难度分全表塌成 92~100 —— **编排器完全无法排序**，
   * 「难度曲线」这个概念就失效了。
   *
   * 而世界递进本来就有明确内容：**机制逐级叠加 + 起终点逐级钉死**。
   * 这些差异现在被显式编码进这一项。
   *
   * `null` = 关闭（难度只由结构决定）。
   */
  worldTerm?: number;
}

/**
 * 规模归一区间（默认值）。
 *
 * ## 为什么要有「默认值 + 可覆盖」两套
 *
 * 早期这里写死 `10` / `121`（对应 4×4 ~ 11×11 的尺寸阶梯）。
 * 但尺寸是**可调的**（见 `generate.ts` 的 `SIZE_CONFIG`）——
 * 全表统一成 5×6（30 格）之后，写死的区间就完全错位了：
 * 所有关卡的 `sizeNorm` 都挤在 0.16 附近，难度分全表塌成一个值（19~25）。
 *
 * 所以区间必须**跟着实际尺寸走**：由调用方按当前尺寸配置算出来传进来。
 */
export const SIZE_FLOOR = 10;
export const SIZE_CEIL = 121;

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
  //
  // 归一化到 **解数 1~4** 而不是 1~9：
  // 实测 5×6 盘上解数普遍在 1~4 之间（p50 ≈ 2），
  // 用 1~9 归一会把所有关卡的这一项都压在 0.75~0.88 的窄带里，失去区分度。
  const uniqTerm = m.solutionCount > 0 ? clamp01(1 - (m.solutionCount - 1) / 3) : 1;
  // Decision load: turn count.
  //
  // 归一化到 **转弯 6~20**：实测 5×6 盘上转弯数在 10~18 之间，
  // 用 50 归一会把这一项压在 0.2~0.36 的窄带里。
  const turnTerm = clamp01((m.turns - 6) / 14);
  // Topology pressure: long forced corridor ratio.
  // 实测 5×6 盘的走廊占比在 0.05~0.09，归一到 0.15 才有区分度。
  const topologyTerm = clamp01(m.corridorRatio / 0.15);
  // Endpoint pinning: D=0 (both free) is easiest, D=2 (both pinned) is hardest.
  //
  // **这一项以前是缺的** —— 注释里一直写着「端点固定度用 m.deadEnds」，
  // 但 `computeDiff` 根本没用到它。
  // 结果是：钉死起终点只影响**玩法**，对**难度分**毫无贡献。
  // 尺寸统一成 5×6 之后规模项不再有区分度，这一项就成了世界间难度递进的主力。
  const endTerm = clamp01(m.deadEnds / 2);
  // Branch pressure: 分叉越多 → 每一步的选择越多 → 决策负担越大。
  // 实测 5×6 盘上分叉数在 15~22 之间。
  const branchTerm = clamp01((m.branches - 10) / 14);

  const structureTerm = clamp01(
    0.24 * uniqTerm +
    0.19 * turnTerm +
    0.13 * topologyTerm +
    0.13 * endTerm +
    0.09 * branchTerm +
    0.14 * ctx.mechTerm +
    0.08 * ctx.baitTerm
  );

  // 规模缩放：阶梯模式下按面积曲线，统一尺寸时恒为 1。
  const floor = ctx.sizeFloor ?? SIZE_FLOOR;
  const ceil = ctx.sizeCeil ?? SIZE_CEIL;
  const sizeNorm = ceil > floor ? clamp01((m.required - floor) / (ceil - floor)) : 1;
  const sizeScale = Math.pow(sizeNorm, 0.8);

  // 世界项：难度阶梯的位置（0 = 第一世界，1 = 最后世界）。
  const worldTerm = clamp01(ctx.worldTerm ?? 0);

  const diff = 100 * sizeScale * (0.6 * worldTerm + 0.4 * structureTerm);
  return Math.max(0, Math.min(100, Math.round(diff)));
}
