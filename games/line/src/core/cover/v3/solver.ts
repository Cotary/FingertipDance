/**
 * Cover v3 的求解器：找一条覆盖全部可走格的哈密顿路径。
 *
 * 「覆盖全部可走格」是本游戏唯一不可动摇的核心规则，
 * 所以这一层是整个游戏的地基 —— 生成器、客户端提示、服务端校验
 * 都必须跑出**同一种判定**，否则会出现「生成时认为有解、玩家却走不出来」。
 *
 * ## 剪枝
 *
 * 四条剪枝，目标是让 9x9 盘的搜索量降一个数量级：
 *
 * 1. **奇偶剪枝（F）**：剩余格的黑白数差必须 <= 1。
 *    哈密顿路径交替经过黑白格，所以剩余段必须黑白交替。
 * 2. **死端剪枝（UD）**：未访问格中「度数 <= 1」的格最多只能有 1 个。
 *    哈密顿路径只有两个端点，其中至少一个已经被路径起点占了。
 * 3. **连通性剪枝**：剩余格必须从当前线头可达。
 *    棋盘上有零散洞时，这条剪枝的贡献极大 —— 没有它 8x8 以上就会指数爆炸。
 * 4. **端点预算**：强制端点的数量不能超过剩余的端点名额（总共只有 2 个）。
 *
 * ## 为什么全程用「纯网格模式」
 *
 * 冰块滑行会让「一次移动消耗多格」、传送门会加额外边 ——
 * 这两者都会让「格级度数」不再等于「移动图度数」，
 * 于是 F/UD 剪枝失效，9x9 盘的求解退化成指数级。
 *
 * 但注意：**参考解完全不需要用冰块和传送门** ——
 * 机制是「加在已验证存在的解上」的，参考解走的就是普通四邻接路径。
 * 所以「纯网格模式」下找到的路径，**在完整规则下同样合法**。
 *
 * 于是求解可以**全程用纯网格模式**：
 *   - 剪枝永远有效 -> 快；
 *   - 找到的路径在完整规则下依然合法 -> 正确。
 */
/**
 * Cover v3 的求解器入口：给规则集找一条哈密顿路径。
 */
import type { Rng } from '../../rng';
import { CoverCell } from './types';
import { applyMove, candidateMoves, shardAllows, withPlain, withNoPortal, type RuleSet } from './rules';

/** 求解结果。 */
export interface SolveResult {
  /** 找到的路径（局部编号序列）；无解时为 null。 */
  path: number[] | null;
  /** 展开的搜索节点数。 */
  expanded: number;
  /** 是否因为预算耗尽而中止（区别于「证明无解」）。 */
  exhausted: boolean;
}

/** 搜索状态。 */
export interface SearchState {
  rs: RuleSet;
  /** 随机源（给 Warnsdorff 打散用）。 */
  rng: Rng;
  visited: Uint8Array;
  keyMask: number;
  shardNext: number;
  path: number[];
  expanded: number;
  /**
   * 已经覆盖掉的**目标格**数量。
   *
   * 与 `path.length` 的区别：`preVisited` 场景下，路径的起点是玩家
   * 已经走过的格（不算目标），所以目标数 ≠ 路径长度。
   */
  coveredTargets: number;
}

/** 剩余格的黑白数差是否 <= 1（奇偶剪枝）。 */
export function parityOk(rs: RuleSet, visited: Uint8Array): boolean {
  let black = 0;
  let white = 0;
  for (let i = 0; i < rs.n; i++) {
    if (visited[i]) continue;
    const c = rs.flatOf[i];
    if (((c % rs.w) + Math.floor(c / rs.w)) % 2 === 0) black++;
    else white++;
  }
  return Math.abs(black - white) <= 1;
}

/**
 * 连通性剪枝：剩余格是否都能从当前线头走到。
 *
 * 这条剪枝对「零散洞」的盘面贡献极大 ——
 * 没有它，8x8 以上的搜索会指数爆炸。
 *
 * **传送门边**：只有在「传送边真的在用」时（完整规则模式且盘上有传送门）
 * 才需要把传送门搭档也算进可达集合。否则会把「只能靠传送到达」的格误判为不可达。
 *
 * 注意「剩余格」= **未访问**的格总数，内部自己算 ——
 * 提示场景下 `visited` 里预置了玩家走过的那些格，
 * 它们是障碍不是目标，所以可达格数要跟「未访问格总数」比，
 * 而不是跟「剩余目标数」比。
 */
