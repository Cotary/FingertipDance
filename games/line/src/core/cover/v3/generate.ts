/**
 * Cover 模式 v3：候选生成。
 *
 * ## 核心规则（全文第一原则）
 *
 *   一条连续的路，铺满整张地图；不能交叉，不能重复走。
 *
 * 起点、终点、障碍、单向门、星星、钥匙门、传送门、冰块 —— **全是加难度的玩法**，
 * 核心规则本身不随难度变化。
 *
 * ## 生成流程
 *
 *   1. 正向设计盘面（形状库 + 洞预算）
 *   2. 挖洞 & 验证（carve & verify）—— 保证可解
 *   3. 注入机制（起终点 / 单向门 / 星星 / 钥匙门 / 传送门 / 冰块）
 *   4. 度量 + 打分
 *
 * **可解性由暴力求解保证**，不靠构造假设。
 */
import type { Rng } from '../../rng';
import { levelSeed, mulberry32 } from '../../rng';
import { designShape, isConnected, fourNeighbors, type ShapeFamily, type DesignResult } from './design';
import { carveAndVerify } from './carve';
import { computeDiff, measure, type DiffContext, type Metrics } from './metrics';
import { buildRuleSet, replay, type RuleSet } from './rules';
import { splicePortals } from './portal';
import { estimateSolutions } from './solcount';
import { CoverCell, DIR, dirVec, packCell, cellType } from './types';

/** 起终点固定度。 */
export type EndpointMode = 'free' | 'start' | 'both';

/** 机制种类。 */
export type MechKind = 'oneway' | 'shard' | 'keygate' | 'portal' | 'ice';

/** 世界参数。 */
export interface WorldParams {
  from: number;
  to: number;
  /** 起始尺寸。 */
  w: number;
  h: number;
  /** 结束尺寸。 */
  w2: number;
  h2: number;
  /** 起终点固定度：free=0 / start=1 / both=2。 */
  endpoints: EndpointMode;
  /** 本世界启用的机制。 */
  mechs: MechKind[];
  /** 本世界的形状家族。 */
  families: ShapeFamily[];
  /** 散点洞对数。 */
  scatterPairs: number;
  /** 目标难度区间。 */
  diffRange: [number, number];
  /**
   * 洞数量比例区间（含）—— **规模控制的主控参数**。
   *
   * v3 初版的规模回归（世界一只产出 10~12 格，设计要求 16~25）根因是
   * carve 的「额外挖洞轮」不受约束，且洞预算按绝对值设定 ——
   * 同一个绝对值在小盘上是 25%、在大盘上只有 2%，规模曲线整个歪掉。
   *
   * 现在改成**按棋盘面积的比例**：实际洞预算 = `round(w*h*ratio)`，
   * 这样同一世界内尺寸变化时比例稳定，规模曲线才单调。
   *
   * 比例来源：设计规模区间约为棋盘面积的 88%~100%（障碍是难度载体，
   * 但不能把盘掏空 —— 规模本身是难度基线）。
   */
  holeRatio: [number, number];
}

/** 候选关卡。 */
export interface Candidate {
  /** 关号（编排后重新赋值）。 */
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** 盘面编码（每格 1 字节：(type<<4)|(dir<<2)|group）。 */
  grid: Uint8Array;
  /** 可走格数。 */
  required: number;
  /** 参考解（局部编号序列）。 */
  solution: number[];
  /** 参考解（拍平索引序列）。 */
  solutionFlat: number[];
  /** 度量结果。 */
  metrics: Metrics;
  /** 难度分 0..100。 */
  diff: number;
  /** 死端数（= D：起终点自由度）。 */
  deadEnds: number;
  /** 图论死端格数（度 <= 1 的格）。 */
  deadEndCells: number;
  /** 机制种类数（0..6）。 */
  mechKinds: number;
  /** 起点在解中的位置；-1 = 自由。 */
  startAt: number;
  /** 终点在解中的位置；-1 = 自由。 */
  endAt: number;
  /** 棋盘指纹（形状 + 机制掩码）。 */
  fingerprint: string;
  /** 指纹重复次数（软惩罚用；0 = 全表唯一）。 */
  fingerprintRepeat: number;
  /** 形状家族。 */
  family: ShapeFamily;
  /** 挖掉的格数（障碍总数）。 */
  holeCount: number;
  /**
   * 本关的生成耗时（ms）。
   *
   * 用于门禁「单关最坏生成耗时 < 2s」（设计文档 §12 门禁 #11）。
   */
  genMs: number;
}

/**
 * 七个世界。
 *
 * 尺寸随难度阶梯增长；起终点按「自由 → 钉起点 → 钉两端」递进。
 * `holeRange` 把规模钉在设计区间内（见 WorldParams.holeRange 的说明）。
 *
 * ## `diffRange` 怎么定
 *
 * 它是**难度目标带**（先验值），编排器按它挑候选。
 * 现在的值是 **5×6 统一尺寸 + 新难度公式**下的实测分位带（p10~p90），
 * 与 `pool.ts` 的 `calibrateTargets`（按池子实测分布校准）一致。
 *
 * 尺寸配置改了（见 `SIZE_CONFIG`）、难度公式改了（见 `metrics.ts`），
 * 这张表都要**重新校准** —— 否则编排器会一直够不到目标。
 */
