/**
 * Cover v3：解数估计。
 *
 * ## 为什么不用「精确枚举」
 *
 * 「这个盘面有多少条哈密顿路径」是 NP 难的。直接枚举在 81 格的盘面上
 * 搜索树是 4^81 —— 实测 300 万步预算仍然一条都没数出来。
 *
 * 而且**精确计数对本项目没有价值**：我们需要的只是「大概有几个解」，
 * 用来做难度分档（唯一 / 少 / 多）和候选池的分层排序。
 *
 * ## 采样估计法
 *
 * 用**随机重启**采样：
 *   1. 每次重启用不同的 rng（打乱求解器的起点优先级）；
 *   2. 搜一条哈密顿路径；
 *   3. 记录这条路径的**有序指纹**（格子访问顺序）；
 *   4. 统计**不同指纹**的数量。
 *
 * ## 关键点一：指纹必须是「有序」的
 *
 * 哈密顿路径访问的格子**集合永远相同**（就是全部可走格），
 * 所以指纹必须编码**访问顺序**，否则所有解的指纹都一样，
 * 解数永远算成 1。
 *
 * ## 关键点二：对称等价要去重
 *
 * 盘面常左右对称，两条互为镜像的路径其实是「同一个解的镜像」，
 * 不去重就会虚高计数。所以指纹要**对左右镜像做规范化**：
 * 取「原指纹」与「镜像指纹」的字典序较小者。
 *
 * 镜像路径 = 访问顺序反转 + 每格左右翻转。
 */
import { mulberry32 } from '../../rng';
import { withPlain, type RuleSet } from './rules';
import { solve, degOf } from './solver';

/** 采样起点数量：每次重启轮换一个起点，覆盖不同端点的解。 */
const START_SAMPLE = 4;

/** 解数分档。 */
export type SolutionBand = 'unique' | 'few' | 'many';

/** 采样得到的解信息。 */
export interface SolutionEstimate {
  /** 估计的解数（不同指纹数）。 */
  count: number;
  /** 分档。 */
  band: SolutionBand;
  /** 采样次数。 */
  samples: number;
  /** 采样命中的次数。 */
  hits: number;
}

/**
 * 有序指纹：把访问顺序编码成字符串。
 *
 * 每个局部编号占 2 个十六进制位（局部编号 < 4096 足够覆盖 121 格）。
 */
function orderedKey(path: number[]): string {
  let s = '';
  for (const v of path) s += v.toString(16).padStart(3, '0');
  return s;
}

/**
 * 规范化指纹：对左右镜像做规范化，取字典序小的那个。
 *
 * 镜像路径 = 访问顺序反转 + 每格左右翻转。
 */
function canonicalKey(rs: RuleSet, path: number[]): string {
  const forward = orderedKey(path);

  // 构造镜像路径
  const mirrored: number[] = [];
  for (let i = path.length - 1; i >= 0; i--) {
    const flat = rs.flatOf[path[i]];
    const x = flat % rs.w;
    const y = Math.floor(flat / rs.w);
    const mf = y * rs.w + (rs.w - 1 - x);
    const ml = rs.localOf[mf];
    if (ml < 0) return forward; // 镜像后不在盘内 -> 不做规范化
    mirrored.push(ml);
  }
  const back = orderedKey(mirrored);
  return forward < back ? forward : back;
}

/**
 * 估计解数（采样法）。
 *
 * @param restarts   采样次数（每次尝试找一条解）
 * @param deadlineMs 墙钟时限
 */
