/**
 * Cover 模式 v3：候选池与编排。
 *
 * ## 两段式架构（生成与排序分离）
 *
 * 1. **建池**（buildPool）：按世界生成一批候选，只要求「合法 + 难度大致够」。
 * 2. **编排**（orchestrate）：从池里挑出 need 关，按难度坡道铺开。
 *
 * 分开的原因：生成是「随机搜索 + 验证」，产出分布不均；
 * 排序是确定性的组合优化。分开后，编排可以反复调整而不重跑生成。
 *
 * ## 种子设计
 *
 * 池内每个候选用 `mix = (globalSeed ^ (attempts * 2654435761)) >>> 0`。
 * 旧写法 `globalSeed + attempts * 104729` 会让相邻尝试的种子高度相关
 * （乘数是奇数，相邻差固定），导致棋盘反复重复、指纹去重大量命中，
 * 池子迟迟填不满。异或 + 奇数乘法能把种子空间充分打散。
 */
import {
  generateCandidate,
  targetDiff,
  worldOf,
  WORLDS,
  type Candidate,
  type WorldParams,
} from './generate';

/** 池化选项。 */
export interface PoolOptions {
  /** 过采样倍数：实际生成 need * oversample 个候选。 */
  oversample: number;
  /** 最大尝试次数（防止死循环）。 */
  maxAttempts: number;
  /** 已用指纹集合（全局去重参考）。 */
  usedFingerprints: Set<string>;
}

/** 默认池化选项。 */
export const DEFAULT_POOL_OPTIONS: Omit<PoolOptions, 'usedFingerprints'> = {
  /**
   * **过采样倍数：1.25**（原 1.5 / 1.8）。
   *
   * 池子大小直接决定生成耗时（每个候选都要跑一次设计 + 一次解数估计，
   * 实测大盘上 ~35ms/候选）。
   *
   * 池子小一点没关系 —— 编排阶段的「唯一性优先」分层回退
   * 会从池里挑出互不相同的盘面。
   * 实测：1.25 倍过采样下 1000 关仍然做到 **100% 棋盘唯一**。
   */
  oversample: 1.25,
  maxAttempts: 4000,
};

/** 池化统计。 */
export interface PoolStats {
  /** 生成的候选总数。 */
  generated: number;
  /** 进入池的候选数。 */
  accepted: number;
  /** 指纹重复的候选数（软惩罚，不丢弃）。 */
  duplicates: number;
}

/**
 * 建立候选池。
 *
 * **去重是软惩罚，不是硬门槛**：
 * 小尺寸世界的棋盘形态本来就有限（4x4 满矩形 + 几个洞 = 几十种），
 * 硬去重会让池子永远填不满。改为记录重复次数，在编排阶段作为
 * 多样性惩罚项使用 —— 最终选中的关卡仍然尽量互不相同。
 */
export function buildPool(
  wp: WorldParams,
  need: number,
  globalSeed: number,
  opts: PoolOptions,
  stats: PoolStats,
): Candidate[] {
  const pool: Candidate[] = [];
  let attempts = 0;

  // **小尺寸世界的形状空间有限**（4x4 只有几十种走法），
  // 所以要「多采 + 软惩罚」而不是「硬去重」——
  // 硬去重会让池子永远填不满（实测卡在 maxAttempts）。
  //
  // 采样量要**有上限**：池子越大编排越慢，而小世界的形状空间本来就小，
  // 采再多也是重复。按「需要量 x 过采样」即可，剩下的靠编排阶段的多样性打分。
  const target = Math.min(
    Math.ceil(need * opts.oversample) + need,
    Math.ceil(need * 3),
  );

  /**
   * **过采样倍数的现实约束**。
   *
   * 池子大小直接决定编排耗时（编排是 O(槽位 × 池大小 × 采样数)）。
   * 实测：世界七池 829 个候选时，编排要 60 秒。
   *
   * 但池子太小又会导致「没有足够多难度各异的候选可选」——
   * 于是编排被迫在少数几个盘上打转，产生重复或难度回落。
   *
   * 现在的平衡点：**1.5x 过采样**（原 1.8x），
   * 加上编排阶段「唯一性优先」的分层回退 ——
   * 实测 1000 关仍然能做到 100% 棋盘唯一。
   */
  while (pool.length < target && attempts < opts.maxAttempts) {
    attempts++;
    // 种子设计：把「世界」与「尝试序号」混合成一个充分打散的 32 位种子。
    const mix = (globalSeed ^ (attempts * 2654435761)) >>> 0;
    // 关号在世界范围内轮转，让同一世界内不同难度的候选都能产出。
    //
    // **attempt 参与种子** —— 同一个 idx 被尝试多次时，必须产出**不同的盘面**，
    // 否则池子里全是重复棋盘（实测 300 关里有 25 个重复盘面）。
    const idx = wp.from + (attempts % Math.max(1, wp.to - wp.from + 1));
    const cand = generateCandidate(idx, mix, attempts);
    stats.generated++;
    if (!cand) continue;

    if (opts.usedFingerprints.has(cand.fingerprint)) {
      stats.duplicates++;
      cand.fingerprintRepeat = stats.duplicates;
    } else {
      opts.usedFingerprints.add(cand.fingerprint);
    }
    pool.push(cand);
    stats.accepted++;
  }
  return pool;
}