export function reachableAll(
  rs: RuleSet,
  visited: Uint8Array,
  cur: number,
): boolean {
  // Always check connectivity: boards with scattered holes rely on this pruning
  // heavily -- without it the search explodes on 8x8 and larger.
  const seen = new Uint8Array(rs.n);
  const q: number[] = [cur];
  seen[cur] = 1;
  let head = 0;
  let count = 0;
  let total = 0;
  const portalEdges = !rs.plain && !rs.noPortal && rs.hasPortal;
  while (head < q.length) {
    const v = q[head++];
    for (let d = 0; d < 4; d++) {
      const u = rs.nbr[v * 4 + d];
      if (u < 0 || visited[u] || seen[u]) continue;
      seen[u] = 1;
      q.push(u);
      count++;
    }
    if (portalEdges) {
      const p = rs.portalOf[v];
      if (p >= 0 && !visited[p] && !seen[p]) {
        seen[p] = 1;
        q.push(p);
        count++;
      }
    }
  }
  for (let v = 0; v < rs.n; v++) if (!visited[v]) total++;
  return count === total;
}

/**
 * 强制端点计数（F 剪枝）。
 *
 * remCnt 是「该格的未访问邻居数」，分两种情况：
 *   remCnt = 0：它已经无路可走，只能是路径的终点，且必须现在就走过去；
 *   remCnt = 1：它唯一的未访问邻居就是当前线头，走进去就必然收尾。
 */
export function forcedEndCount(
  rs: RuleSet,
  visited: Uint8Array,
  cur: number,
  excludeLocal = -1,
): number {
  // A cell v is forced to be a path endpoint for two independent reasons:
  //   (a) TRAPPED: rem == 0 (no unvisited neighbor), or rem == 1 whose only
  //       unvisited neighbor is the current head. The path can only enter v
  //       from the head, and once inside there is nothing left -> v is LAST.
  //       If v is not even adjacent to the head it is UNREACHABLE -> fail.
  //   (b) GRAPH DEAD END: deg == 1. The path must use the single edge (w,v),
  //       so v is an endpoint (either it starts there or the path stops there).
  //
  // The set is DEDUPLICATED: a cell can satisfy both (a) and (b), and counting
  // it twice would wrongly consume two endpoint slots.
  const forced = new Set<number>();
  // 传送门搭档格不能算「强制端点」——
  // 它可以通过传送边成为路径的内部点（进 A 出 B 后继续走）。
  const portalEdges = !rs.plain && !rs.noPortal && rs.hasPortal;
  for (let v = 0; v < rs.n; v++) {
    if (visited[v]) continue;
    if (v === excludeLocal) continue;
    if (portalEdges && rs.portalOf[v] >= 0) continue;
    let rem = 0;
    let only = -1;
    let deg = 0;
    for (let d = 0; d < 4; d++) {
      const u = rs.nbr[v * 4 + d];
      if (u < 0) continue;
      deg++;
      if (!visited[u]) {
        rem++;
        only = u;
      }
    }
    if (deg === 1) forced.add(v);
    if (rem === 0) {
      let isNbr = false;
      for (let d = 0; d < 4; d++) if (rs.nbr[cur * 4 + d] === v) isNbr = true;
      if (!isNbr) return 99; // unreachable -> definitely unsolvable
      forced.add(v);
    } else if (rem === 1 && only === cur) {
      forced.add(v);
    }
  }
  return forced.size;
}

/** 未访问格中的死端数（度数 <= 1）。 */
export function unvisitedDeadEnds(rs: RuleSet, visited: Uint8Array): number {
  let UD = 0;
  for (let v = 0; v < rs.n; v++) {
    if (visited[v]) continue;
    let deg = 0;
    for (let d = 0; d < 4; d++) if (rs.nbr[v * 4 + d] >= 0) deg++;
    if (deg === 1) UD++;
  }
  return UD;
}

/** 某个格在移动图里的度数。 */
export function degOf(rs: RuleSet, v: number): number {
  let d = 0;
  for (let i = 0; i < 4; i++) if (rs.nbr[v * 4 + i] >= 0) d++;
  return d;
}

/** 某个格的未访问邻居数（Warnsdorff 启发式用）。 */
export function unvisitedNeighbors(rs: RuleSet, visited: Uint8Array, v: number): number {
  let k = 0;
  for (let d = 0; d < 4; d++) {
    const u = rs.nbr[v * 4 + d];
    if (u >= 0 && !visited[u]) k++;
  }
  return k;
}

