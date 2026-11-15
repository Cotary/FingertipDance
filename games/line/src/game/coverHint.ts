/**
 * Cover 模式 v3：提示。
 *
 * ## 提示做什么
 *
 * 玩家走了一段，问「接下来该往哪走」。
 * 答案 = **在剩余盘面上求一条覆盖所有剩余格的路径**。
 *
 * ## 为什么不能直接查表
 *
 * 设计文档 §5.1 提到「参考解入库 → 提示 O(1) 查表」。
 * 但那只在玩家**严格沿着参考解走**时成立。
 * 玩家一旦走岔（走了另一条同样合法的哈密顿路径），
 * 参考解就接不回去了 —— 强行回退到参考解会让玩家的线突然倒退，体验极差。
 *
 * 所以这里的做法是：**实时求解剩余盘面**。
 * 代价是求解时间，但实测 11x11 盘只要几毫秒，完全可以在客户端实时做。
 *
 * ## 求解的是「带预置障碍的盘面」
 *
 * 玩家已走的格不再是目标 —— 它们是障碍（不能重复走）。
 * 求解时把它们预置成「已访问」，目标数 = 未访问格数。
 *
 * **不抽子图重编号**：重编号会改变局部编号，
 * 而求解器的 Warnsdorff 打散项 `noiseOf(pathLen, target)` 用局部编号 ——
 * 重编号后同一个盘面的候选排序就变了，
 * 求解器会掉进另一种（可能更差的）搜索顺序，
 * 表现为「明明有解却搜不出来」（实测 9x9 盘上就是这样）。
 *
 * 所以直接在原规则集上搜：预置 visited + 调整目标计数。
 *
 * ## 关键实现细节：已拾取的钥匙 / 星星要带进来
 *
 * 玩家已经走过一半，可能已经拿了 1 号钥匙、已经过了 1 号星。
 * 剩余盘面的求解必须**从这个状态继续**，否则会给出「先去拿钥匙」的提示 ——
 * 而钥匙可能已经被拿走了（或者被走岔的路径消耗掉了）。
 */
import { mulberry32 } from '../core/rng';
import { solve } from '../core/cover/v3/solver';
import { replayRemaining, withPlain } from '../core/cover/v3/rules';
import { CoverCell } from '../core/cover/v3/types';
import type { CoverState } from './coverState';

/** 提示结果。 */
export interface HintResult {
  /**
   * 完整剩余路线（拍平索引序列，**不含线头**）。空数组 = 无提示。
   *
   * `cells[0]` 是玩家下一步该落下的格，`cells[last]` 是这条线走完的终点。
   * 长度 = 剩余未走格数，所以它同时也是一句「还有多少步」。
   *
   * 早先这里只返回 3 格（线头 + 2 步），理由是「只给方向不给答案」。
   * 但求解器本来就把整条路径算完了，截断**不省任何计算**，
   * 只是让提示短到玩家看不出方向 —— 于是改成全量返回，
   * 由渲染层决定同时点亮几格（见 `HINT_WINDOW`）。
   */
  cells: number[];
  /** 是否找到解。false = 从当前位置已经走不通了。 */
  found: boolean;
  /** 求解耗时（ms）。 */
  ms: number;
  /**
   * 建议回退到的位置（拍平索引）。
   *
   * 当 `found === false` 时给出：玩家走岔了，
   * 与其给一个错的建议，不如告诉他「退回到这里还有救」。
   */
  backtrackTo?: number;
}

/** 求解选项。 */
export interface HintOptions {
  /**
   * 最多返回几格。`0` / 不传 = 全部（默认）。
   *
   * 只用于测试里截短，正式玩法要整条路线。
   */
  maxCells?: number;
  /** 搜索预算（节点数）。 */
  budget?: number;
  /** 墙钟时限（ms）。 */
  deadlineMs?: number;
  /** 随机种子（不同种子会给出不同的合法提示）。 */
  seed?: number;
}

/**
 * 默认搜索预算（节点数）。
 *
 * 60k 节点对后期大关卡（12×12 = 144 格）可能不够，
 * 但配合下面的时限兜底，超时也能给出合法提示。
 */
const DEFAULT_BUDGET = 60000;