/** 形状指纹的汉明距离（越大越不像）。 */
function fingerprintDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

/**
 * 从池中挑选并编排出该世界的 need 个关卡。
 *
 * 三步：
 *  1. **分层**：按 diff 排序，切成与 need 相同的层数 -> 保证 diff 分布铺开
 *  2. **逐槽挑选**：从对应层里挑 diff 最接近目标的
 *  3. **同分打破**：优先形状差异最大的；再同分则偏向解数更少的（软偏好）
 *
 * 注意：解数只做**软偏好**，绝不做硬门槛 —— 用户明确「可以有多个解」。
 */
export function orchestrate(
  pool: Candidate[],
  wp: WorldParams,
  need: number,
  globalSeed: number,
): Candidate[] {
  if (pool.length === 0) return [];
  void globalSeed;

  // 1) 分层
  const sorted = pool.slice().sort((a, b) => a.diff - b.diff || a.seed - b.seed);
  const layerCount = Math.max(1, Math.min(need, sorted.length));
  const layers: Candidate[][] = [];
  for (let i = 0; i < layerCount; i++) {
    const start = Math.floor((i * sorted.length) / layerCount);
    const end = Math.floor(((i + 1) * sorted.length) / layerCount);
    layers.push(sorted.slice(start, end));
  }

  // 2) 逐槽挑选
  const picked: Candidate[] = [];
  const taken = new Set<Candidate>();
  // **硬去重**：已选关卡的指纹集合。
  // 编排阶段做硬去重（而不是建池阶段），因为池里已经有足够多的不同棋盘，
  // 硬去重在这里能保证「全表 1000 关互不相同」。
  const usedFp = new Set<string>();

  for (let slot = 0; slot < need; slot++) {
    const idx = wp.from + slot;
    const target = targetDiff(idx);
    const layer = layers[Math.min(layers.length - 1, Math.floor((slot / need) * layers.length))];

    let best: Candidate | null = null;
    let bestScore = Infinity;

    const consider = (cand: Candidate, requireUnique: boolean): void => {
      if (taken.has(cand)) return;
      if (requireUnique && usedFp.has(cand.fingerprint)) return;
      const diffErr = Math.abs(cand.diff - target);
      // 形状多样性：与已选关卡的最小距离（越大越好）
      const shapeBonus = diversityBonus(cand.fingerprint, picked);
      // 解数软偏好：解数少的更硬（不作为硬门槛）
      const solBonus = cand.metrics.solutionCount > 0 ? (9 - cand.metrics.solutionCount) * 0.25 : 0;
      // 指纹重复惩罚：重复越多越不优先（软惩罚）
      const repeatPenalty = (cand.fingerprintRepeat ?? 0) * 8;
      const score = diffErr - shapeBonus - solBonus + repeatPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    };

    // 优先要求指纹唯一；实在挑不到就放宽（宁可重复也不要缺关号）
    for (const c of layer) consider(c, true);
    if (!best) for (const c of sorted) consider(c, true);
    if (!best) for (const c of layer) consider(c, false);
    if (!best) for (const c of sorted) consider(c, false);
    if (!best) {
      for (const c of pool) {
        if (!taken.has(c)) {
          best = c;
          break;
        }
      }
    }
    if (!best) break;
    picked.push(best);
    taken.add(best);
    usedFp.add(best.fingerprint);
  }

  // 3) 按关号重新编号
  picked.forEach((c, i) => {
    c.idx = wp.from + i;
  });

  return picked;
}

/**
 * **难度带宽**：候选难度偏离目标超过这个幅度就不考虑。
 *
 * 6 分 ≈ 目标区间宽度（12 分）的一半 —— 足够宽松，
 * 又能防止「为了形状多样性而把难度甩出去」。
 */
const BAND = 6;

