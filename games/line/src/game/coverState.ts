/**
 * Cover 模式 v3：客户端游戏状态机。
 *
 * ## 与经典模式的根本差异
 *
 * | | 经典模式 | Cover 模式 |
 * |---|---|---|
 * | 通关条件 | 线头抵达终点 | 覆盖**全部**必需格 |
 * | 起点 | 固定 START 格 | 玩家自选（钉死时才是指定格） |
 * | 终点 | 固定 END 格 | 玩家自选（钉死时才是指定格） |
 * | 步数 | 可变 | 恒等于 `required - 1` |
 * | 松手未通关 | 整段作废 | 宽限 1.5s 内可按回线头续接，超时才作废 |
 *
 * ## 交互模型
 *
 * cover 模式没有「起点 → 终点」的单向目标，玩家在盘面上**画一条铺满的线**。
 * 所以交互有三件事要处理：
 *
 * 1. **回退**：玩家拖回一个走过的格 → 路径截断到那一格。
 *    （不是「非法」—— 在铺满之前，走错就退回去是自然操作。）
 * 2. **快拖**：手指甩得快时，指针采样会跳过中间的格。
 *    所以当目标与线头**同行或同列**且中间全通时，自动补齐中间格。
 * 3. **断线**：既不同行也不同列 → 忽略这次移动（不惩罚）。
 *
 * ## 为什么状态放在「局部编号」体系里
 *
 * `rules.ts` 的规则集用**局部编号**（可走格压成 0..n-1），
 * 求解与回放都在这个坐标系里工作。所以状态机内部也用局部编号，
 * 只在渲染时才换算回拍平索引。
 *
 * 这样做的直接好处：**提示功能可以直接复用求解器**——
 * 提示就是「在剩余盘面上求一条路径」，而求解器吃的就是规则集。
 */
import {
  candidateMoves,
  stepMove,
  type Move,
  type RuleSet,
} from '../core/cover/v3/rules';
import { CoverCell } from '../core/cover/v3/types';
import type { CoverRuntime } from './coverLevel';

/** 关内阶段。 */
export type CoverPhase =
  /** 待开始（还没下第一笔） */
  | 'idle'
  /** 拖动中 */
  | 'dragging'
  /**
   * 松手但还没认输（宽限期）。
   *
   * 路径**仍然保留**，按回线头可以接着拖；宽限期结束才真正作废。
   * 手机上手指出汗、屏幕边缘误触、只是想看看盘面 —— 都会抬手指，
   * 而抬手指不该等于「重来一次」（一次就丢一星）。
   */
  | 'paused'
  /** 通关 */
  | 'won';

/** 一次移动的结果类型。 */
export type CoverMoveResult =
  /** 走通了（冰块滑行可能消耗多格） */
  | 'moved'
  /** 走到了已走过的格 → 路径被截断（回退） */
  | 'backtracked'
  /** 目标不可进入（机制不满足 / 已走过且不在路径上） */
  | 'blocked'
  /** 就是当前线头 */
  | 'same'
  /** 不相邻且无法快拖补齐 → 忽略 */
  | 'break';

/**
 * 提示窗口：**同时点亮几格**。
 *
 * 路线本身是完整的一条（见 `coverHint.ts`），但一次性把几十格全点亮，
 * 盘面会变成一张色块图，玩家反而看不出「下一步是哪」。
 * 5 格刚好够读出一次转折（直行 + 拐弯 + 再直行），
 * 又不至于把整关答案糊在脸上。
 *
 * 玩家每走一格，窗口跟着往前滑一格 —— 这就是「依次点亮」。
 */
export const HINT_WINDOW = 5;

/** 点亮错峰（ms）：窗口里第 k 格比第 0 格晚点亮这么久。 */
const HINT_REVEAL_STAGGER = 70;

/**
 * 提示路线计划。
 *
 * 与「一组高亮格」的区别在于它有**游标**：
 * 玩家照着走时游标前进、窗口滑动；一旦偏离，整条作废。
 */
export interface CoverHintPlan {
  /** 完整剩余路线（拍平索引），`cells[0]` 是下一步。 */
  cells: number[];
  /** 下一格在 `cells` 里的下标。 */
  at: number;
  /**
   * 每格「首次点亮」的时刻（ms），`0` = 还没轮到它。
   *
   * 存在的理由：窗口滑动时尾部会冒出新的一格，
   * 没有时间戳就只能硬闪一下，看不出「这是新补进来的」。
   */
  litAt: number[];
}