export const WORLDS: WorldParams[] = [
  {
    // 世界一 苗圃：5×6，规模 26~28 —— 教学「铺满全盘」
    //
    // **尺寸对齐设计文档 §6.3**（世界一 = 5×5）。
    // v3 初版用 4×4 起，但 4×4 的形状空间太小：
    // 洞预算最多 2 格，而形状库的最小挖洞单位也是 2 格（骨牌），
    // 于是 4×4 的每一关都是**满矩形**（实测 5 关共用一个指纹）。
    from: 1, to: 12, w: 5, h: 5, w2: 5, h2: 5,
    endpoints: 'free', mechs: [], families: ['domino', 'notch', 'corner', 'scatter'], scatterPairs: 0,
    /**
     * 难度目标 = **v3 公式的实测分位带**（p10~p90），不是设计文档 v2 的值。
     *
     * 设计文档 §6.3 的难度目标（5–10 / 10–14 / … / 32–40）是**v2 公式**的校准值，
     * v2 的 `diff` 与 v3 的 `diff`（0..100、规模基线 × 结构系数）**不同量纲**，
     * 直接套用会导致「目标永远够不到」（实测偏差 8.7，门禁要求 ≤ 8）。
     *
     * 现在这里写的是 v3 公式在 1000 关全量生产下的实测分位带，
     * 与 `pool.ts` 的 `calibrateTargets`（按池子实测分布校准）**一致**。
     */
    diffRange: [11, 15],
    // 挖 0~12%：5×6=30 格 → 挖 0~2 格（规模 28~30）
    holeRatio: [0, 0.12],
  },
  {
    // 世界二 石溪：6×6，规模 24~28 —— 引入单向门
    from: 13, to: 32, w: 6, h: 6, w2: 6, h2: 6,
    endpoints: 'free', mechs: ['oneway'], families: ['corner', 'notch', 'island', 'domino'], scatterPairs: 1,
    diffRange: [23, 30],
    holeRatio: [0, 0.16],
  },
  {
    // 世界三 苔原：7×7，规模 24~28 —— 钉起点 + 星星
    from: 33, to: 64, w: 7, h: 7, w2: 7, h2: 7,
    endpoints: 'start', mechs: ['shard'], families: ['domino', 'notch', 'scatter', 'composite'], scatterPairs: 1,
    diffRange: [36, 42],
    holeRatio: [0, 0.20],
  },
  {
    // 世界四 熔炉：8×8，规模 24~28 —— 钥匙门
    from: 65, to: 152, w: 8, h: 8, w2: 8, h2: 8,
    endpoints: 'start', mechs: ['keygate'], families: ['domino', 'notch', 'scatter', 'island'], scatterPairs: 2,
    diffRange: [44, 50],
    holeRatio: [0, 0.24],
  },
  {
    // 世界五 深井：8×8→9×9，规模 24~28 —— 钉两端 + 传送门
    from: 153, to: 404, w: 8, h: 8, w2: 9, h2: 9,
    endpoints: 'both', mechs: ['portal'], families: ['domino', 'scatter', 'notch', 'composite'], scatterPairs: 2,
    diffRange: [54, 59],
    holeRatio: [0, 0.28],
  },
  {
    // 世界六 云阶：9×9，规模 22~28 —— 隘口 + 诱饵
    from: 405, to: 704, w: 9, h: 9, w2: 9, h2: 9,
    endpoints: 'both', mechs: ['oneway', 'shard'], families: ['scatter', 'composite', 'domino'], scatterPairs: 3,
    diffRange: [68, 75],
    holeRatio: [0, 0.30],
  },
  {
    // 世界七 星穹：10×10→11×11，规模 22~28 —— 冰块
    from: 705, to: 1000, w: 10, h: 10, w2: 11, h2: 11,
    endpoints: 'both', mechs: ['oneway', 'shard', 'ice'], families: ['composite', 'domino'], scatterPairs: 3,
    diffRange: [79, 87],
    holeRatio: [0, 0.30],
  },
];

/**
 * 关号对应的洞预算（绝对格数）。
 *
 * 由 `holeRatio` × 棋盘面积推得，并**取偶数** ——
 * 洞数必须偶数才能保证奇偶中性（奇偶中性单位：骨牌 2 格 / 2×2 块 4 格）。
 *
 * **取偶规则**：向下取偶会把小预算压成 0。
 * 实测 4×4（面积 16）时 `floor(0.12*16)=1` → 向下取偶 = 0 →
 * 世界一的每一关都是**满矩形**，盘面完全相同（300 关里 25 个重复）。
 * 所以改成「**就近取偶**」，并且比例 > 0 时**至少给 2 格**（一块骨牌）。
 */
export function holeBudgetOf(
  idx: number,
): { min: number; max: number; maxHoles: number } {
  const wp = worldOf(idx);
  const { w, h } = sizeOf(idx);
  const area = w * h;

  /** 就近取偶（0 -> 0，1 -> 2，2 -> 2，3 -> 4 ...）。 */
  const roundEven = (v: number): number => {
    const r = Math.round(v);
    return r % 2 === 0 ? r : r + 1;
  };

  let min = roundEven(wp.holeRatio[0] * area);
  let max = roundEven(wp.holeRatio[1] * area);
  // 比例 > 0 就要至少一块骨牌，否则盘面是满矩形 —— 世界一全表会长得一模一样。
  if (wp.holeRatio[1] > 0 && max < 2) max = 2;
  if (max < min) max = min;
  return { min, max, maxHoles: max };
}

/** 关号所属世界。 */
export function worldOf(idx: number): WorldParams {
  for (const wp of WORLDS) if (idx >= wp.from && idx <= wp.to) return wp;
  return WORLDS[WORLDS.length - 1];
}

/** 目标难度分：段内线性，段间无缝衔接（全程单调不降）。 */
export function targetDiff(idx: number): number {
  const wp = worldOf(idx);
  const span = wp.to - wp.from;
  const t = span <= 0 ? 0 : (idx - wp.from) / span;
  /**
   * **跨世界单调化**。
   *
   * 每个世界的 `diffRange` 是独立的实测分位带，它们之间**可能有缝隙**：
   * 实测世界三上限 44、世界四下限 41 → 边界处目标难度会**回落 3 分**。
   *
   * 目标曲线必须是单调不降的（设计文档 §6.2「段间无缝衔接」），
   * 所以这里把当前世界的下限**抬到上一世界的目标上限**：
   *
   * ```
   * lo = max(wp.diffRange[0], 上一世界的目标上限)
   * hi = max(wp.diffRange[1], lo)     // 保证 hi >= lo
   * ```
   *
   * 这样边界处目标难度**衔接而非回落**。
   */
  const prev = previousWorld(wp);
  const lo = prev ? Math.max(wp.diffRange[0], prev.diffRange[1]) : wp.diffRange[0];
  const hi = Math.max(wp.diffRange[1], lo);
  return Math.round(lo + (hi - lo) * t);
}

/** 某个世界的上一个世界（没有则返回 null）。 */
function previousWorld(wp: WorldParams): WorldParams | null {
  const i = WORLDS.indexOf(wp);
  return i > 0 ? WORLDS[i - 1] : null;
}