/** 整个盘面的死端数（度数 <= 1 的格）。 */
export function countDeadEnds(rs: RuleSet): number {
  let ud = 0;
  for (let i = 0; i < rs.n; i++) if (degOf(rs, i) === 1) ud++;
  return ud;
}

/**
 * 确定性的「噪声」项，用来给 Warnsdorff 打散。
 *
 * 幅度刻意压得很小（最多 0.4）：只是打破同分候选的固定顺序，
 * 不改变「优先走邻居少的格」这个主体启发式。
 *
 * 它是**纯函数**（不含 rng），所以同一个盘面在不同随机流下
 * 也会给出相同的候选排序 —— 确定性由此保证。
 */
export function noiseOf(pathLen: number, target: number): number {
  let h = (pathLen * 2654435761) >>> 0;
  h = ((h ^ (target + 0x9e3779b9)) * 16777619) >>> 0;
  return ((h % 1000) / 1000) * 0.4;
}

/** 判断当前状态是否应该被剪掉。 */
export function isPruned(
  st: SearchState,
  cur: number,
  unvisited: number,
  committedEndpoints = 1,
): boolean {
  const { rs, visited } = st;
  if (unvisited === 0) return false;
  if (!parityOk(rs, visited)) return true;
  // ENDPOINT BUDGET (the subtle part): a Hamiltonian path has exactly TWO
  // endpoints. We must count how many endpoint slots are ALREADY spent:
  //   - the path START (once the path has more than one cell, the cell we
  //     started at is committed as an endpoint; a pinned start is committed
  //     from the very beginning);
  //   - a pinned END.
  // Every unvisited cell FORCED to be an endpoint consumes one slot, so
  // forcedEndCount <= slotsLeft must hold.
  //
  // The subtle case is the ROOT of a free-start search: nothing is committed
  // yet (slotsLeft = 2), so a board with exactly two dead ends is fine -- one
  // of them becomes the start and the other the end. Pruning with slotsLeft = 1
  // at the root would kill every such board (this bug made the solution
  // counter report 0 solutions on nearly every board).
  //
  // **冰块滑行不影响这条剪枝**：滑行消耗的每一格都与前一格四邻接，
  // 所以路径始终是一条「格级相邻」的链，格级度数的语义不变。
  //
  // **传送边会让格级度数 ≠ 移动图度数**（有搭档的格可以是路径内部点），
  // 但 `forcedEndCount` 已经把这类格跳过了，所以剪枝依然成立 ——
  // 只是少剪一点（保守），不会误剪。
  {
    const slotsLeft = 2 - committedEndpoints;
    const F = forcedEndCount(rs, visited, cur, rs.endAt);
    if (F > slotsLeft) return true;
  }
  if (!reachableAll(rs, visited, cur)) return true;
  return false;
}


/**
 * 只剩一格时的收尾判定。
 *
 * 这一格必须是当前线头的邻居，且满足全部机制约束
 * （星星编号要对、门要已开钥匙、终点约束要对），否则这条分支直接失败。
 *
 * 实现上直接复用 `candidateMoves` ——
 * 这样单向门的离开方向、冰块滑行、传送边全都自动被尊重，
 * 不会因为「手写判定漏了某条规则」而误判有解。
 */
function canFinish(st: SearchState, cur: number, endAt: number): boolean {
  const { rs, visited } = st;
  let single = -1;
  for (let v = 0; v < rs.n; v++) {
    if (visited[v]) continue;
    single = v;
    break;
  }
  if (single < 0) return false;
  if (endAt >= 0 && single !== endAt) return false;
  const moves = candidateMoves(rs, cur, visited, st.keyMask);
  return moves.some(
    (mv) =>
      mv.consumed.length === 1 &&
      mv.consumed[0] === single &&
      shardAllows(rs, single, st.shardNext),
  );
}

/**
 * 求解入口：返回一条覆盖全部可走格的路径。
 *
 * @param startAt    钉死的起点（局部编号）；-1 = 自由
 * @param budget     步数预算（与硬件无关，是确定性的硬约束）
 * @param deadlineMs 墙钟时限（毫秒）；0 = 不限时
 * @param jitter     打散强度；0 = 确定性
 * @param fullRules  是否按**完整规则**求解（冰块滑行 + 传送边）
 *
 * ## 两种模式的区别
 *
 * - `fullRules = false`（默认，生成器用）：全程按四邻接走，
 *   剪枝永远有效。找到的路径在完整规则下依然合法 ——
 *   机制是「加在已验证存在的解上」的，参考解走的就是普通四邻接路径。
 * - `fullRules = true`（提示用）：按真实玩法走 ——
 *   进冰块会滑行消耗多格，传送门提供额外边。
 *   路径是「格序列」，滑行消耗的格会依次出现在序列里。
 */
