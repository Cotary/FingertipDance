/**
 * Cover v3：传送门放置器（2-opt 拼接）。
 *
 * ## 为什么需要它
 *
 * 传送语义是「**进入即传送**」：走进传送格 `A` 的一步会一次吃掉 `[A, B]`
 * （`B` 是 `A` 的搭档），线头落在 `B`。
 *
 * 这意味着「传送门摆在解路径中间、被物理踩过去」的老做法**必然失效** ——
 * 夹在中间的那些格永远进不去，参考解必然回放失败。
 *
 * 所以顺序必须反过来：**先造一条「带跳跃的解」，再把传送门放到跳跃的两端**。
 *
 * ## 2-opt 拼接
 *
 * 设基础哈密顿路径 $P = [p_0, \dots, p_{n-1}]$。找 $(i, j)$ 满足：
 *
 *  1. $1 \le i < j \le n-2$（两端不能当传送门 ——
 *     它们会被 START / END 标记覆盖，机制会凭空消失）；
 *  2. $p_{i+1}$ 与 $p_{j+1}$ **四邻接**（拼接后这一步必须仍是合法邻接步）；
 *  3. $p_i$ 与 $p_j$ **非邻接**（这一步就是传送跳跃）；
 *  4. $(j - i)$ 为**奇数**。
 *
 * 拼接结果：
 *
 * $$P' = [p_0, \dots, p_i,\ \ p_j,\ p_{j-1}, \dots, p_{i+1},\ \ p_{j+1}, \dots, p_{n-1}]$$
 *
 * 长度严格为 $n$（每格恰好出现一次）。
 * **传送门放在 $p_i$ 与 $p_j$**，互为搭档。
 *
 * ## 为什么条件 4（奇数）必须成立
 *
 * 棋盘是二分图（黑白相间），颜色沿路径交替。
 * $p_i$ 与 $p_j$ 在原路径上相隔 $j - i$ 步，所以两者**同色 ⟺ $j-i$ 为偶数**。
 *
 * 取奇数时 $p_i$ 与 $p_j$ **异色** —— 于是 $P'$ 的每一步
 * （无论邻接步还是跳跃步）都连接异色格，**整条路径保持二分交替**。
 *
 * 这保证了 `solver.ts` 里的 `parityOk` 剪枝**依然完全正确**：
 * 既不会误剪（剪掉有解的分支），也不会漏解。
 *
 * ## 为什么这与「进入即传送」完美契合
 *
 * 拼接后 $p_i$ 与 $p_j$ 在路径上**相邻**（位置 $i$ 与 $i+1$）。
 * 玩家从 $p_{i-1}$ 走进 $p_i$（几何邻接，合法），
 * 而规则里「走进传送格」这一步吃的正好是
 * `[p_i, portalOf[p_i]] = [p_i, p_j]` ——
 * 与路径序列**逐位对齐**，`replay` 直接通过，不需要任何额外规则。
 *
 * 拼接**保持两端不变**（$p_0$ 与 $p_{n-1}$ 原样保留），
 * 所以钉死的起终点约束不受影响。
 *
 * ## 多对传送门
 *
 * 多对时**依次拼接**：每次在**当前**路径上找一对可行的 $(i, j)$。
 * 被反转的区段内部边只是方向反过来，仍然合法；
 * 但**不能拆掉已有的跳跃边** —— 那会让传送格留在路径之外，
 * 玩家踩上去就「该传不传」，参考解当场失效。
 * 所以候选里必须排除已经是跳跃边的位置。
 */
import type { Rng } from '../../rng';
import type { RuleSet } from './rules';

/** 一对传送门。 */
export interface PortalPair {
  /** 入口格（局部编号）—— 路径上它在出口前面一步。 */
  entry: number;
  /** 出口格（局部编号）。 */
  exit: number;
}

/** 拼接结果。 */
export interface PortalSpliceResult {
  /** 拼接后的路径（局部编号序列）。 */
  path: number[];
  /** 传送门对（按生成顺序）。 */
  portals: PortalPair[];
}