/**
 * **棋盘尺寸总配置** —— 调「关卡太大 / 太难」时的**唯一旋钮**。
 *
 * ## 为什么要做成配置而不是改 `WORLDS`
 *
 * `WORLDS` 里的 `w/h/w2/h2` 是**阶梯**（世界一 5×5 → 世界七 11×11）。
 * 用户反馈「太难了」时，常见诉求是「盘面小一点」。
 * 如果直接改 `WORLDS`，就得改 7 个世界 × 4 个数字 = 28 处，
 * 而且无法在不改代码的前提下做 A/B 对比。
 *
 * ## 两个旋钮
 *
 * - `uniform`：**所有关卡都用这个尺寸**（忽略阶梯）。
 *   「先统一用 5×6 试试」这种诉求就设它。
 * - `cap`：把阶梯整体**钳到不超过**这个尺寸。
 *   「前面几关小一点、后面还是长大」这种诉求就设它。
 *
 * `uniform` 优先于 `cap`。
 *
 * ## 改了之后要做什么
 *
 * **必须重新生成关卡表** —— 尺寸写在每关的 `grid` 里：
 *
 * ```
 * npm run cover:gen        # 重新产出 data/levels-v3{,-client}.json
 * npm run cover:audit      # 独立审计落盘的表
 * ```
 *
 * 服务端那份（`server/internal/games/line/levels-v3.json`）也要同步。
 */
export interface SizeConfig {
  /**
   * **统一尺寸**：所有关卡都用这个尺寸（忽略世界阶梯）。
   *
   * `null` = 关闭（按世界阶梯走）。
   */
  uniform: { w: number; h: number } | null;
  /**
   * **尺寸上限**：把阶梯结果钳到不超过这个尺寸。
   *
   * `null` = 不限。
   * 注意它只**缩小**不放大 —— 阶梯本来就是单调增长的。
   */
  cap: { w: number; h: number } | null;
}

/**
 * 当前的尺寸配置。
 *
 * ## 当前值：全表统一 5×6
 *
 * 用户反馈「太难了」→ 先把整表尺寸压到 5×6（30 格）试水。
 * 相比世界七原来的 11×11（121 格），规模降到 **1/4**。
 *
 * **改回阶梯**：把 `uniform` 设为 `null`、`cap` 设为 `null` 即可。
 */
export const SIZE_CONFIG: SizeConfig = {
  uniform: { w: 5, h: 6 },
  cap: null,
};

/**
 * 关号对应的棋盘尺寸。
 *
 * 优先级：`SIZE_CONFIG.uniform` > `SIZE_CONFIG.cap` > 世界阶梯。
 *
 * ## 尺寸变了，洞预算会跟着变
 *
 * `holeBudgetOf` 用 `sizeOf` 的结果乘以世界声明的 `holeRatio`（比例），
 * 所以尺寸一小，洞的**绝对数**自动变小 —— 规模曲线不会失衡。
 */
export function sizeOf(idx: number): { w: number; h: number } {
  // ① 统一尺寸：直接返回，忽略阶梯。
  if (SIZE_CONFIG.uniform) {
    return { w: SIZE_CONFIG.uniform.w, h: SIZE_CONFIG.uniform.h };
  }

  const wp = worldOf(idx);
  const span = wp.to - wp.from;
  const t = span <= 0 ? 0 : (idx - wp.from) / span;
  let w = Math.round(wp.w + (wp.w2 - wp.w) * t);
  let h = Math.round(wp.h + (wp.h2 - wp.h) * t);

  // ② 尺寸上限：钳住。
  if (SIZE_CONFIG.cap) {
    w = Math.min(w, SIZE_CONFIG.cap.w);
    h = Math.min(h, SIZE_CONFIG.cap.h);
  }
  return { w, h };
}

/**
 * **世界项**：难度阶梯的位置（0 = 第一世界，1 = 最后世界）。
 *
 * 按世界序号线性铺开，让「世界一到世界七」在难度分上是一条直线。
 * 世界内部再由结构项做细分。
 */
export function worldTermOf(idx: number): number {
  const i = WORLDS.findIndex((wp) => idx >= wp.from && idx <= wp.to);
  if (i < 0) return 0;
  if (WORLDS.length <= 1) return 0;
  return i / (WORLDS.length - 1);
}

/**
 * 规模归一区间（供难度分使用）。
 *
 * ## 为什么必须动态
 *
 * `computeDiff` 的规模项是难度的主驱动（见 `metrics.ts`）。
 * 它需要知道「当前尺寸配置下，盘面最小多大、最大多大」。
 *
 * 尺寸统一成 5×6（30 格）之后，如果还用写死的 10~121，
 * 所有关卡的规模项都挤在 0.16 附近 → **难度分全表塌成一个值**。
 *
 * 所以这里按当前配置算出真实的区间：
 * - `uniform` 模式：上下界相同 → 规模项恒为 1，
 *   难度完全由结构项与世界项决定 ——
 *   这正是「统一尺寸后靠结构拉难度」想要的效果。
 * - 阶梯模式：取阶梯的最小 / 最大尺寸。
 */
export function sizeRange(): { floor: number; ceil: number } {
  if (SIZE_CONFIG.uniform) {
    const area = SIZE_CONFIG.uniform.w * SIZE_CONFIG.uniform.h;
    return { floor: area, ceil: area };
  }
  let minW = Infinity;
  let minH = Infinity;
  let maxW = 0;
  let maxH = 0;
  for (const wp of WORLDS) {
    minW = Math.min(minW, wp.w, wp.w2);
    minH = Math.min(minH, wp.h, wp.h2);
    maxW = Math.max(maxW, wp.w, wp.w2);
    maxH = Math.max(maxH, wp.h, wp.h2);
  }
  return { floor: minW * minH, ceil: maxW * maxH };
}

/** 端点模式 → D 值。 */
function dOf(mode: EndpointMode): number {
  return mode === 'free' ? 0 : mode === 'start' ? 1 : 2;
}

/**
 * 障碍分类：不可走格 → 石头（盘内被包围）或缺口（与盘外连通）。
 *
 * v2 的判定是「四邻全为可走格 → BLOCK」，导致 2×2 及以上的洞永远被判成 VOID
 * —— 实测全表 1000 关只有 38 个 BLOCK 格、27766 个 VOID，盘内可见障碍根本没落地。
 * v3 判定改为「不属于可走格，且不与盘外连通」→ 2×2 洞的 4 格都成为石头。
 */