/**
 * 求解入口：返回一条覆盖全部可走格的路径。
 *
 * @param startAt    钉死的起点（局部编号）；-1 = 自由
 * @param budget     步数预算（与硬件无关，是确定性的硬约束）
 * @param deadlineMs 墙钟时限（毫秒）；0 = 不限时
 * @param jitter     打散强度；0 = 确定性
 * @param fullRules  是否按**完整规则**求解（冰块滑行 + 传送边）
 * @param initKeyMask 起始钥匙掩码（玩家已经拿到的钥匙）
 * @param initShardNext 起始星星进度（玩家已经过的最大星星编号 + 1）
 * @param preVisited 已经走过的格（局部编号集合）。这些格**不计入覆盖目标**，
 *   但仍然占据棋盘位置（是障碍）。
 * @param noPortal   禁用传送边（冰块滑行仍然生效）。
 *   提示求解用这个模式 —— 见 `RuleSet.noPortal` 的说明。
 *
 * ## 三种模式的区别
 *
 * - `fullRules = false`（默认，生成器用）：全程按四邻接走，
 *   剪枝永远有效。找到的路径在完整规则下依然合法 ——
 *   机制是「加在已验证存在的解上」的，参考解走的就是普通四邻接路径。
 * - `fullRules = true`（完整玩法）：按真实玩法走 ——
 *   进冰块会滑行消耗多格，传送门提供额外边。
 *   路径是「格序列」，滑行消耗的格会依次出现在序列里。
 *
 *   ⚠️ **传送边会毁掉剪枝**：跳跃跳过中间格，黑白交替的前提被破坏，
 *   搜索空间暴增（9x9 盘上纯网格 77 个节点能找到解，完整规则 30 万个还找不到）。
 *   所以提示求解**不要**用这个模式。
 * - `fullRules = true, noPortal = true`（提示求解用这个）：
 *   保留冰块滑行（真实玩法如此），关掉传送边（参考解从不用它）。
 *   路径仍是四邻接链 -> 剪枝有效 -> 毫秒级出解。
 */