/** cover 关内状态。 */
export interface CoverState {
  runtime: CoverRuntime;
  phase: CoverPhase;
  /** 已走过的局部编号序列（按走过顺序） */
  path: number[];
  /** 已走过的格（局部编号集合） */
  visited: Uint8Array;
  /** 已拾取的钥匙掩码（bit 0 = 1 号钥匙） */
  keyMask: number;
  /** 下一个必须收集的星星分组（0 基） */
  shardNext: number;
  /** 重来次数（松手未通关 → +1）。星级按它算。 */
  undos: number;
  /** 提示路线（null = 没有提示） */
  hint: CoverHintPlan | null;
  /** 已用提示次数 */
  hintUsed: number;
  /** 本关开始时间（ms） */
  startAt: number;
  /**
   * **上一次移动消耗掉的格**（局部编号）。
   *
   * 存在的理由：冰块滑行会让「一次移动消耗多格」。
   * 玩家手指停在冰块上时，指针采样会**反复**报同一个冰块格 ——
   * 如果把它当「回退」处理，玩家刚滑完就被撤销了，体验非常怪。
   *
   * 所以：目标落在**上一次移动消耗过的格**里 → 视为「手指没动」，忽略。
   * 落在更早的路径格上 → 才是真正的回退。
   */
  lastConsumed: number[];
}

/** 创建初始状态。 */
export function createCoverState(runtime: CoverRuntime): CoverState {
  return {
    runtime,
    phase: 'idle',
    path: [],
    visited: new Uint8Array(runtime.rs.n),
    keyMask: 0,
    shardNext: 0,
    undos: 0,
    hint: null,
    hintUsed: 0,
    startAt: Date.now(),
    lastConsumed: [],
  };
}

// ────────────────────────────── 提示路线 ──────────────────────────────

/** 清掉提示（偏离路线 / 重来 / 换关）。 */
export function clearHint(state: CoverState): void {
  state.hint = null;
}

/**
 * 装上一条提示路线。
 *
 * 窗口内的前 `HINT_WINDOW` 格错峰点亮（70ms 一格），
 * 读起来像一只手电沿着路线扫过去，而不是「啪」地出现五个环。
 */
export function setHintPlan(state: CoverState, cells: number[], now = Date.now()): void {
  if (cells.length === 0) {
    state.hint = null;
    return;
  }
  const litAt = new Array<number>(cells.length).fill(0);
  for (let k = 0; k < Math.min(HINT_WINDOW, cells.length); k++) {
    litAt[k] = now + k * HINT_REVEAL_STAGGER;
  }
  state.hint = { cells: cells.slice(), at: 0, litAt };
}

/**
 * 玩家又走了 `consumed`（局部编号，按走过顺序）之后，把提示的游标往前推。
 *
 * - 每一格都对得上路线 → 窗口滑过去，尾部补进一格；
 * - 有一格对不上 → 玩家**偏离了**路线，整条作废。
 *
 * 为什么不做「偏离后重新求解」：求解要 1~13ms，在拖动过程中悄悄算会让
 * 手指感到一顿一顿的；而且提示突然改道比消失更让人迷惑。
 * 想再要一次，松开手再点一下「提示」就是了。
 */
export function consumeHintCells(
  state: CoverState,
  consumed: number[],
  now = Date.now(),
): void {
  const plan = state.hint;
  if (!plan || consumed.length === 0) return;

  const r = rs(state);
  let at = plan.at;
  for (const c of consumed) {
    if (plan.cells[at] === r.flatOf[c]) {
      at++;
      continue;
    }
    state.hint = null;
    return;
  }
  if (at === plan.at) return;

  plan.at = at;
  // 窗口尾部新露出来的那格要记下「刚刚点亮」
  const tail = at + HINT_WINDOW - 1;
  if (tail < plan.cells.length && plan.litAt[tail] === 0) plan.litAt[tail] = now;
}

/** 规则集。 */
function rs(state: CoverState): RuleSet {
  return state.runtime.rs;
}