export function classifyObstacles(
  cells: number[],
  w: number,
  h: number,
): { voids: number[]; blocks: number[] } {
  const set = new Set(cells);
  const removed = new Set<number>();
  for (let c = 0; c < w * h; c++) if (!set.has(c)) removed.add(c);
  const voids: number[] = [];
  const blocks: number[] = [];
  for (const c of removed) {
    // 从该格出发，在「被挖掉的格」内部做泛洪：能碰到边界 → 与盘外连通 → 缺口
    const stack: number[] = [c];
    const seen = new Set<number>([c]);
    let outside = false;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      if (cx === 0 || cx === w - 1 || cy === 0 || cy === h - 1) {
        outside = true;
        break;
      }
      for (const nb of fourNeighbors(cur, w, h)) {
        if (!removed.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        stack.push(nb);
      }
    }
    if (outside) voids.push(c);
    else blocks.push(c);
  }
  return { voids, blocks };
}

/** 机制投放计划。 */
interface MechPlan {
  oneway: number;
  shard: number;
  keygate: number;
  portal: number;
  ice: number;
}

/**
 * 冰块候选：格本身 + 滑行会吃掉的连续格。
 *
 * `run` 是「进入冰块后，沿进入方向一路吃到墙」的完整序列 ——
 * 这些格**必须**保持普通可走格，不能再放别的机制
 * （例如中途放一个单向门，箭头方向与滑行方向不一致就会卡死）。
 */
interface IceSpot {
  /** 冰块所在的局部编号。 */
  spot: number;
  /** 滑行会经过的局部编号序列（含冰块本身）。 */
  run: number[];
}

/** 按世界机制与规模计算投放数量。 */
function mechPlan(mechs: MechKind[], required: number): MechPlan {
  const plan: MechPlan = { oneway: 0, shard: 0, keygate: 0, portal: 0, ice: 0 };
  const scale = Math.min(1, Math.max(0, (required - 20) / 70));
  for (const m of mechs) {
    switch (m) {
      case 'oneway':
        plan.oneway = Math.max(1, Math.round(1 + scale * 3));
        break;
      case 'shard':
        plan.shard = 3;
        break;
      case 'keygate':
        plan.keygate = Math.max(1, Math.round(1 + scale * 1.5));
        break;
      case 'portal':
        plan.portal = 1;
        break;
      case 'ice':
        plan.ice = Math.max(1, Math.round(1 + scale * 2));
        break;
    }
  }
  return plan;
}

/** 机制项归一（0..1）。 */
function mechTermOf(mechs: MechKind[], required: number): number {
  if (mechs.length === 0) return 0;
  const plan = mechPlan(mechs, required);
  const total = plan.oneway + plan.shard + plan.keygate + plan.portal + plan.ice;
  return Math.min(1, total / 8);
}

/** 星星位置：按解的前 1/4 / 中 / 后 1/4 分散（约束越强越难）。 */
function shardSlots(pathLen: number, count: number): number[] {
  const out: number[] = [];
  const fractions = count === 1 ? [0.5] : count === 2 ? [0.25, 0.75] : [0.2, 0.5, 0.8];
  for (const f of fractions) {
    let idx = Math.floor(pathLen * f);
    if (idx < 1) idx = 1;
    if (idx > pathLen - 2) idx = pathLen - 2;
    out.push(idx);
  }
  return out;
}

/** 两个格之间的方向；不相邻返回 -1。 */
function dirBetween(from: number, to: number, w: number): number {
  const dx = (to % w) - (from % w);
  const dy = Math.floor(to / w) - Math.floor(from / w);
  if (dx === 0 && dy === -1) return DIR.UP;
  if (dx === 0 && dy === 1) return DIR.DOWN;
  if (dx === -1 && dy === 0) return DIR.LEFT;
  if (dx === 1 && dy === 0) return DIR.RIGHT;
  return -1;
}

/** 沿方向走一格；越界返回 -1。 */
function stepFlat(idx: number, d: number, w: number, h: number): number {
  const [dx, dy] = dirVec(d);
  const x = (idx % w) + dx;
  const y = Math.floor(idx / w) + dy;
  if (x < 0 || x >= w || y < 0 || y >= h) return -1;
  return y * w + x;
}

/**
 * 找冰块位置。
 *
 * ## 滑行方向 = **进入方向**（不是离开方向）
 *
 * 规则（`rules.ts` 的 `stepMove`）是：
 *
 * ```
 * first = nbr[cur][dir]          ← 移动方向 dir
 * if (first 是 ICE) → 沿 dir 继续滑
 * ```
 *
 * 也就是说，**进入 ICE 格后沿「进入方向」滑行**。
 * 所以 ICE 格 `path[pos]` 的滑行方向是
 *
 * ```
 * dIn = dirBetween(path[pos-1], path[pos])
 * ```
 *
 * ## ⚠️ 曾经的 bug（已修）
 *
 * 这里原先用的是 `dirBetween(path[pos], path[pos+1])`（**离开**方向）。
 * 两者只在「解在冰块处直行」时相等；一旦解在冰块处**转弯**，
 * 校验逻辑就和真实规则对不上：
 *
 *   - 进入方向的下一格可走 → 滑行吃掉解之外的格 → 参考解失效
 *     → **整盘机制被清零**（实测 52 关退化成零机制关卡）；
 *   - 进入方向的下一格被挡 → 滑行 0 格停下，参考解合法但冰块
 *     **毫无玩法效果**（纯装饰，实测 93 关）。
 *
 * 实测 685 个冰块里有 161 个方向判定错误（23.5%）。
 *
 * ## 构造约束（缺一条就会造出无解题或无效冰块）
 *
 *   1. **解必须在冰块处直行**（进入方向 == 离开方向）——
 *      否则玩家滑行时会吃掉解之外的格，参考解失效；
 *   2. 沿进入方向的**整条直线**必须与解的连续几步完全重合 ——
 *      滑行是「撞墙才停」，所以直线上到墙为止的每一格都会被吃掉；
 *   3. ICE 必须 `deg >= 2`，且不能是解的首/末格；
 *   4. 冰块不能与其它机制占同一格（见 `injectMechanics` 的 `used` 集合）。
 *
 * @param used 已被其它机制占用的格（局部编号）
 */