/**
 * 传送门对数上限。
 *
 * `group` 字段只有 2 bit（0..3），而且**同一 group 里必须恰好两格**
 * —— `buildRuleSet` 是按 group 两两配对的，多于两格会配错。
 */
export const MAX_PORTAL_PAIRS = 4;

/** 两个局部编号是否四邻接。 */
function adjacent(rs: RuleSet, a: number, b: number): boolean {
  for (let d = 0; d < 4; d++) {
    if (rs.nbr[a * 4 + d] === b) return true;
  }
  return false;
}

/**
 * 拼接出「路径中间带传送跳跃」的路径。
 *
 * @param rs       规则集（只用到 `nbr` 做邻接判定）
 * @param path     基础哈密顿路径（局部编号序列）
 * @param rng      随机源（决定在多个可行对里选哪一个 —— 保证确定性）
 * @param pairs    需要的传送门对数
 * @returns 拼接结果；找不到可行对时返回 null
 */
export function splicePortals(
  rs: RuleSet,
  path: number[],
  rng: Rng,
  pairs: number,
): PortalSpliceResult | null {
  if (pairs <= 0) return { path: path.slice(), portals: [] };
  const want = Math.min(pairs, MAX_PORTAL_PAIRS);
  return tryBuild(rs, path, rng, want);
}

/** 构造一次多对拼接（不校验）。 */
function tryBuild(
  rs: RuleSet,
  path: number[],
  rng: Rng,
  want: number,
): PortalSpliceResult | null {
  let cur = path.slice();
  /**
   * **跳跃边的步序号**：`jumpEdges` 里的 $k$ 表示
   * `cur[k]` 与 `cur[k+1]` 在几何上**不相邻**（那一步是传送跳跃）。
   */
  let jumpEdges = new Set<number>();
  const portals: PortalPair[] = [];

  for (let t = 0; t < want; t++) {
    const n = cur.length;
    if (n < 4) return null;

    /** 所有可行的 $(i, j)$。 */
    const candidates: Array<[number, number]> = [];
    for (let i = 1; i < n - 2; i++) {
      // 不能拆掉已有的跳跃边（那会让传送格掉出路径）。
      if (jumpEdges.has(i)) continue;
      for (let j = i + 1; j < n - 1; j++) {
        if (jumpEdges.has(j)) continue;
        // 奇偶：保证整条路径保持二分交替（见文件头说明）。
        if ((j - i) % 2 === 0) continue;
        // 新边 (i+1, j+1) 必须四邻接。
        if (!adjacent(rs, cur[i + 1], cur[j + 1])) continue;
        // 新边 (i, j) 必须非邻接 —— 它就是传送跳跃。
        if (adjacent(rs, cur[i], cur[j])) continue;
        candidates.push([i, j]);
      }
    }
    if (candidates.length === 0) return null;

    const [i, j] = rng.pick(candidates);

    // 拼接：前段（含 cur[i]）+ 反转段（cur[j] .. cur[i+1]）+ 后段（cur[j+1] 起）
    const next = cur
      .slice(0, i + 1)
      .concat(cur.slice(i + 1, j + 1).reverse(), cur.slice(j + 1));

    /**
     * **跳跃边重映射**。
     *
     * 反转区段内部：旧边 $k$（在 $i < k < j$）落到新位置 $i + j - k$。
     * 区段外：位置不变。
     * 旧边 $i$ 与 $j$ 都被拆掉（$i$ 被新跳跃取代，$j$ 变成邻接边）。
     */
    const nextJumps = new Set<number>();
    for (const k of jumpEdges) {
      if (k === i || k === j) continue;
      nextJumps.add(k < i || k > j ? k : i + j - k);
    }
    // 新跳跃边：cur[i] → cur[j]，落在新路径的位置 i。
    nextJumps.add(i);

    portals.push({ entry: cur[i], exit: cur[j] });
    cur = next;
    jumpEdges = nextJumps;
  }

  return { path: cur, portals };
}