/**
 * 默认墙钟时限（毫秒）。
 *
 * ## 为什么要有限时
 *
 * 求解是在**主线程**同步跑的（`findCoverHint` 直接调）。
 * 不限时的话，后期大关卡的一次搜索可能跑几百毫秒甚至几秒 ——
 * 表现就是点一下「提示」，画面**冻住**一两秒，然后才出提示。
 *
 * 120ms 是个折中：
 * - 足够跑完绝大多数关卡的最优解搜索；
 * - 超了也不会卡住画面太久（超时会返回当前找到的最好结果，
 *   或者明确告诉玩家「这一关算不出来」）。
 *
 * 想彻底不卡主线程应该改成 Web Worker，但那是更大的改动；
 * 有限时是当下最划算的止血。
 */
const DEFAULT_DEADLINE_MS = 120;

/**
 * **重试轮数上限**（每一轮换一份打散强度）。
 *
 * ## 为什么需要重试
 *
 * 求解器的候选排序里，打散项 `noiseOf()` 是**纯函数**（不吃随机源），
 * 而 `jitter` 直接加在 Warnsdorff 分数上。
 * 所以：
 *   - 换 `rng` 种子 —— 搜索顺序**不变**（钉死起点时 `ordered = [startAt]`，
 *     起点排序的平局裁决用不到 rng），重试是**假的**；
 *   - 换 `jitter` —— 搜索顺序**真的变了**，能走到不同的分支。
 *
 * 实测（世界七冰块关卡）：`jitter = 0` 单一路径搜 40 万节点仍找不到；
 * 换成几档不同的 `jitter` 后，第二档就命中。
 *
 * ## 为什么不是越多越好
 *
 * 每轮都要花满预算。轮数 × 预算 = 总耗时上限，
 * 必须与 `DEFAULT_DEADLINE_MS` 一起控制在「点一下提示不卡顿」的范围内。
 */
const RETRY_JITTERS = [0, 0.35, 0.8, 1.5];

/**
 * 求提示。
 *
 * @param state    当前状态
 * @param maxCells 最多返回几格（0 = 全部）
 * @returns 提示结果
 */
export function findCoverHint(state: CoverState, maxCells = 0): HintResult {
  return findCoverHintWith(state, { maxCells });
}

/** 求提示（可调预算与时限）。 */
export function findCoverHintWith(
  state: CoverState,
  opts: HintOptions = {},
): HintResult {
  const t0 = Date.now();
  const maxCells = Math.max(0, opts.maxCells ?? 0);
  const budget = opts.budget ?? DEFAULT_BUDGET;
  // 有限时（默认 120ms）—— 见 DEFAULT_DEADLINE_MS 的说明。
  // 传 `deadlineMs: 0` 可以显式要求不限时（只在测试里用）。
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const seed = opts.seed ?? 0x5eed;

  const src = state.runtime.rs;

  // 线头：还没起步就没有「接下来」，用起点约束当线头
  const headLocal =
    state.path.length > 0
      ? state.path[state.path.length - 1]
      : src.startAt >= 0
        ? src.startAt
        : -1;

  if (headLocal < 0) {
    // 自由起点 + 玩家还没下笔：没有线头，求解器无处可算。
    //
    // 旧实现在这里直接返回 `found: false`，而调用方对「没结果」不吭声，
    // 于是第 1 关（正是自由起点）**点提示什么都不发生** ——
    // 新玩家第一次点提示就撞上这个洞。
    //
    // 现在改成「替他挑一格起手」：逐个候选起点试求解，第一个能走通的就拿来当提示。
    const pick = findFreeStartHint(state, maxCells, seed, budget, deadlineMs);
    if (pick) return { cells: pick.cells, found: true, ms: pick.ms };
    return { cells: [], found: false, ms: Date.now() - t0 };
  }

  const res = solveRemaining(state, headLocal, seed, budget, deadlineMs);
  const ms = Date.now() - t0;

  if (!res.path || res.path.length === 0) {
    const backtrackTo = findBacktrackTarget(state);
    return { cells: [], found: false, ms, backtrackTo };
  }

  // 局部编号 -> 拍平索引。
  // `res.path[0]` 恒等于线头（求解器从线头出发），它已经在线上了，
  // 不属于「接下来该走」，所以从 1 开始。
  const cells: number[] = [];
  for (let i = 1; i < res.path.length; i++) {
    cells.push(src.flatOf[res.path[i]]);
    if (maxCells > 0 && cells.length >= maxCells) break;
  }
  return { cells, found: true, ms };
}

/**
 * 最多试几个候选起手格。
 *
 * 自由起点关卡的起手格有 n 个候选（11×11 就是 86 个），
 * 全试一遍在 120ms 时限内根本跑不完 —— 而且前几次成功概率最高，
 * 越往后越是在给「本身就走不通」的格子交学费。
 */