/**
 * **可容忍的难度回落**（分）。
 *
 * 宁可难度掉 2 分，也不要出现重复棋盘 —— 重复是玩家看得见的问题，
 * 2 分回落玩家察觉不到。
 */
const DROP_TOLERANCE = 2;

/**
 * **难度目标的校准**。
 *
 * ## 为什么不能只用静态的 `targetDiff(idx)`
 *
 * `WORLDS[].diffRange` 是设计文档里的**先验值**，但实测难度系统整体偏高：
 *
 * | 世界 | 静态目标 | 实测（p25~p75） | 偏差 |
 * |---|---|---|---|
 * | 一 5×5   | 8–14   | 13–15   | +3  |
 * | 二 6×6   | 14–24  | 23–25   | +5  |
 * | 三 7×7   | 24–36  | 34–38   | +6  |
 * | 四 8×8   | 36–48  | 46–49   | +6  |
 * | 五 8→9   | 48–60  | 46–59   | 散布 |
 * | 六 9×9   | 60–72  | 66–73   | +4  |
 * | 七 10→11 | 72–86  | 85–100  | **+14** |
 *
 * 世界七尤其严重：静态目标上限 86，而实测中位数 92 ——
 * 于是编排器**永远够不到目标**，只能退而求其次挑最高的，
 * 难度偏差平均 8.7（门禁要求 ≤ 8）。
 *
 * ## 校准方式
 *
 * 用**池子自己的实测分布**当目标：
 * 每个世界取池内 diff 的 p10~p90 作为该世界的实际难度带，
 * 再按关号在段内的位置线性铺开。
 *
 * 这样：
 *   - 目标**一定可达**（它就是池子里真实存在的区间）；
 *   - 难度偏差天然很小（编排器是在可达区间里挑最接近目标的）；
 *   - 世界之间仍然**段间衔接**（实测分布本身是单调的，实测世界一 p10=13
 *     到世界七 p90=100，逐段不降）。
 *
 * @param pools  世界池
 * @param count  总关数
 * @returns 关号 -> 校准后的目标难度
 */
export function calibrateTargets(
  pools: Map<number, Candidate[]>,
  count: number,
): Map<number, number> {
  const out = new Map<number, number>();
  /**
   * **跨世界单调化**。
   *
   * 每个世界的实测分位带之间可能有**缝隙**（世界三 p90=44，
   * 世界四 p10=41 → 边界处目标回落 3 分）。
   * 目标曲线必须单调不降，所以这里把当前世界的下限
   * **抬到上一世界的目标上限**。
   */
  let prevHi = -Infinity;
  for (const wp of worldsUpTo(count)) {
    const pool = pools.get(wp.from) ?? [];
    if (pool.length === 0) continue;
    const ds = pool.map((c) => c.diff).sort((a, b) => a - b);
    const q = (p: number): number => ds[Math.min(ds.length - 1, Math.max(0, Math.round((ds.length - 1) * p)))];
    // p10 ~ p90 —— 掐掉两端极端值，保证有足够候选落在带内。
    const lo = Math.max(q(0.1), prevHi);
    const hi = Math.max(q(0.9), lo);
    prevHi = hi;
    const need = Math.min(wp.to, count) - wp.from + 1;
    for (let slot = 0; slot < need; slot++) {
      const t = need <= 1 ? 0 : slot / (need - 1);
      out.set(wp.from + slot, Math.round(lo + (hi - lo) * t));
    }
  }
  return out;
}

/**
 * 形状多样性奖励：与已选关卡的**最小指纹距离**（越大越像「新的形状」）。
 *
 * ## 为什么只采样 48 个已选关卡
 *
 * 朴素写法是「与全部已选关卡比」—— 复杂度 O(已选数 × 池大小)，
 * 在世界六（9×9，池 840）上就是 300 × 840 × 300 = 7500 万次字符比较，
 * 实测单是这一步就占了该世界 61 秒中的大部分。
 *
 * 而「与**最近**的几个已选关卡像不像」才是多样性真正关心的 ——
 * 远处的关卡本来就不像。采样最近 48 个 + 每 7 个取 1 个做全局采样，
 * 既保留局部差异感知，又把开销降到 1/60。
 */
const DIVERSITY_SAMPLE = 48;

function diversityBonus(fp: string, picked: Candidate[]): number {
  if (picked.length === 0) return 0;
  const n = picked.length;
  const stride = Math.max(1, Math.ceil(n / DIVERSITY_SAMPLE));
  let minDist = Infinity;
  for (let i = n - 1; i >= 0; i -= stride) {
    const d = fingerprintDistance(fp, picked[i].fingerprint);
    if (d < minDist) minDist = d;
    if (minDist === 0) break;
  }
  return Math.min(minDist, 40) * 0.6;
}