function findIceSpot(
  rs: RuleSet,
  path: number[],
  rng: Rng,
  used: Set<number>,
): IceSpot | null {
  const candidates: number[] = [];
  for (let i = 1; i < path.length - 2; i++) {
    const v = path[i];
    if (used.has(v)) continue;
    let deg = 0;
    for (let k = 0; k < 4; k++) if (rs.nbr[v * 4 + k] >= 0) deg++;
    if (deg >= 2) candidates.push(v);
  }
  if (candidates.length === 0) return null;

  for (const v of rng.shuffle(candidates)) {
    const pos = path.indexOf(v);
    if (pos < 1 || pos + 1 >= path.length) continue;
    // **进入方向**（玩家从 path[pos-1] 走进 path[pos]，滑行沿这个方向继续）
    const d = dirBetween(rs.flatOf[path[pos - 1]], rs.flatOf[path[pos]], rs.w);
    if (d < 0) continue;
    // 约束 ①：解必须在冰块处直行（否则滑行方向与解的走向不一致）
    if (dirBetween(rs.flatOf[path[pos]], rs.flatOf[path[pos + 1]], rs.w) !== d) continue;

    // 约束 ②：沿 d 的整条直线必须与解的连续几步完全重合（滑行撞墙才停）
    const run: number[] = [v];
    let idx = pos;
    let cur = rs.flatOf[path[pos]];
    let ok = true;
    while (true) {
      const after = stepFlat(cur, d, rs.w, rs.h);
      if (after < 0) break; // 撞盘外 → 直线到此为止
      const afterLocal = rs.localOf[after];
      if (afterLocal < 0) break; // 撞障碍 → 直线到此为止
      idx++;
      if (idx >= path.length || path[idx] !== afterLocal) {
        ok = false; // 直线上出现了解之外的格 → 滑行会吃掉它
        break;
      }
      run.push(afterLocal);
      cur = after;
    }
    if (ok) return { spot: v, run };
  }
  return null;
}

/**
 * 注入机制。
 *
 * **铁律**：机制只能加在已验证存在的解 P 上，且加完 P 仍然合法。
 * 「合法」由 `replay` 在完整规则下校验。
 *
 * ## ⚠️ 铁律之二：一个格只能承载一种机制
 *
 * 所有机制共用一个 `used` 集合。原先只有单向门/传送门用它，
 * 星星、钥匙门、冰块各自为政 —— 于是：
 *
 *   - 钥匙门可能把一颗**星星**盖成 GATE（星星编号断档）；
 *   - 冰块可能把一颗**星星**盖成 ICE（星星编号断档）；
 *   - 钥匙门的 KEY 可能落在**单向门**上（单向门被盖掉）。
 *
 * 星星编号断档尤其致命：`shardAllows` 要求「下一个收集的星星
 * 编号 == 当前待收集编号」，编号不连续就**永远走不下去**。
 *
 * 实测这类覆盖在 10×10/11×11 盘上很常见，是「整盘机制被清零」
 * 的另一个根因。
 */
function injectMechanics(
  rs: RuleSet,
  path: number[],
  plan: MechPlan,
  rng: Rng,
  portalCells: ReadonlyArray<readonly [number, number]> = [],
): number {
  const n = rs.n;
  if (n < 10) return 0;
  let injected = 0;

  // 机制格必须是中间格（deg >= 2）
  const interior: number[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    let deg = 0;
    for (let k = 0; k < 4; k++) if (rs.nbr[path[i] * 4 + k] >= 0) deg++;
    if (deg >= 2) interior.push(path[i]);
  }
  if (interior.length < 4) return 0;

  /**
   * **已占用的格**（局部编号）。
   *
   * 全部机制共用 —— 一个格只能承载一种机制。
   */
  const used = new Set<number>();

  /**
   * **传送门格预先占用**。
   *
   * 传送门格是**跳跃边的两端** —— 它们是整条解的骨架，
   * 任何别的机制（冰块 / 单向门 / 星星 / 钥匙门）落在上面都会
   * 破坏「走进传送格 → 传送到搭档」的对齐，参考解当场失效。
   *
   * 所以它们**最先**进 `used`，后来的机制自动避开。
   */
  for (const [entry, exit] of portalCells) {
    used.add(entry);
    used.add(exit);
  }

  const pick = (): number | null => {
    const avail = interior.filter((v) => !used.has(v));
    if (avail.length === 0) return null;
    const v = rng.pick(avail);
    used.add(v);
    return v;
  };
  /**
   * 该格是否可承载新机制。
   *
   * 两个条件都要满足：
   *  1. 没被别的机制占用；
   *  2. **不是解的首/末格** —— 它们会被 START / END 标记覆盖
   *     （网格写回时 `grid[flatOf[startAt]] = packCell(START)`），
   *     放上去的机制会**凭空消失**。
   *     实测钥匙落在解的第 0 格上时，门永远锁着、参考解回放失败，
   *     整盘机制被清零（8×8 盘上 7 关中招）。
   */
  const firstCell = path[0];
  const lastCell = path[path.length - 1];
  const claimable = (v: number | undefined): v is number =>
    v !== undefined && !used.has(v) && v !== firstCell && v !== lastCell;

  // --- 冰块（**最先放**）---
  //
  // 冰块必须先放：滑行会吃掉一整条直线，
  // 这条线上**不能再放别的机制**（单向门的箭头方向一旦与滑行方向打架，
  // 玩家就会被卡在直线上，永远走不完）。
  //
  // 所以冰块放完后，整条 `run` 都会被 `used` 占住，
  // 后面的机制会自动避开它们。
  for (let k = 0; k < plan.ice; k++) {
    const found = findIceSpot(rs, path, rng, used);
    if (!found) break;
    rs.typeOf[found.spot] = CoverCell.ICE;
    for (const c of found.run) used.add(c);
    injected++;
  }

  // --- 单向门：箭头 = 解在该处的离开方向 ---
  for (let k = 0; k < plan.oneway; k++) {
    const chosen = pick();
    if (chosen === null) break;
    const pos = path.indexOf(chosen);
    if (pos < 0 || pos >= path.length - 1) continue;
    const d = dirBetween(rs.flatOf[path[pos]], rs.flatOf[path[pos + 1]], rs.w);
    if (d < 0) continue;
    rs.typeOf[chosen] = CoverCell.ONEWAY;
    rs.dirOf[chosen] = d;
    injected++;
  }

  // --- 星星：按解的先后顺序编号 ---
  if (plan.shard > 0) {
    const slots = shardSlots(path.length, plan.shard);
    let s = 0;
    for (const slot of slots) {
      const v = path[slot];
      if (!claimable(v)) continue;
      let deg = 0;
      for (let k = 0; k < 4; k++) if (rs.nbr[v * 4 + k] >= 0) deg++;
      if (deg < 2) continue;
      rs.typeOf[v] = CoverCell.SHARD;
      rs.groupOf[v] = s;
      used.add(v);
      s++;
      injected++;
    }
  }

  // --- 钥匙门：门在解的位置 i，钥匙在 i 之前 ---
  //
  // ⚠️ **钥匙绝不能放在解的第 0 格**。
  //
  // 第 0 格是「钉死的起点」—— 网格写回时它会被 START 标记覆盖
  // （`grid[flatOf[startAt]] = packCell(START)`），
  // 于是钥匙**凭空消失**：门永远锁着，参考解回放失败，
  // 整盘机制被清零（实测 8x8 盘上有 7 关中招）。
  //
  // 同理，门也不能放在解的最后一格（END 标记会覆盖它）。
  for (let k = 0; k < plan.keygate; k++) {
    // 多次尝试，直到门与钥匙都落在未被占用的**合法**格上
    for (let attempt = 0; attempt < 12; attempt++) {
      const gatePos = 1 + rng.int(0, Math.max(1, Math.floor(path.length * 0.6)));
      // 钥匙位置从 **1** 起（跳过解的第 0 格 = START）
      const keyPos = 1 + rng.int(0, Math.max(1, gatePos - 2));
      if (keyPos >= gatePos) continue;
      const gate = path[gatePos];
      const key = path[keyPos];
      if (!claimable(gate) || !claimable(key) || gate === key) continue;
      rs.typeOf[gate] = CoverCell.GATE;
      rs.groupOf[gate] = k;
      rs.typeOf[key] = CoverCell.KEY;
      rs.groupOf[key] = k;
      used.add(gate);
      used.add(key);
      injected += 2;
      break;
    }
  }

  // --- 传送门：成对格 ---
  //
  // ⚠️ **传送门不能随便挑两个格**。
  //
  // 「进入即传送」语义下，走进传送格 A 的一步会一次吃掉 `[A, B]`。
  // 参考解必须**正好**在这一步从 A 跳到 B —— 否则回放必然失败。
  //
  // 所以传送门格**只能来自 `portalCells`**（由 `splicePortals` 预先算好：
  // 它们是跳跃边的两端，在解里逐位对齐）。
  // 没有 `portalCells` 就**不放**传送门 —— 绝不退化成「随便两格」。
  for (let k = 0; k < plan.portal; k++) {
    const pair = portalCells[k];
    if (!pair) break;
    const [a, b] = pair;
    rs.typeOf[a] = CoverCell.PORTAL;
    rs.groupOf[a] = k;
    rs.typeOf[b] = CoverCell.PORTAL;
    rs.groupOf[b] = k;
    rs.portalOf[a] = b;
    rs.portalOf[b] = a;
    injected += 2;
  }

  rs.hasIce = rs.typeOf.includes(CoverCell.ICE);
  rs.hasPortal = rs.portalOf.some((v) => v >= 0);
  return injected;
}