const FREE_START_TRIES = 16;

/**
 * 四邻接度（只看普通上下左右，不看冰块滑行与传送门）。
 *
 * 排序用：度越小越可能是真正的路径端点。
 */
function plainDegree(rs: import('../core/cover/v3/rules').RuleSet, local: number): number {
  let d = 0;
  for (let dir = 0; dir < 4; dir++) if (rs.nbr[local * 4 + dir] >= 0) d++;
  return d;
}

/**
 * 自由起点 + 空盘：挑一格能走通的起手格。
 *
 * ## 为什么要排序
 *
 * 一条哈密顿路径的两个端点，在格子图上绝大多数是**死角**（只有一个邻居）。
 * 从死角起手命中率最高，而从编号 0 依次试起，前几格大概率是内部格 ——
 * 每次都要搜到底才失败，等于把预算全烧在错的地方。
 *
 * ## 为什么可以逐个试
 *
 * 空盘时 `state.visited` 全零，`solveRemaining` 只要把候选格标成「已访问」，
 * 就是在问「从这格起手能不能铺满剩下的」。这正是我们要的判定，
 * 不需要另写一套求解逻辑。
 */
function findFreeStartHint(
  state: CoverState,
  maxCells: number,
  seed: number,
  budget: number,
  deadlineMs: number,
): { cells: number[]; ms: number } | null {
  const src = state.runtime.rs;
  const t0 = Date.now();

  const order: number[] = [];
  for (let i = 0; i < src.n; i++) order.push(i);
  order.sort((a, b) => plainDegree(src, a) - plainDegree(src, b));

  const tries = Math.min(order.length, FREE_START_TRIES);
  for (let k = 0; k < tries; k++) {
    // 总时限是共享的：前面几次试得越久，后面能试的候选越少。
    // 超时就收手 —— 宁可说一句「暂时给不出」，也不要把主线程冻住。
    const left = deadlineMs - (Date.now() - t0);
    if (left <= 0) break;
    const res = solveRemaining(state, order[k], seed + k * 0x9e37, budget, left);
    if (!res.path || res.path.length === 0) continue;
    // 空盘没有线头，`res.path[0]` 就是「该从哪格起手」，照样是玩家要落的第一格。
    const cells: number[] = [];
    for (let i = 0; i < res.path.length; i++) {
      cells.push(src.flatOf[res.path[i]]);
      if (maxCells > 0 && cells.length >= maxCells) break;
    }
    return { cells, ms: Date.now() - t0 };
  }
  return null;
}

/**
 * 在「当前状态」的剩余盘面上求解。
 *
 * ## 策略：**纯网格求解 + 完整规则复核**
 *
 * 这是一个「**快而准**」的组合：
 *
 * | 阶段 | 模式 | 为什么 |
 * |---|---|---|
 * | 求解 | `plain = true`（纯四邻接，无传送边） | 剪枝永远有效 → 毫秒级出解 |
 * | 复核 | `replayRemaining`（完整规则） | 保证提示在真实玩法下真的走得通 |
 *
 * ### 为什么求解可以走「纯网格」
 *
 * 剪枝（奇偶 / 连通性 / 端点预算）全部依赖「路径是四邻接链」这个前提。
 * 传送边会破坏它 —— 跳跃跳过中间格，黑白交替不再成立：
 * 实测 9×9 盘上纯网格 **77 个节点**就能出解，开着传送边 **30 万个节点还找不到**。
 *
 * 冰块滑行**不会**破坏链结构（滑行消耗的每一格都与前一格四邻接），
 * 但它会让「一次移动消耗多格」，于是 Warnsdorff 的目标度数启发式
 * 不再精确，导致搜索在大盘上退化（世界七冰块关实测 40 万节点仍失败）。
 *
 * ### 为什么求解结果仍然可用
 *
 * **纯网格解在完整规则下依然合法** —— 前提是它不在冰块上转弯。
 * 所以必须复核：`replayRemaining` 按完整规则重走一遍
 * （冰块滑行、单向门、钥匙门、星星顺序全部按真实玩法判定），
 * 不合法就丢弃这一轮，换一档打散强度重试。
 *
 * 实测（1000 关全量）：
 *   - 空盘：1000/1000 给出提示，中位 0ms，p95 6ms；
 *   - 中途 50%：1000/1000 给出提示，中位 1ms，p95 8ms。
 *
 * @param headLocal 当前线头（局部编号）
 * @returns 求解结果（路径是「从线头开始」的局部编号序列）
 */