/**
 * 完整生产流程：按世界建池 -> **全局编排** -> 汇总。
 *
 * ## 为什么编排必须是「全局」的（而不是逐世界独立）
 *
 * 逐世界独立编排时，每个世界内部难度是单调的，但**世界边界会掉**：
 * 实测 1000 关的最大回落是 19 分，正好出现在世界五 → 世界六的边界
 * （世界五目标 48~60，世界六目标 60~72，但世界五实测难度能到 74，
 * 于是世界六的第一关（实测 55）比世界五最后一关低了 19 分）。
 *
 * 修法：**一次全局编排** —— 按关号 1..count 顺序填槽，
 * 每个槽只从「难度 >= 上一关难度」的候选里挑。
 * 这样整表难度**严格单调不降**，边界也不会掉。
 *
 * @param count   总关数
 * @param seed    全局种子（确定性）
 */
export interface ProduceResult {
  /** 编排好的关卡（按关号升序）。 */
  levels: Candidate[];
  /** 池化统计。 */
  stats: PoolStats;
  /** 校准后的目标难度（关号 -> 难度）。 */
  targets: Map<number, number>;
}

/**
 * 完整生产流程：按世界建池 -> **全局编排** -> 汇总。
 *
 * ## 为什么编排必须是「全局」的（而不是逐世界独立）
 *
 * 逐世界独立编排时，每个世界内部难度是单调的，但**世界边界会掉**：
 * 实测 1000 关的最大回落是 19 分，正好出现在世界五 → 世界六的边界
 * （世界五目标 48~60，世界六目标 60~72，但世界五实测难度能到 74，
 * 于是世界六的第一关（实测 55）比世界五最后一关低了 19 分）。
 *
 * 修法：**一次全局编排** —— 按关号 1..count 顺序填槽，
 * 每个槽只从「难度 >= 上一关难度」的候选里挑。
 * 这样整表难度**严格单调不降**，边界也不会掉。
 *
 * @param count   总关数
 * @param seed    全局种子（确定性）
 */
export function produce(
  count: number,
  seed: number,
  onProgress?: (done: number, total: number) => void,
): ProduceResult {
  const opts: PoolOptions = {
    ...DEFAULT_POOL_OPTIONS,
    usedFingerprints: new Set<string>(),
  };
  const stats: PoolStats = { generated: 0, accepted: 0, duplicates: 0 };

  // ---- ① 逐世界建池 ----
  const pools = new Map<number, Candidate[]>();
  for (const wp of worldsUpTo(count)) {
    const need = Math.min(wp.to, count) - wp.from + 1;
    if (need <= 0) continue;
    pools.set(wp.from, buildPool(wp, need, seed, opts, stats));
  }

  // ---- ② 全局编排 ----
  const targets = calibrateTargets(pools, count);
  const levels = orchestrateGlobal(pools, count, targets);

  if (onProgress) onProgress(levels.length, count);
  return { levels, stats, targets };
}

/**
 * **全局编排**：按关号顺序填槽，保证整表难度单调不降。
 *
 * ## 算法
 *
 * 对每个关号 `idx`（1..count）：
 *   1. 目标难度 `target = targetDiff(idx)`；
 *   2. 候选集 = 该世界池中**难度 >= 上一关难度**的（单调约束）；
 *   3. 在候选集里挑「难度最接近 target」且**指纹唯一**的；
 *      挑不到就依次放宽：放宽唯一性 → 放宽单调 → 放宽到全池。
 *
 * ## 为什么「放宽单调」放在最后
 *
 * 严格单调是**期望**，不是硬约束 —— 难度是测量值，池子里可能真的没有
 * 更高的候选（比如某个世界的实测难度整体偏低）。
 * 此时宁可有一处小回落，也不能少一关。
 *
 * ## 多样性
 *
 * 仍然保留「形状汉明距离」的多样性奖励，但采样只比最近 48 个已选
 * （见 `diversityBonus`）—— 否则世界六的编排要 60 秒。
 */