/**
 * 棋盘指纹：形状（'#' 可走 / 'O' 石头 / '.' 缺口）+ 机制掩码。
 */
export function fingerprintOf(grid: Uint8Array, w: number, h: number): string {
  let s = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = cellType(grid[y * w + x]);
      if (t === CoverCell.BRICK || t === CoverCell.START || t === CoverCell.END) s += '#';
      else if (t === CoverCell.BLOCK) s += 'O';
      else s += '.';
    }
  }

  /**
   * **机制必须按「位置」编码，不能只按「种类」**。
   *
   * v3 初版只记了种类掩码（有哪些机制），于是
   * 「同一个形状 + 同样几种机制但位置不同」的两张盘
   * 指纹完全相同 → 被判成重复棋盘。
   * 实测 300 关里有 20 个重复，全是这个原因。
   *
   * 现在逐格记录机制类型 + 方向 + 组号：
   *   0 = 普通，1 = 单向门，2 = 星星，3 = 钥匙，4 = 门，5 = 传送门，6 = 冰块，
   *   7 = 起点，8 = 终点
   * 附上方向与组号（传送门靠组号配对，钥匙/门靠组号配对）。
   */
  let mech = '';
  for (let i = 0; i < grid.length; i++) {
    const byte = grid[i];
    const t = cellType(byte);
    const dir = (byte >> 2) & 0x3;
    const group = byte & 0x3;
    let code = 0;
    switch (t) {
      case CoverCell.ONEWAY: code = 1; break;
      case CoverCell.SHARD: code = 2; break;
      case CoverCell.KEY: code = 3; break;
      case CoverCell.GATE: code = 4; break;
      case CoverCell.PORTAL: code = 5; break;
      case CoverCell.ICE: code = 6; break;
      case CoverCell.START: code = 7; break;
      case CoverCell.END: code = 8; break;
      default: code = 0; break;
    }
    if (code === 0) {
      mech += '0';
    } else {
      mech += `${code}${dir}${group}`;
    }
  }
  return `${s}|${mech}`;
}

/**
 * 生成单个候选。失败返回 null。
 *
 * @param idx     关号（决定世界与尺寸）
 * @param globalSeed 全局种子
 * @param attempt 尝试序号（换种子用）
 */