function solveRemaining(
  state: CoverState,
  headLocal: number,
  seed: number,
  budget: number,
  deadlineMs: number,
): { path: number[] | null } {
  const src = state.runtime.rs;

  // 已走过的格 = 障碍（预置访问）。
  // 线头本身也在里面 —— 它已经走过了，不是目标。
  const pre = state.visited.slice();
  pre[headLocal] = 1;

  // 剩余目标数 = 未走过的格数
  let remaining = 0;
  for (let i = 0; i < src.n; i++) if (!pre[i]) remaining++;

  if (remaining === 0) {
    // 已经铺满了
    return { path: [headLocal] };
  }

  const deadline = deadlineMs > 0 ? Date.now() + deadlineMs : 0;

  // 纯网格模式：剪枝永远有效，找到的路径在完整规则下依然合法。
  const plainRs = withPlain(src, true);

  for (const jitter of RETRY_JITTERS) {
    const left = deadline > 0 ? deadline - Date.now() : 0;
    if (deadline > 0 && left <= 0) break;

    const res = solve(
      plainRs,
      mulberry32(seed),
      headLocal,
      budget,
      left,
      jitter,
      false, // fullRules = false → 纯网格求解（快）
      state.keyMask,
      state.shardNext,
      pre,
      true, // noPortal：纯网格模式下本来就无传送边，显式声明意图
      false, // tryReverse：反向朝向不含线头，纯浪费预算
    );
    if (!res.path || res.path.length === 0) continue;

    // 完整规则复核 —— 纯网格解可能「在冰块上转弯」，真实玩法下走不通。
    const check = replayRemaining(
      src,
      res.path,
      pre,
      headLocal,
      state.keyMask,
      state.shardNext,
    );
    if (check.ok) return { path: res.path };
  }
  return { path: null };
}

/**
 * 找「退回到哪里还有救」的位置。
 *
 * 玩家走岔后，剩余盘面可能已经无解。与其给一个错的建议，
 * 不如告诉他「退回到这里还能继续」。
 *
 * 做法：从线头往前试，找到**最深的**一个「截断到那里之后仍有解」的位置。
 *
 * @returns 原盘拍平索引；找不到返回 undefined
 */
export function findBacktrackTarget(state: CoverState): number | undefined {
  const src = state.runtime.rs;
  if (state.path.length === 0) return undefined;

  // 从最深往前试（越深越好 —— 让玩家少退）
  for (let k = state.path.length - 1; k >= 1; k--) {
    if (solvableFrom(state, k)) {
      return src.flatOf[state.path[k - 1]];
    }
  }
  return undefined;
}

/**
 * 「把路径截断到 `keepLen` 格之后，剩余盘面还有解吗？」
 */
function solvableFrom(state: CoverState, keepLen: number): boolean {
  const src = state.runtime.rs;

  // 构造截断后的 visited / 收集状态
  const pre = new Uint8Array(src.n);
  let keyMask = 0;
  let shardNext = 0;
  for (let i = 0; i < keepLen; i++) {
    const c = state.path[i];
    pre[c] = 1;
    if (src.typeOf[c] === CoverCell.KEY) keyMask |= 1 << src.groupOf[c];
    if (src.typeOf[c] === CoverCell.SHARD) shardNext = src.groupOf[c] + 1;
  }

  const head = state.path[keepLen - 1];
  if (head === undefined) return false;

  let remaining = 0;
  for (let i = 0; i < src.n; i++) if (!pre[i]) remaining++;
  if (remaining === 0) return true;

  const res = solve(
    withPlain(src, true),
    mulberry32(0x5eed),
    head,
    20000,
    0,
    0,
    false, // 纯网格求解（剪枝有效 → 快）
    keyMask,
    shardNext,
    pre,
    true, // noPortal
    false, // tryReverse：反向朝向不含线头
  );
  if (!res.path) return false;

  // 完整规则复核 —— 与提示求解用同一套判定。
  return replayRemaining(src, res.path, pre, head, keyMask, shardNext).ok;
}

/**
 * 提示的「无解」判定辅助。
 *
 * 玩家走岔了、且剩余盘面已经无解时，提示应该告诉他「走不通了」，
 * 而不是给一个错的建议。
 */
export function isDeadEnd(state: CoverState): boolean {
  const head = state.path[state.path.length - 1];
  if (head === undefined) return false;
  const res = solveRemaining(state, head, 0x5eed, 40000, 0);
  return !res.path;
}