export function solve(
  rsIn: RuleSet,
  rng: Rng,
  startAt = -1,
  budget = 200000,
  deadlineMs = 0,
  jitter = 0,
  fullRules = false,
  initKeyMask = 0,
  initShardNext = 0,
  preVisited?: Uint8Array,
  noPortal = false,
  tryReverse = true,
): SolveResult {
  // 纯网格模式：剪枝永远有效，且找到的路径在完整规则下依然合法。
  // 完整规则模式：按真实玩法走（滑行 / 传送），路径是「格序列」。
  const rs = noPortal ? withNoPortal(withPlain(rsIn, !fullRules)) : withPlain(rsIn, !fullRules);
  const n = rs.n;
  if (n === 0) return { path: null, expanded: 0, exhausted: false };
  if (n === 1) {
    if (startAt >= 0 && startAt !== 0) return { path: null, expanded: 0, exhausted: false };
    return { path: [0], expanded: 0, exhausted: false };
  }

  // 死端超过 2 个 → 直接无解（哈密顿路径只有两个端点）。
  //
  // 传送边在用时这条不成立：有搭档的格可以是路径内部点，
  // 所以死端可以超过 2 个。此时交给搜索自己判断。
  //
  // **冰块滑行不影响这条判断**：滑行消耗的每一格都与前一格四邻接，
  // 所以路径始终是一条「格级相邻」的链，度=1 的格必然是路径端点。
  const portalEdges = !rs.plain && !rs.noPortal && rs.hasPortal;
  if (!portalEdges && countDeadEnds(rs) > 2) {
    return { path: null, expanded: 0, exhausted: false };
  }

  const deadline = deadlineMs > 0 ? Date.now() + deadlineMs : 0;
  let totalExpanded = 0;

  /**
   * **预置已访问格**（提示用）。
   *
   * 玩家已经走过的那条线不再是目标，但它们仍然是**障碍**：
   * 不能重复走，也不能穿过去。
   *
   * 关键实现：**不重新编号**，直接在原规则集上标记 `visited`。
   *
   * 为什么不抽子图重编号？因为重编号会改变局部编号，
   * 而 `noiseOf(pathLen, target)` 用局部编号算打散项 ——
   * 同样的盘面重编号后候选排序就变了，
   * 求解器会掉进另一种（可能更差的）搜索顺序，
   * 表现为「明明有解却搜不出来」。
   *
   * 所以提示直接在原盘上搜：预置 visited，把目标数量调成「未预置访问的格数」。
   */
  const pre = preVisited;
  const preCount = pre ? countTrue(pre) : 0;
  // 需要覆盖的目标 = 未预置访问的格
  const targetCount = n - preCount;

  // 起点候选按度数排序：度数低的更可能是路径端点。
  const starts = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => degOf(rs, a) - degOf(rs, b) || rng.next() - 0.5,
  );
  /**
   * 起点候选。
   *
   * **关键优化（性能）**：自由起点（startAt=-1）时，起点**只能是死端**
   * —— 哈密顿路径的端点里，若某格度=1，它必然是端点。
   * 所以自由起点只需从死端起步，而不是遍历全部 n 个格。
   *
   * v3 初版遍历全部起点，每个起点都跑一次完整搜索 → 9x9 盘上单次求解
   * 要几百毫秒。改为只从死端起步后，搜索量降一个数量级。
   *
   * 若盘上没有死端（D=0 的自由盘），则退回「全部格按度数排序」——
   * 此时哈密顿路径的两个端点都是度>=2 的格，只能靠搜索找。
   */
  const deadEndStarts = starts.filter((i) => degOf(rs, i) === 1);
  /**
   * **自由起点时的候选上限**。
   *
   * 自由起点下，若盘上没有死端（D=0 的自由盘），只能遍历全部格当起点，
   * 而每个起点都要跑一次完整搜索 —— 81 格的盘就是 81 次搜索，慢到不可用。
   *
   * 实践中：**度数最小的几个格**才是端点的合理候选（Warnsdorff 启发式同款直觉），
   * 所以只取前 `FREE_START_CAP` 个。这不是完备搜索，
   * 但解数估计只需要「大概有几个解」，不需要精确枚举。
   */
  const FREE_START_CAP = 12;
  const ordered = startAt >= 0
    ? [startAt]
    : (deadEndStarts.length > 0
      ? deadEndStarts
      : starts.slice(0, FREE_START_CAP));

  // D=2 时两个端点都已钉死：A->B 和 B->A 两种朝向都要试，否则会误杀合法盘面。
  //
  // **提示场景可以只试一种朝向**（`tryReverse = false`）：
  // 提示的线头已经在 `preVisited` 里 —— 它是**障碍**不是目标。
  // 反向搜索求的是「从终点起步、覆盖除线头外所有格」的路径，
  // 这条路径**根本不含线头**，对本提示毫无用处，却要烧掉一半预算。
  const orientations: Array<[number, number]> = [];
  if (startAt >= 0 && rs.endAt >= 0 && !fullRules) {
    orientations.push([startAt, rs.endAt]);
    if (tryReverse) orientations.push([rs.endAt, startAt]);
  } else {
    for (const s of ordered) orientations.push([s, rs.endAt]);
  }

  for (const [s, e] of orientations) {
    const st: SearchState = {
      rs,
      rng,
      visited: new Uint8Array(n),
      keyMask: initKeyMask,
      shardNext: initShardNext,
      path: [],
      expanded: 0,
      coveredTargets: 0,
    };
    if (pre) st.visited.set(pre);
    st.visited[s] = 1;
    st.path.push(s);
    // 预置访问的格不算目标；起点本身若已被预置访问，也不重复计入。
    st.coveredTargets = pre && pre[s] ? 0 : 1;
    if (rs.typeOf[s] === CoverCell.KEY) st.keyMask |= 1 << rs.groupOf[s];
    if (rs.typeOf[s] === CoverCell.SHARD) st.shardNext = rs.groupOf[s] + 1;

    const remain = budget - totalExpanded;
    if (remain <= 0) return { path: null, expanded: totalExpanded, exhausted: true };

    // Endpoints already committed when the search starts:
    //   - a PINNED start counts from the very beginning;
    //   - a FREE start is NOT committed yet (the root may still pick a
    //     different first cell), so a board with exactly two dead ends stays
    //     legal -- one becomes the start and the other the end.
    //   - a PINNED end counts as well.
    const committed = (startAt >= 0 ? 1 : 0) + (rs.endAt >= 0 ? 1 : 0);
    const res = dfs(st, s, remain, deadline, e, jitter, committed, targetCount);
    totalExpanded += res.expanded;
    if (res.path) return res;
    if (res.exhausted) return { path: null, expanded: totalExpanded, exhausted: true };
  }
  return { path: null, expanded: totalExpanded, exhausted: false };
}