export function estimateSolutions(
  rsIn: RuleSet,
  restarts = 10,
  deadlineMs = 150,
  seed = 1,
  /**
   * **建议的采样起点**（可选）。
   *
   * 传关卡自己的**参考解的起点**最理想：它一定是合法端点，
   * 所以从它出发的搜索必定能找到解 —— 不会「采样 0 次、一个解都没有」。
   *
   * 不传时退化为「度数最小的格」，在挖洞较多的盘面上那个格可能不是合法端点，
   * 导致搜索失败（实测 9×9 盘上 count=0）。
   */
  preferredStart?: number,
  /**
   * 是否按**纯网格**（剥离机制）估算（默认 true）。
   *
   * true  → 只看棋盘拓扑的解数，与机制无关。好处是快、且对所有关卡口径一致。
   * false → 按完整规则（含单向门/钥匙/传送门/冰块）估算，与玩家体验一致，
   *          但慢很多（机制约束会大幅削减搜索树）。
   *
   * **注意**：纯网格口径下，某些关卡可能 count=0 —— 意思是「去掉机制后这盘无解」，
   * 机制正是它可解的原因。这在机制关卡上是**正常且有意义**的信号
   * （机制是难度的来源），但对 D=0 的无机制关卡则说明生成有问题。
   */
  plainMode = true,
  /**
   * **已知的参考解**（可选，局部编号序列）。
   *
   * 作用有二：
   *   1. **保证 hits >= 1** —— 采样不会「一个解都没找到」，
   *      所以 `solutionCount` 不会因为超时而误报为 0
   *      （count=0 会让难度分里的 `uniqTerm` 直接顶到 1，难度被严重高估）。
   *   2. **作为 solver 的 hint** —— 第一次采样直接命中，
   *      后续采样只需在这个解附近做扰动，搜索量大幅下降。
   */
  knownSolution?: number[],
): SolutionEstimate {
  /**
   * **必须复制一份** —— 下面要把 `startAt` / `endAt` 清成 -1
   * （解数只衡量棋盘拓扑的自由度，不该被「端点钉死」干扰）。
   *
   * 旧实现直接改传进来的规则集 → 调用方的规则集被污染
   * （端点约束凭空消失）。
   */
  const rs = { ...(plainMode ? withPlain(rsIn, true) : rsIn) };
  if (rs.n === 0) return { count: 0, band: 'unique', samples: 0, hits: 0 };

  /**
   * **传送门关卡必须用完整规则求解**（哪怕 `plainMode = true`）。
   *
   * 旧实现有两个问题：
   *
   * 1. `plainMode` 参数**形同虚设** —— 它只把规则集切成「非纯网格」，
   *    但 `solve` 内部仍然 `withPlain(rsIn, !fullRules)`，
   *    也就是**永远按纯网格求解**。
   * 2. 因此传送门关卡的解数算的是**纯网格路径**的条数。
   *
   * 在「传送门是可选边」的老语义下这无所谓（纯网格解永远合法）；
   * 但「进入即传送」的新语义下**完全错了**：
   * 纯网格解会**穿过**传送格而不传送 → 那不是这个游戏的合法解 →
   * 解数被高估、难度分失真。
   *
   * ## 为什么其它关卡仍然走纯网格
   *
   * 难度分的唯一性项要**跨关卡可比**，而不同机制的约束强度差异
   * 会污染这个比较 —— 所以冰块/单向门/钥匙门关卡的解数刻意只看
   * 棋盘拓扑。
   *
   * 但传送门是**例外**：它不是「可选的额外路线」，
   * 而是**必经的强制跳跃** —— 纯网格路径压根不是这个游戏的合法解。
   * 拿它算解数等于在数另一个游戏的解。
   *
   * 成本可接受：关卡盘面是 5×6（约 26~28 格），
   * 开着传送边搜索完全在预算内（实测 expanded 22~122 节点，毫秒级）。
   */
  const fullRules = rs.hasPortal;
  /** 完整规则模式下要**开**传送边。 */
  const noPortal = false;

  // Clear the pinned endpoints: the solution count measures the freedom of the
  // TOPOLOGY. Whether this particular level pins its start/end is a separate
  // design decision (endpoint fixation) and must not distort the count.
  //
  // Without this, a D=2 level would look like "1 solution" (the pinned one)
  // even when the underlying board has many.
  rs.startAt = -1;
  rs.endAt = -1;

  const deadline = Date.now() + Math.max(1, deadlineMs);
  /**
   * **确定性模式**。
   *
   * 生产路径要求「同 seed 同结果」，而**墙钟时限依赖机器速度**：
   * 采样在慢机器上跑不满 `restarts` 次 → 采到的解更少 → 难度分不同 → 盘面不同。
   *
   * 所以 `deadlineMs <= 0` 表示「不限时，只跑满 restarts 次」。
   * 生产路径传 0（见 `generate.ts` 的调用点）。
   */
  const deterministic = deadlineMs <= 0;
  const seen = new Set<string>();
  let samples = 0;
  let hits = 0;

  /**
   * **固定起点**（性能关键）。
   *
   * v3 初版每次重启都从**自由起点**开始，而自由起点意味着
   * 「遍历所有候选起点各搜一次」—— 实测 9×9 盘上 10 次重启 =
   * 120 次搜索，直接打满 150ms 死线，有时**一个解都找不到**（count=0）。
   *
   * 改成：先挑一个**固定的起点**，之后每次重启只改变
   * **jitter**（Warnsdorff 并列选择的随机扰动）。
   * 这样每次重启依然是完整搜索（找到的路径合法），但只搜一次而非 N 次，
   * 10 次采样从 150ms 降到 ~10ms。
   *
   * 为什么固定起点不影响采样多样性：
   * 固定起点 + 不同 jitter → 不同的并列选择顺序 → **不同的哈密顿路径**。
   * 路径的访问顺序就是解的指纹，所以多样性保留。
   */
  let fixedStart = -1;
  if (preferredStart !== undefined && preferredStart >= 0 && preferredStart < rs.n) {
    fixedStart = preferredStart;
  } else {
    let bestDeg = 99;
    for (let i = 0; i < rs.n; i++) {
      let d = 0;
      for (let k = 0; k < 4; k++) if (rs.nbr[i * 4 + k] >= 0) d++;
      if (d < bestDeg) { bestDeg = d; fixedStart = i; }
    }
  }

  /**
   * **采样起点集合**（修复「系统性少数解」）。
   *
   * ## 问题
   *
   * 只从**一个**起点采样会**系统性少数解**：
   * 起点不同 → 路径端点不同 → **是不同的解**。
   * 实测 2×3 矩形（暴力枚举）：
   *   - 起点 0 有 3 条互不相同的哈密顿路径，起点 2 只有 2 条；
   *   - 全部起点合起来是 **10** 条。
   *
   * 只从起点 0 采样最多只能看到 3 条 —— 少算了 70%。
   *
   * 少算解数 → 难度公式里的 `uniqTerm` 偏高 → **难度被高估**。
   *
   * ## 修法
   *
   * 采样在**多个低度数起点**之间轮转（而不是死盯一个）。
   * 每次重启仍然只搜一次，所以**搜索总量不变**，
   * 但覆盖的解空间大得多。
   *
   * 低度数优先：哈密顿路径的端点通常是度数最小的格，
   * 所以从这些格出发才可能找到解（从度数大的格出发多半搜不到）。
   */
  const startCandidates: number[] = [];
  if (fixedStart >= 0) startCandidates.push(fixedStart);
  {
    const byDeg: number[] = [];
    for (let i = 0; i < rs.n; i++) byDeg.push(i);
    byDeg.sort((a, b) => degOf(rs, a) - degOf(rs, b) || a - b);
    for (const i of byDeg) {
      if (startCandidates.length >= START_SAMPLE) break;
      if (!startCandidates.includes(i)) startCandidates.push(i);
    }
  }
  for (let k = 0; k < restarts; k++) {
    // **确定性**：不看墙钟，只看重试次数。
    // 墙钟截止会让同一份种子在不同机器上采到不同数量的解 → 难度分不同 → 盘面不同。
    if (!deterministic && Date.now() > deadline) break;
    const rng = mulberry32((seed * 2654435761 + k * 40503) >>> 0);
    // jitter = 0.9：给 Warnsdorff 的并列选择加随机扰动，
    // 这样每次重启找到的路径才真的不同（否则确定性噪声会永远给出同一个解）。
    //
    // 起点在 `startCandidates` 里轮转 —— 覆盖不同端点的解。
    const start = startCandidates[k % startCandidates.length];
    const res = solve(
      rs,
      rng,
      start,
      /**
       * **步数预算：2000**。
       *
       * 采样只要「找到一个解」即可 —— 满矩形这类盘 80~120 步就出解，
       * 有洞的盘稍多也远不到 2000 步。
       *
       * 实测（9×9 / 10×10 各 8 个候选）：
       * | 参数 | 平均耗时 | 解数估计 |
       * |---|---|---|
       * | 4 次 × 6000 步 | 37 ms | 偏保守 |
       * | 3 次 × 3000 步 | 28 ms | 接近 |
       * | **2 次 × 2000 步** | **18 ms** | 略保守但够用 |
       *
       * 解数只做**软偏好**（难度的唯一性项），不是硬门槛 ——
       * 估得略保守不影响关卡合法性。
       */
      2000,
      // 确定性模式 -> 不限时（步数预算才是硬约束）；调试模式 -> 用剩余墙钟。
      deterministic ? 0 : Math.max(1, deadline - Date.now()),
      0.9,
      fullRules,
      0,
      0,
      undefined,
      noPortal,
    );
    samples++;
    if (!res.path) continue;
    hits++;
    seen.add(canonicalKey(rs, res.path));
  }

  /**
   * **把已知参考解算作一个样本**。
   *
   * 没有它，采样可能因超时而全部落空（hits=0 → count=0），
   * 而 count=0 在难度公式里会被当成「唯一解」（uniqTerm 顶到 1），
   * 导致难度被严重高估 —— 实测世界六/七的难度虚高到 71~75。
   *
   * 参考解是**合法解**，所以把它计入样本是准确的，不是作弊。
   * 它可能与采样得到的某个解重合（去重后不影响 count）。
   */
  if (knownSolution && knownSolution.length === rs.n) {
    samples++;
    hits++;
    seen.add(canonicalKey(rs, knownSolution));
  }

  // 一条都没找到 -> 不可解（调用方应视为生成失败）
  if (hits === 0) return { count: 0, band: 'unique', samples, hits };

  const count = seen.size;
  const band: SolutionBand = count <= 1 ? 'unique' : count <= 3 ? 'few' : 'many';
  return { count, band, samples, hits };
}