/**
 * 起点候选。
 *
 * - 钉死了起点（D >= 1）：只有那一个格。
 * - 自由起点（D = 0）：任意必需格。
 *
 * 死端（deg = 1）必然是路径端点，所以它可以当起点，也可以当终点。
 */
export function canStartAt(state: CoverState, local: number): boolean {
  if (local < 0 || local >= rs(state).n) return false;
  if (state.visited[local]) return false;
  const r = rs(state);
  if (r.startAt >= 0) return local === r.startAt;
  return true;
}

/**
 * 从某个局部格出发，枚举所有合法的下一步。
 *
 * 复用 `rules.ts` 的 `candidateMoves` ——
 * 它已经处理了单向门、钥匙门、冰块滑行、传送门，
 * 也已经处理了**滑行途中的星星顺序**（乱序的星星会让滑行停在它前面）。
 *
 * 所以这里不需要再额外过滤星星 —— `candidateMoves` 传进去的
 * `state.shardNext` 就是当前的待收集编号。
 */
export function movesFrom(state: CoverState, cur: number): Move[] {
  const r = rs(state);
  return candidateMoves(r, cur, state.visited, state.keyMask, state.shardNext);
}

/** 某个局部编号在当前路径上的位置；不在则 -1。 */
function pathIndexOf(state: CoverState, local: number): number {
  return state.path.indexOf(local);
}

/** 收集效果重算（撤销后要重新统计已拾取的钥匙与星星）。 */
function recomputePickups(state: CoverState): void {
  const r = rs(state);
  state.keyMask = 0;
  state.shardNext = 0;
  for (const c of state.path) {
    if (r.typeOf[c] === CoverCell.KEY) state.keyMask |= 1 << r.groupOf[c];
    if (r.typeOf[c] === CoverCell.SHARD) state.shardNext = r.groupOf[c] + 1;
  }
}

/** 截断路径到 `keepLen` 个格（并重算收集效果）。 */
function truncatePath(state: CoverState, keepLen: number): void {
  for (let i = keepLen; i < state.path.length; i++) state.visited[state.path[i]] = 0;
  state.path.length = keepLen;
  recomputePickups(state);
}

/**
 * 尝试从当前线头移动到 `target`（局部编号）。
 */
export function tryCoverMove(state: CoverState, target: number): CoverMoveResult {
  if (state.phase !== 'dragging') return 'blocked';
  if (state.path.length === 0) return 'blocked';

  const r = rs(state);
  const last = state.path[state.path.length - 1];

  if (target === last) return 'same';
  if (target < 0 || target >= r.n) return 'blocked';

  // **手指没动**：目标落在上一次移动消耗过的格里（冰块滑行会消耗多格，
  // 指针会反复采样到中间格）。忽略，不能当成回退。
  if (state.lastConsumed.includes(target)) return 'same';

  // 走到已走过的格 → 回退（路径截断到那一格）
  const at = pathIndexOf(state, target);
  if (at >= 0) {
    truncatePath(state, at + 1);
    state.lastConsumed = [];
    // 退回一格之后，「下一步」的答案可能整个变了，留着只会指错路
    clearHint(state);
    return 'backtracked';
  }

  const lx = r.flatOf[last] % r.w;
  const ly = Math.floor(r.flatOf[last] / r.w);
  const tx = r.flatOf[target] % r.w;
  const ty = Math.floor(r.flatOf[target] / r.w);
  const dx = tx - lx;
  const dy = ty - ly;

  // 传送门：**进入即传送**，没有「站在门上再拖」这一步。
  //
  // 走进传送门的那一步，`stepMove` 的 `consumed` 就是 `[入口, 出口]`，
  // 下面的「相邻走一步」分支会一次吃掉两格，玩家看到线头直接出现在出口。
  //
  // 旧实现在这里单独判一条 `viaPortal` 边，但它排在相邻判断之前却要求
  // 玩家**精确拖到搭档格**（隔一整片盘时指针根本落不到），
  // 而物理相邻时又总是先命中下面的分支 —— 两头都不通。

  // 相邻 → 走一步（走进传送门时这里会一次吃掉入口 + 出口）
  if (Math.abs(dx) + Math.abs(dy) === 1) {
    const dir = dirOfDelta(dx, dy);
    const consumed = stepMove(r, last, dir, state.visited, state.keyMask, state.shardNext);
    if (consumed) {
      applyConsumed(state, consumed);
      state.lastConsumed = consumed.slice();
      // 玩家照着提示走了 → 窗口往前滑；走岔了 → consumeHintCells 会把路线清掉。
      // 旧实现无条件 clear()，于是「完整路线」只能看一步就要重新点提示。
      consumeHintCells(state, consumed);
      return 'moved';
    }
    return 'blocked';
  }

  // 同行或同列 → 尝试快拖补齐（中间格自动填）
  if (dx === 0 || dy === 0) {
    const dir = dirOfDelta(dx, dy);
    const filled = autoFill(state, last, dir, target);
    if (filled) {
      applyConsumed(state, filled);
      state.lastConsumed = filled.slice();
      // 快拖一次吃掉好几格：只要这些格在路线上且顺序对，窗口就整段滑过去
      consumeHintCells(state, filled);
      return 'moved';
    }
  }

  return 'break';
}