/** 数一下 Uint8Array 里非零的个数。 */
function countTrue(a: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) n++;
  return n;
}

/** 深度优先搜索。 */
function dfs(
  st: SearchState,
  cur: number,
  budget: number,
  deadline: number,
  endAt: number,
  jitter: number,
  committedEndpoints: number,
  targetCount: number,
): SolveResult {
  const { rs } = st;
  /**
   * **未覆盖的目标数**。
   *
   * 注意不是 `rs.n - path.length`：提示场景下玩家已经走过一部分，
   * 那些格是障碍而不是目标。所以用 `coveredTargets` 单独计数。
   */
  const remaining = targetCount - st.coveredTargets;

  if (remaining === 0) {
    if (endAt >= 0 && cur !== endAt) {
      return { path: null, expanded: st.expanded, exhausted: false };
    }
    return { path: st.path.slice(), expanded: st.expanded, exhausted: false };
  }

  if (remaining === 1) {
    if (!canFinish(st, cur, endAt)) {
      return { path: null, expanded: st.expanded + 1, exhausted: false };
    }
    for (let v = 0; v < rs.n; v++) {
      if (st.visited[v]) continue;
      st.visited[v] = 1;
      st.path.push(v);
      st.coveredTargets++;
      break;
    }
    if (endAt >= 0 && st.path[st.path.length - 1] !== endAt) {
      st.path.pop();
      st.coveredTargets--;
      return { path: null, expanded: st.expanded + 1, exhausted: false };
    }
    return { path: st.path.slice(), expanded: st.expanded + 1, exhausted: false };
  }

  if (st.expanded >= budget) {
    return { path: null, expanded: st.expanded, exhausted: true };
  }
  if (deadline > 0 && (st.expanded & 1023) === 0 && Date.now() > deadline) {
    return { path: null, expanded: st.expanded, exhausted: true };
  }
  if (isPruned(st, cur, remaining, committedEndpoints)) {
    return { path: null, expanded: st.expanded + 1, exhausted: false };
  }
  const moves = candidateMoves(rs, cur, st.visited, st.keyMask).filter((mv) =>
    mv.consumed.every((c) => shardAllows(rs, c, st.shardNext)),
  );

    // Warnsdorff 启发式：优先走「未访问邻居最少」的格。
    // 少了这一条，11x11 盘上搜索量会爆炸 ——
    // 因为它会把搜索逼向自锁的角落。
  //
  // **钉死终点时的过滤**：终点不能提前被踩到。
  // 完整规则模式下一次滑行会消耗多格，所以不能只看落点 ——
  // 滑行「路过」终点也算提前踩到，必须整条排除。
  const scored = moves
    .filter((mv) => {
      if (endAt < 0) return true;
      if (mv.consumed.includes(endAt)) return mv.target === endAt;
      return true;
    })
    .map((mv) => ({
      mv,
      k:
        unvisitedNeighbors(rs, st.visited, mv.target) +
        noiseOf(st.path.length, mv.target) +
        jitter * st.rng.next(),
    }));
  scored.sort((a, b) => a.k - b.k);

  st.expanded++;
  for (const { mv } of scored) {
    const savedKey = st.keyMask;
    const savedShard = st.shardNext;
    const savedLen = st.path.length;
    const savedCovered = st.coveredTargets;
    applyMove(mv, st.visited, st);
    for (const c of mv.consumed) st.path.push(c);
    st.coveredTargets += mv.consumed.length;

    // Once the path has more than one cell, its FIRST cell is committed as an
    // endpoint (a Hamiltonian path can only have two endpoints, and the first
    // cell can never be an interior cell).
    //
    // This matters for the endpoint budget: without it, the search would keep
    // thinking there are two free endpoint slots and never prune boards that
    // have more than two forced endpoints.
    const childCommitted = st.path.length >= 2 ? Math.max(committedEndpoints, 1) : committedEndpoints;

    const res = dfs(st, mv.target, budget, deadline, endAt, jitter, childCommitted, targetCount);
    if (res.path) return res;

    st.path.length = savedLen;
    st.keyMask = savedKey;
    st.shardNext = savedShard;
    st.coveredTargets = savedCovered;
    for (const c of mv.consumed) st.visited[c] = 0;
    if (res.exhausted) return res;
  }
  return { path: null, expanded: st.expanded, exhausted: false };
}