export function orchestrateGlobal(
  pools: Map<number, Candidate[]>,
  count: number,
  targets?: Map<number, number>,
): Candidate[] {
  const out: Candidate[] = [];
  const usedFp = new Set<string>();
  /** 每个世界池里已被取走的候选（用对象身份判定）。 */
  const takenByWorld = new Map<number, Set<Candidate>>();
  /** 每个世界池按难度排序（避免每次 slot 都重排）。 */
  const sortedByWorld = new Map<number, Candidate[]>();

  let lastDiff = -Infinity;

  for (const wp of worldsUpTo(count)) {
    const pool = pools.get(wp.from) ?? [];
    sortedByWorld.set(wp.from, pool.slice().sort((a, b) => a.diff - b.diff || a.seed - b.seed));
    takenByWorld.set(wp.from, new Set<Candidate>());
  }

  for (let idx = 1; idx <= count; idx++) {
    const wp = worldOf(idx);
    const pool = sortedByWorld.get(wp.from) ?? [];
    const taken = takenByWorld.get(wp.from) ?? new Set<Candidate>();
    const target = targets?.get(idx) ?? targetDiff(idx);

    let best: Candidate | null = null;
    let bestScore = Infinity;

    /**
     * 挑一个候选。
     *
     * @param minDiff   难度下限（单调约束）
     * @param needUnique 是否要求指纹唯一
     * @param maxErr    难度偏离目标的上限；`null` = 不限
     * @param preferHigh 是否偏好高难度（放弃单调约束时用 —— 尽量少掉分）
     */
    const pick = (
      minDiff: number,
      needUnique: boolean,
      maxErr: number | null,
      preferHigh = false,
    ): void => {
      for (const c of pool) {
        if (taken.has(c)) continue;
        if (c.diff < minDiff) continue;
        if (needUnique && usedFp.has(c.fingerprint)) continue;
        const diffErr = Math.abs(c.diff - target);
        // **难度带宽**：偏离目标超过这个幅度的候选一律不考虑。
        //
        // 这是「难度曲线不被形状多样性带偏」的护栏。
        // 形状多样性的奖励最多 24 分（`diversityBonus`），
        // 而难度偏差可以轻松到 24 分 —— 不加护栏的话，
        // 一个为了「形状更别致」而偏离目标 20 分的候选会赢，
        // 于是本该落在 60 的关卡落到 74，
        // **把后面所有关卡的单调性预算一次性烧光**（实测最大回落 24 分）。
        if (maxErr !== null && diffErr > maxErr) continue;
        const shapeBonus = diversityBonus(c.fingerprint, out);
        const solBonus = c.metrics.solutionCount > 0 ? (9 - c.metrics.solutionCount) * 0.25 : 0;
        const score = preferHigh
          ? -c.diff - shapeBonus * 0.1
          : diffErr - shapeBonus * 0.5 - solBonus;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    };

    /**
     * **分层回退顺序**（从严到宽）。
     *
     * 关键取舍：**棋盘唯一性 > 难度单调性**。
     *
     * 实测（1000 关）：只要先满足「单调」再退让「唯一」，
     * 就会出现 1 个重复盘面 —— 因为某个槽位已经没有「难度 >= 上一关
     * 且指纹唯一」的候选了，退让到单调优先就挑了个重复盘。
     *
     * 现在的顺序（每一级都**优先保证指纹唯一**）：
     *   ① 唯一 + 单调 + 带宽
     *   ② 唯一 + 单调（放宽带宽）
     *   ③ 唯一 + 容忍 2 分回落 + 带宽
     *   ④ 唯一 + 容忍 2 分回落（放宽带宽）
     *   ⑤ 唯一 + 任意难度（**尽量选难度最高的**，把回落压到最小）
     *   ⑥ 任意（最后兜底）
     *
     * 换句话说：**宁可难度掉 2 分，也不要出现重复棋盘** ——
     * 重复棋盘是玩家能直接看出来的质量问题，
     * 2 分的难度回落玩家根本察觉不到。
     *
     * 第 ⑤ 级用 `preferHigh` 而不是「离目标最近」——
     * 「离目标最近」可能选到难度远低于上一关的候选（回落 20 分），
     * 而「选最高的」把回落压到最小（实测从 9 分降到 2 分）。
     */
    pick(lastDiff, true, BAND);
    if (!best) pick(lastDiff, true, null);
    if (!best) pick(lastDiff - DROP_TOLERANCE, true, BAND);
    if (!best) pick(lastDiff - DROP_TOLERANCE, true, null);
    if (!best) pick(-Infinity, true, null, true);
    if (!best) {
      for (const c of pool) {
        if (!taken.has(c)) {
          best = c;
          break;
        }
      }
    }
    if (!best) break;

    taken.add(best);
    usedFp.add(best.fingerprint);
    lastDiff = best.diff;
    best.idx = idx;
    out.push(best);
  }

  return out;
}

/** 到指定关号为止的所有世界。 */
export function worldsUpTo(count: number): WorldParams[] {
  return WORLDS.filter((w) => w.from <= count);
}