/**
 * 快拖补齐：从 `cur` 沿 `dir` 连走，直到走满到 `target`。
 *
 * 逐步用 `stepMove` 走（而不是直接判定），所以单向门、
 * 钥匙门、星星顺序、冰块滑行全都自动被尊重。
 *
 * 遇到冰块就**停**（不自动滑行）—— 冰块会改变移动粒度，
 * 自动补齐跨过冰块会让玩家的意图和实际走向不一致。
 *
 * ## 传送门
 *
 * 「进入即传送」下，走进传送格的那一步 `consumed` 长度是 **2**
 * （`[入口, 出口]`）—— 与冰块滑行的「长度 > 1」形态一样，但语义不同：
 *
 *  - **冰块**：多消耗的几格在**同一直线上**，继续沿 `dir` 走是自然的
 *    → 旧行为是**放弃自动补齐**（`return null`），交给正常单步处理；
 *  - **传送门**：出口搭档在**盘上别处**，与 `dir` 毫无关系
 *    → 继续沿 `dir` 走毫无意义，必须**在出口搭档处收手**。
 *
 * 所以传送门分支：吃掉 `[入口, 出口]` 后直接结束补齐。
 * 出口搭档恰好就是 target 时返回成功（`target` 达成）。
 *
 * @returns 消耗的局部编号序列；走不到 target 返回 null
 */
function autoFill(
  state: CoverState,
  cur: number,
  dir: number,
  target: number,
): number[] | null {
  const r = rs(state);
  const consumedAll: number[] = [];
  // 模拟用的 visited 副本（避免中途污染真实状态）
  const simVisited = state.visited.slice();
  let simKeyMask = state.keyMask;
  let simShardNext = state.shardNext;
  let at = cur;

  for (let guard = 0; guard < r.n + 2; guard++) {
    const consumed = stepMove(r, at, dir, simVisited, simKeyMask, simShardNext);
    if (!consumed) return null;

    /**
     * **传送门**：走进入口的那一步一次吃掉 `[入口, 出口]`。
     *
     * 出口搭档不在 `dir` 的延长线上 —— 继续沿 `dir` 补齐毫无意义。
     *
     * `autoFill` 是**原子操作**：要么补齐到 `target`（返回消耗序列），
     * 要么什么都不做（返回 null，让调用方按「拖到别处」处理）。
     * 传送的出口不在目标方向上 → 这一趟补齐**失败** → 返回 null。
     */
    if (consumed.length === 2 && r.typeOf[consumed[0]] === CoverCell.PORTAL) {
      if (consumed[1] !== target) return null;
      for (const x of consumed) {
        simVisited[x] = 1;
        consumedAll.push(x);
        if (r.typeOf[x] === CoverCell.KEY) simKeyMask |= 1 << r.groupOf[x];
        if (r.typeOf[x] === CoverCell.SHARD) simShardNext = r.groupOf[x] + 1;
      }
      return consumedAll;
    }

    // 冰块：不自动滑行，交给正常单步处理
    if (consumed.length > 1) return null;
    const c = consumed[0];

    for (const x of consumed) {
      simVisited[x] = 1;
      consumedAll.push(x);
    }
    if (r.typeOf[c] === CoverCell.KEY) simKeyMask |= 1 << r.groupOf[c];
    if (r.typeOf[c] === CoverCell.SHARD) simShardNext = r.groupOf[c] + 1;

    at = c;
    if (c === target) return consumedAll;
  }
  return null;
}