export function generateCandidate(
  idx: number,
  globalSeed: number,
  attempt = 0,
): Candidate | null {
  const wp = worldOf(idx);
  const { w, h } = sizeOf(idx);
  const genStart = Date.now();
  const seed = levelSeed(globalSeed, idx) + attempt * 7919;
  const rng = mulberry32(seed);

  /**
   * **家族回退**：随机挑一个家族设计，失败就换下一个。
   *
   * 为什么需要回退：现在 `designShape` 会拒绝「零洞满盘」，
   * 于是某些家族在小盘上**必然失败**（例如 5×5 洞预算只有 2 格时，
   * `corner` 要挖 2×2 = 4 格，超预算 → 永远失败；
   * `scatter`(pairs=0) 挖不出洞 → 永远失败）。
   *
   * 固定用单一家族会白白耗掉 30 次重试（每次还带一次可解性搜索），
   * 实测单关卡要多花 200ms+。
   *
   * 所以：**按随机顺序逐个试家族**，第一个成功的就用。
   * 顺序随机化保证每个家族在整个表里被用到的频率大致均匀。
   */
  const familyOrder = rng.shuffle(wp.families.slice());

  const wantD = dOf(wp.endpoints);
  const budget = holeBudgetOf(idx);
  const designOpts = {
    deadEnds: 0,
    /**
     * **重试次数：8，不是 30**。
     *
     * 每次重试的失败代价是**一次完整的可解性搜索**（`solveDeadlineMs`）。
     * 30 次重试 = 最坏 30 × 60ms = 1.8 秒。
     *
     * 实测：9×9 的 `scatter` 单次调用平均要 97ms —— 也就是「成功之前平均要失败 1~2 次」。
     * 重试 8 次已经足够（家族回退还能兜底），
     * 而且**跨家族共享 150ms 截止时刻**保证总量封顶。
     */
    tries: 8,
    holeRange: [budget.min, budget.max] as [number, number],
    maxHoles: budget.maxHoles,
    // **设计阶段就验证可解性** —— 不可解的形状直接丢弃。
    // 这样 carveFromDesign 几乎不会失败，省掉「回退到从满矩形挖」
    // 那条要几十次完整搜索的路径（实测 9×9 盘上 300~700ms）。
    requireSolvable: true,
    /**
     * **可解性搜索的步数预算：6000**（原 30000）。
     *
     * ## 为什么从 30000 降到 6000
     *
     * 预算只影响**「不可解形状」的证明成本**：
     * 满矩形这类好盘在 80~120 步就出解了，预算再大也没区别；
     * 坏盘面（挖出了碎片）则要烧满整个预算才放弃。
     *
     * 实测（每个家族跑 8 次重试）：
     * | 步数预算 | 9×9 平均耗时 | 10×10 | 11×11 | 成功率 |
     * |---|---|---|---|---|
     * | 30 000 | 217 ms | 268 ms | 429 ms | 100% |
     * | 10 000 | 46 ms  | 42 ms  | 115 ms | 100% |
     * | **6 000** | ~35 ms | ~28 ms | ~90 ms | **100%** |
     *
     * 所以 6000 步是「成功率不降、成本降 4~5 倍」的平衡点。
     * 1000 关全量生产因此从 1041s 降到 ~110s。
     *
     * ## 为什么必须是**步数**预算而不是墙钟
     *
     * 墙钟预算依赖机器速度 —— 同一份种子在快机器上跑满 30000 步、
     * 慢机器上只跑 6000 步 → **产出不同的盘面**（破坏确定性）。
     * 步数预算与硬件无关。
     */
    solveBudget: 6000,
    /**
     * **单次可解性搜索时限：25ms**（仅调试模式生效）。
     *
     * 生产路径传的是「确定性模式」—— `designShape` 收到
     * `deadlineMs` / `totalDeadlineMs` 都为 undefined 时会忽略墙钟，
     * 只用步数预算。
     */
    solveDeadlineMs: 25,
  };

  let design: DesignResult | null = null;
  let family: ShapeFamily = familyOrder[0];
  /**
   * **跨家族共享一个截止时刻**。
   *
   * 每个家族各自开 400ms 的话，4 个家族就是 1.6 秒 —— 1000 关要 26 分钟。
   * 实测瓶颈：9×9 上 `scatter`/`composite` 各要 85~90ms（失败时跑满 30 次重试），
   * 而 `domino` 常常 20ms 就失败。
   *
   * 所以给整个设计阶段一个 **150ms 总预算**：
   * 先试最可能成功的家族，不够就换下一个，但**总时间封顶**。
   *
   * ## ⚠️ 但这会**破坏确定性**
   *
   * 墙钟截止时刻依赖机器速度与负载 —— 同一份种子在快机器上
   * 试满 8 次重试、在慢机器上只试 3 次 → **产出不同的盘面**。
   * 实测：这种非确定性让第 25 关的 grid 与 seed 都对不上。
   *
   * 所以生产路径**不用墙钟**，只用确定性的重试次数 +
   * 家族回退（`tries: 8` × 最多 4 个家族 = 最多 32 次尝试），
   * 总量天然有界。
   */
  for (const fam of familyOrder) {
    design = designShape(w, h, fam, rng, wp.scatterPairs, designOpts);
    if (design) {
      family = fam;
      break;
    }
  }
  if (!design) return null;

  // 2. 挖洞 & 验证（保证可解），同时按需构造死端
  //
  // **把设计阶段求得的解传进去**（`hintPath`）——
  // carve 就不用再搜索一次了，直接走 O(n) 回放检查。
  //
  // 注意：设计阶段的解是**局部编号**，`hintPath` 要求**拍平索引**，
  // 所以这里要转换（`design.cells` 是拍平索引，局部编号 = 在 cells 里的下标）。
  const hintPath =
    design.path && design.path.length === design.cells.length
      ? design.path.map((l) => design.cells[l])
      : null;

  const carve = carveAndVerify(design.cells, w, h, rng, {
    wantDeadEnds: wantD,
    /**
     * **步数预算：8000**（原 40000）。
     *
     * 同理：这只影响「不可解形状」的证明成本。
     * 好盘面在 hint 快路径上直接过（O(n) 回放），
     * 只有坏盘面才会真的搜索 —— 8000 步足够判定「无解」。
     */
    budget: 8000,
    /**
     * **墙钟时限 = 0（不限时）**，保证确定性。
     *
     * 步数预算（`budget: 40000`）才是硬约束 —— 它与硬件无关。
     * 用墙钟会让同一份种子在不同机器上产出**不同的盘面**。
     */
    deadlineMs: 0,
    maxTries: design.cells.length,
    maxFailures: 8,
    /** 洞数上限：家族已挖掉的 + carve 允许的额外量。 */
    maxHoles: budget.maxHoles,
    /** 洞数下限：家族的洞数。 */
    minHoles: design.holeCount,
    /** 设计阶段已得的解 —— 省掉第二次哈密顿搜索。 */
    hintPath,
  });
  if (!carve) return null;

  const cells = carve.cells;
  if (cells.length < 10 || !isConnected(cells, w, h)) return null;

  // 死端 → 局部编号
  const localOf = new Map<number, number>();
  cells.forEach((c, i) => localOf.set(c, i));
  const deadLocals = carve.deadEnds
    .map((c) => localOf.get(c))
    .filter((v): v is number => v !== undefined);
  const startAt = deadLocals.length > 0 ? deadLocals[0] : -1;
  const endAt = deadLocals.length > 1 ? deadLocals[1] : -1;

  // 3. 组装盘面
  const grid = new Uint8Array(w * h);
  const { blocks: finalBlocks } = classifyObstacles(cells, w, h);
  for (const c of cells) grid[c] = packCell(CoverCell.BRICK);
  for (const c of finalBlocks) grid[c] = packCell(CoverCell.BLOCK);

  const rs = buildRuleSet(cells, grid, w, h);
  rs.startAt = startAt;
  rs.endAt = endAt;

  // 4. 参考解
  let path = carve.path;

  // 5. 传送门：2-opt 拼接（**必须在注入机制之前**）
  //
  // 「进入即传送」语义下，走进传送格 A 的一步会一次吃掉 `[A, B]`。
  // 参考解必须**正好**在这一步从 A 跳到 B，否则回放必然失败。
  //
  // 所以顺序是：**先拼接出一条带跳跃的解**，再把传送门放到跳跃的两端。
  // 拼接保证：跳跃边两端在解里**逐位相邻**，与规则的消耗序列完全对齐。
  const plan = mechPlan(wp.mechs, cells.length);
  let portalCells: Array<[number, number]> = [];
  if (plan.portal > 0) {
    const spliced = splicePortals(rs, path, rng, plan.portal);
    // 找不到可行的拼接对 → 这个候选直接作废（换种子重试）。
    if (!spliced) return null;
    path = spliced.path;
    portalCells = spliced.portals.map((p) => [p.entry, p.exit] as [number, number]);
  }

  // 6. 注入机制（传送门格已预留在 `used` 里）
  injectMechanics(rs, path, plan, rng, portalCells);

  // 7. 写回 grid
  for (let i = 0; i < rs.n; i++) {
    const flat = rs.flatOf[i];
    grid[flat] = packCell(rs.typeOf[i], rs.dirOf[i], rs.groupOf[i]);
  }
  if (startAt >= 0) grid[rs.flatOf[startAt]] = packCell(CoverCell.START);
  if (endAt >= 0) grid[rs.flatOf[endAt]] = packCell(CoverCell.END);

  // 8. 完整规则下回放校验
  const rs2 = buildRuleSet(cells, grid, w, h);
  rs2.startAt = startAt;
  rs2.endAt = endAt;
  const rp = replay(rs2, path);
  if (!rp.ok) {
    /**
     * **传送门关卡不能退化成无机制盘面**。
     *
     * 旧逻辑在回放失败时把整盘机制清零（变成普通砖块）——
     * 对传送门关卡来说，这等于「这一关没有传送门」，
     * 而世界 5 的卖点恰恰是传送门。
     *
     * 传送门关卡的参考解是**专门拼接**出来的，回放本该必然通过；
     * 失败说明有 bug 或规则不一致 —— 宁可丢掉这个候选，
     * 也不能发出一关「名义上有传送门、实际没有」的关卡。
     */
    if (plan.portal > 0) return null;
    // 机制注入破坏了参考解（例如冰块滑行消耗了路径之外的格）→
    // 退化为无机制的盘面。**必须重建规则集**，否则拿旧的 rs2 回放仍会失败。
    for (let i = 0; i < rs.n; i++) {
      rs.typeOf[i] = CoverCell.BRICK;
      rs.dirOf[i] = 0;
      rs.groupOf[i] = 0;
    }
    for (const c of cells) grid[c] = packCell(CoverCell.BRICK);
    for (const c of finalBlocks) grid[c] = packCell(CoverCell.BLOCK);
    if (startAt >= 0) grid[rs.flatOf[startAt]] = packCell(CoverCell.START);
    if (endAt >= 0) grid[rs.flatOf[endAt]] = packCell(CoverCell.END);
    const rsClean = buildRuleSet(cells, grid, w, h);
    rsClean.startAt = startAt;
    rsClean.endAt = endAt;
    const rp2 = replay(rsClean, path);
    if (!rp2.ok) return null;
    // 用干净的规则集继续（度量必须与最终 grid 一致）
    Object.assign(rs2, rsClean);
  }

  // 8. 度量 + 打分
  const metrics = measure(rs2, path);
  // 解数估计：纯网格模式下剪枝始终有效，实测 ~1ms/关。
  // 它是难度的核心指标（唯一性），必须在候选阶段就算出来，
  // 否则池子按难度分层时用的都是「未知解数」的粗估。
  //
  // **重试次数 4 / 时限 0**（0 = 不限时，保证确定性）：
  // 参考解已经作为样本计入（`knownSolution`），保证 `hits >= 1`，
  // 所以采样数不需要多 —— 4 次足以估计「几个解」这个量级。
  // 实测大盘上这一步从 25ms/候选降到 8ms，
  // 1000 关总共省下 ~25 秒。
  //
  // **时限必须传 0**（不限时）：墙钟会让同一份种子在不同机器上
  // 采到不同数量的解 → 难度不同 → 盘面不同（破坏确定性）。
  const est = estimateSolutions(
    rs2,
    2,
    0,
    seed,
    rs2.localOf[rs2.flatOf[path[0]]],
    false,
    path,
  );
  metrics.solutionCount = est.count;
  const range = sizeRange();
  const ctx: DiffContext = {
    mechTerm: mechTermOf(wp.mechs, cells.length),
    baitTerm: Math.min(1, metrics.maxBaitDepth / 6),
    // 规模归一区间跟着当前尺寸配置走 —— 见 `sizeRange` 的说明。
    sizeFloor: range.floor,
    sizeCeil: range.ceil,
    // 世界项：难度阶梯的位置。见 `DiffContext.worldTerm` 的说明。
    worldTerm: worldTermOf(idx),
  };
  const diff = computeDiff(metrics, ctx);

  return {
    idx,
    seed,
    w,
    h,
    grid,
    required: cells.length,
    solution: path,
    solutionFlat: path.map((i) => rs2.flatOf[i]),
    metrics,
    diff,
    deadEnds: deadLocals.length,
    deadEndCells: metrics.deadEnds,
    mechKinds: metrics.mechKinds,
    startAt,
    endAt,
    fingerprint: fingerprintOf(grid, w, h),
    fingerprintRepeat: 0,
    family,
    holeCount: w * h - cells.length,
    genMs: Date.now() - genStart,
  };
}

/** 生成一关（内部重试）。失败返回 null。 */
export function generateLevel(idx: number, globalSeed: number): Candidate | null {
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = generateCandidate(idx, globalSeed, attempt);
    if (c) return c;
  }
  return null;
}