/**
 * 应用一次消耗（更新 visited / 收集效果 / 路径）。
 *
 * **收集效果沿消耗序列逐格推进** —— 与 `rules.ts` 的 `makeMove` 同一套语义：
 * 滑行是一次移动吃掉多格，中途捡到的钥匙/星星必须按顺序生效。
 */
function applyConsumed(state: CoverState, consumed: number[]): void {
  const r = rs(state);
  for (const c of consumed) {
    state.visited[c] = 1;
    state.path.push(c);
    if (r.typeOf[c] === CoverCell.KEY) state.keyMask |= 1 << r.groupOf[c];
    if (r.typeOf[c] === CoverCell.SHARD) state.shardNext = r.groupOf[c] + 1;
  }
}

/**
 * 开始拖动。
 *
 * @returns 是否成功起步
 */
export function beginCoverDrag(state: CoverState, local: number): boolean {
  if (state.phase !== 'idle') return false;
  if (!canStartAt(state, local)) return false;

  const r = rs(state);
  state.phase = 'dragging';
  state.path = [local];
  state.visited[local] = 1;
  state.keyMask = 0;
  state.shardNext = 0;

  // 起点的即时效果：起点上就摆着钥匙 / 星星
  if (r.typeOf[local] === CoverCell.KEY) state.keyMask |= 1 << r.groupOf[local];
  if (r.typeOf[local] === CoverCell.SHARD) state.shardNext = r.groupOf[local] + 1;

  // 提示路线有两条来路，起步时的处理不同：
  //
  // 1. **自由起点关卡**：提示的第一格就是「该从这格起手」。
  //    玩家按下它 → 兑现第一格，游标前进；按在别处 → 提示作废（路线是别的起手算的）。
  // 2. **钉死起点关卡**：提示是「起点之后怎么走」，第一格不是起点。
  //    按下起点不该影响它 —— 什么都不做，路线继续有效。
  const plan = state.hint;
  if (plan) {
    if (plan.cells[plan.at] === r.flatOf[local]) {
      consumeHintCells(state, [local]);
    } else if (r.startAt < 0) {
      clearHint(state);
    }
  }

  return true;
}

/**
 * 通关判定 —— **只判定，不改状态**。
 *
 * **通关 = 覆盖全部必需格**；若钉死了终点，还要求线头正好落在终点。
 *
 * 与 `releaseCover` 分开的原因见 `failCover` 的注释：
 * 触屏上「松手」不等于「认输」，判定和处罚必须能分开调用。
 */
export function isCoverSolved(state: CoverState): boolean {
  const r = rs(state);
  if (state.path.length === 0) return false;

  for (let i = 0; i < r.n; i++) {
    if (!state.visited[i]) return false;
  }
  return r.endAt < 0 || state.path[state.path.length - 1] === r.endAt;
}

/**
 * 作废当前这一笔：重来次数 +1、清空路径、回到待起步。
 *
 * **唯一会增加 `undos` 的地方。** 星级只看它，
 * 所以调用点必须是「玩家真的放弃」——不是「手指抬起」（见 `CoverSession.pointerUp`）。
 */
export function failCover(state: CoverState): void {
  state.undos++;
  resetPath(state);
  state.phase = 'idle';
  state.lastConsumed = [];
}

/**
 * 松手（旧语义：判定 + 未通关立即作废）。
 *
 * @returns 是否通关
 *
 * **新代码不要再调它** —— 触屏松手不该直接清零。
 * 会话层现在走 `isCoverSolved` + 宽限期，见 `CoverSession`。
 * 保留此函数是因为状态机单测按它断言「未通关 → undos+1 且清空」，
 * 这条语义本身没错，只是**时机**该由会话层决定。
 */
export function releaseCover(state: CoverState): boolean {
  if (state.phase !== 'dragging') return false;
  if (isCoverSolved(state)) {
    state.phase = 'won';
    return true;
  }
  failCover(state);
  return false;
}

/**
 * 宽限期续接：按在**当前线头那一格**时恢复拖动。
 *
 * 只有按在线上才续得上 —— 按在别的格子上是「想重新起一笔」，
 * 那属于新的一笔，不该白捡刚才的进度。
 *
 * @returns 是否成功续接
 */
export function resumeCover(state: CoverState, local: number): boolean {
  if (state.phase !== 'paused') return false;
  if (state.path.length === 0) return false;
  if (state.path[state.path.length - 1] !== local) return false;
  state.phase = 'dragging';
  state.lastConsumed = [];
  return true;
}

/**
 * 宽限期内**点到线头的邻格**：也当作"接着走"，把这一格吃掉。
 *
 * ## 为什么不能只认线头本身
 *
 * 触屏上有一多半玩家不是"拖"，而是"点着走"：点起点，再点右边一格，再点下一格。
 * 老实现里第二次点（邻格）既不是线头也不是起手格，于是走「按别处」分支 ——
 * 整条路径当场作废、还扣一次重来。一步没走错却被打断，玩家只会觉得"点不了"。
 *
 * 所以这里放宽到「线头的正交邻格」：判定通过后把 phase 推回 `dragging`，
 * 由调用方补一次 `tryCoverMove` 把这一格真正吃进去。
 * 只认**相邻一格**，不认同行的远处格 —— 远距离是"拖"的语义，
 * 单点一下跨三格会让路径凭空补齐，反而看不清发生了什么。
 *
 * 不合法时**不改任何状态**，调用方可以安全地退回原流程。
 */
export function resumeCoverStep(state: CoverState, target: number): boolean {
  if (state.phase !== 'paused') return false;
  if (state.path.length === 0) return false;

  const r = rs(state);
  if (target < 0 || target >= r.n) return false;
  if (pathIndexOf(state, target) >= 0) return false; // 走过的格交给 tryCoverMove 当回退
  if (state.lastConsumed.includes(target)) return false;

  const last = state.path[state.path.length - 1];
  const lx = r.flatOf[last] % r.w;
  const ly = Math.floor(r.flatOf[last] / r.w);
  const tx = r.flatOf[target] % r.w;
  const ty = Math.floor(r.flatOf[target] / r.w);
  if (Math.abs(tx - lx) + Math.abs(ty - ly) !== 1) return false;

  state.phase = 'dragging';
  state.lastConsumed = [];
  return true;
}

/**
 * 清空当前路径（保留重来计数）。
 *
 * **导出的原因**：切后台（`onHide`）时必须能把当前这局作废掉 ——
 * 见 `coverSession.ts` 的 `abandon()`。
 *
 * 只清路径不清 `phase` 是有意的：调用方要自己决定回到什么阶段
 * （放弃 → `'idle'`；其它场景可能想留在 `'dragging'`）。
 */
export function resetPath(state: CoverState): void {
  const r = rs(state);
  state.path = [];
  state.visited = new Uint8Array(r.n);
  state.keyMask = 0;
  state.shardNext = 0;
  // 盘面回到起点，旧提示是按「残留路径」算出来的，必须一起清掉
  clearHint(state);
}

/**
 * 撤销一步（玩家主动回退一格）。
 *
 * cover 模式下允许回退：路径必须「铺满且不重复」，
 * 但还没铺满时可以往回走 —— 走错了先退回去，而不是整段作废。
 *
 * 拖回已走过的格也会自动回退（见 `tryCoverMove`），
 * 这个函数是给「撤销按钮」用的显式入口。
 *
 * @returns 是否成功撤销
 */
export function undoCoverStep(state: CoverState): boolean {
  if (state.phase !== 'dragging') return false;
  // 只保留起点（起点的键/星效果不能撤）
  if (state.path.length <= 1) return false;
  truncatePath(state, state.path.length - 1);
  return true;
}

/** 是否已经铺满（用于渲染进度条）。 */
export function coveredRatio(state: CoverState): number {
  const r = rs(state);
  if (r.n === 0) return 0;
  let n = 0;
  for (let i = 0; i < r.n; i++) if (state.visited[i]) n++;
  return n / r.n;
}

/** 已覆盖的格数。 */
export function coveredCount(state: CoverState): number {
  const r = rs(state);
  let n = 0;
  for (let i = 0; i < r.n; i++) if (state.visited[i]) n++;
  return n;
}

/** 由坐标差求方向编码（0=上 1=下 2=左 3=右）。 */
export function dirOfDelta(dx: number, dy: number): number {
  if (dy === -1) return 0;
  if (dy === 1) return 1;
  if (dx === -1) return 2;
  return 3;
}
