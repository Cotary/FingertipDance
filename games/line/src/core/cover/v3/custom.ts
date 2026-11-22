/**
 * Cover 模式 v3：**参数驱动**生成器。
 *
 * ## 与 `generate.ts` 的关系
 *
 * `generate.ts` 是**世界驱动**的：7 个世界，每个世界写死尺寸阶梯、
 * 机制清单、端点固定度、洞预算比例。改这些要改代码。
 *
 * 本文件是**参数驱动**的：调用方直接给「尺寸范围 + 每种障碍的数量范围」，
 * 产出符合这些约束的关卡。给 UI 用 —— 用户在表单里填什么，就生成什么。
 *
 * ## 复用而非重写
 *
 * 底层四步完全复用现有实现，**没有另写一套生成逻辑**：
 *
 *   1. `designShape`  → 挖洞（保证奇偶中性 + 连通）
 *   2. `carveAndVerify` → 验证可解（暴力哈密顿搜索）
 *   3. `injectMechanics` → 在**已验证的解上**注入机制
 *   4. `replay` → 完整规则下回放校验
 *
 * 所以这里只做三件事：
 *   - 把「UI 参数」翻译成上面四步的输入；
 *   - 按用户指定的数量注入机制（而不是按世界配方）；
 *   - 把随机尺寸/数量的范围摊到每一关上。
 */
import { mulberry32, type Rng } from '../../rng';
import { designShape, isConnected, type ShapeFamily } from './design';
import { carveAndVerify } from './carve';
import { computeDiff, measure, type DiffContext, type Metrics } from './metrics';
import { buildRuleSet, replay, type RuleSet } from './rules';
import { estimateSolutions } from './solcount';
import { splicePortals } from './portal';
import { CoverCell, cellType, packCell } from './types';
import { classifyObstacles, fingerprintOf } from './generate';

/** 机制种类（与 `generate.ts` 的 `MechKind` 同名同义）。 */
export type CustomMech = 'oneway' | 'shard' | 'keygate' | 'portal' | 'ice';

/**
 * 一个「数量范围」。
 *
 * 生成每一关时在这个区间里取一个整数（含两端）。
 * 用区间而不是定值，是为了「同一个配置生成一批关卡，盘面各不相同」——
 * 定值会让每一关的机制布局高度雷同。
 */
export interface CountRange {
  min: number;
  max: number;
}

/** 生成参数。 */
export interface CustomGenParams {
  /** 生成关卡数。 */
  count: number;
  /** 宽度（格子长）范围。 */
  w: CountRange;
  /** 高度（格子宽）范围。 */
  h: CountRange;
  /** 障碍（石头/缺口）数量范围 —— 挖掉的格数。 */
  holes: CountRange;
  /** 单向门数量范围。 */
  oneway: CountRange;
  /** 星星数量范围。 */
  shard: CountRange;
  /** 钥匙门（门 + 钥匙成对）数量范围。 */
  keygate: CountRange;
  /** 传送门数量范围（**对数**，一对占 2 格）。 */
  portal: CountRange;
  /** 冰块数量范围。 */
  ice: CountRange;
  /**
   * 起点固定度。
   *
   * - `free`：起终点自由（玩家自选）。
   * - `start`：钉死起点。
   * - `both`：起终点都钉死。
   */
  endpoints: 'free' | 'start' | 'both';
  /** 全局种子（同种子同结果，可复现）。 */
  seed: number;
}

/** 默认参数（对应 UI 的初始表单状态）。 */
export const DEFAULT_CUSTOM_PARAMS: CustomGenParams = {
  count: 20,
  w: { min: 5, max: 5 },
  h: { min: 6, max: 6 },
  holes: { min: 2, max: 6 },
  oneway: { min: 0, max: 0 },
  shard: { min: 0, max: 0 },
  keygate: { min: 0, max: 0 },
  portal: { min: 0, max: 0 },
  ice: { min: 0, max: 0 },
  endpoints: 'free',
  seed: 20261115,
};

/** 一张生成好的关卡（带解）。 */
export interface CustomLevel {
  idx: number;
  seed: number;
  w: number;
  h: number;
  /** 盘面编码（每格 1 字节：(type<<4)|(dir<<2)|group）。 */
  grid: Uint8Array;
  /** 可走格数。 */
  required: number;
  /** 参考解（拍平索引序列）。 */
  solution: number[];
  /** 起点拍平索引（-1 = 自由）。 */
  startAt: number;
  /** 终点拍平索引（-1 = 自由）。 */
  endAt: number;
  /** 难度分 0..100。 */
  diff: number;
  /** 度量结果。 */
  metrics: Metrics;
  /** 机制种类数。 */
  mechKinds: number;
  /** 棋盘指纹。 */
  fingerprint: string;
  /** 生成耗时（ms）。 */
  genMs: number;
}

/** 形状家族池（自定义生成用全部家族，按随机顺序试）。 */
const FAMILIES: ShapeFamily[] = [
  'domino', 'notch', 'corner', 'scatter', 'island', 'composite', 'hole', 'lshape',
];

/** 端点固定度 → 需要的死端数（D）。 */
function wantDeadEnds(mode: CustomGenParams['endpoints']): number {
  return mode === 'free' ? 0 : mode === 'start' ? 1 : 2;
}

/** 从范围里取一个整数（含两端）。 */
function pickInRange(r: CountRange, rng: Rng): number {
  const lo = Math.max(0, Math.round(r.min));
  const hi = Math.max(lo, Math.round(r.max));
  return lo + rng.int(0, hi - lo + 1);
}

/**
 * 把「挖洞数」换算成形状家族能接受的洞预算。
 *
 * 形状家族的最小挖洞单位是 2 格（骨牌），所以洞数必须是偶数 ——
 * 否则奇偶中性被破坏（`|B − W| ≤ 1` 不成立），盘面直接无解。
 *
 * 所以这里取**就近偶数**，并且向上取（宁可多挖一格也别破坏奇偶）。
 */
function evenHoles(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

/**
 * 生成一关。
 *
 * @returns 生成失败（形状不可解）返回 null。
 */
function generateOne(
  idx: number,
  params: CustomGenParams,
  seed: number,
): CustomLevel | null {
  const t0 = Date.now();
  const rng = mulberry32(seed);

  const w = pickInRange(params.w, rng);
  const h = pickInRange(params.h, rng);

  // 洞预算：必须偶数，且不超过「留够可走格」的上限。
  const maxHoles = Math.max(0, w * h - 12);
  const wantHoles = Math.min(maxHoles, evenHoles(pickInRange(params.holes, rng)));

  /**
   * **洞数为 0 时用满矩形**。
   *
   * 形状家族在 `holeRange[1] >= 2` 时会拒绝「零洞」盘面
   * （`design.ts` 的「禁止零洞满盘」规则）—— 那是为**世界阶梯**设计的
   * （避免整个世界长得一模一样）。这里用户明确要 0 个障碍，就该给满矩形。
   */
  const holeRange: [number, number] =
    wantHoles <= 0 ? [0, 0] : [Math.max(2, wantHoles - 2), wantHoles];

  // 形状家族按随机顺序试 —— 第一个成功的就是它。
  const familyOrder = rng.shuffle(FAMILIES.slice());
  let design = null;
  for (const fam of familyOrder) {
    design = designShape(w, h, fam, rng, 2, {
      deadEnds: 0,
      tries: 6,
      holeRange,
      maxHoles: wantHoles,
      requireSolvable: true,
      solveBudget: 6000,
    });
    if (design) break;
  }
  if (!design) return null;

  // 死端构造（钉死起点/终点用）。
  //
  // 死端是「度 = 1」的格 —— 哈密顿路径的端点必然是死端，
  // 所以要钉死起点就得在盘面上**造出**死端来。
  const wantD = wantDeadEnds(params.endpoints);
  const hintPath =
    design.path && design.path.length === design.cells.length
      ? design.path.map((l) => design.cells[l])
      : null;

  const carve = carveAndVerify(design.cells, w, h, rng, {
    wantDeadEnds: wantD,
    budget: 8000,
    deadlineMs: 0,
    maxTries: design.cells.length,
    maxFailures: 8,
    maxHoles: wantHoles,
    minHoles: design.holeCount,
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

  // 组装盘面
  const grid = new Uint8Array(w * h);
  const { blocks: finalBlocks } = classifyObstacles(cells, w, h);
  for (const c of cells) grid[c] = packCell(CoverCell.BRICK);
  for (const c of finalBlocks) grid[c] = packCell(CoverCell.BLOCK);

  const rs = buildRuleSet(cells, grid, w, h);
  rs.startAt = startAt;
  rs.endAt = endAt;

  let path = carve.path;

  // 注入机制（**按用户指定的数量**，而不是世界配方）
  const plan = {
    oneway: pickInRange(params.oneway, rng),
    shard: pickInRange(params.shard, rng),
    keygate: pickInRange(params.keygate, rng),
    portal: pickInRange(params.portal, rng),
    ice: pickInRange(params.ice, rng),
  };

  // 传送门：2-opt 拼接（**必须在注入机制之前**）—— 理由同 `generate.ts`。
  let portalCells: Array<[number, number]> = [];
  if (plan.portal > 0) {
    const spliced = splicePortals(rs, path, rng, plan.portal);
    if (!spliced) return null;
    path = spliced.path;
    portalCells = spliced.portals.map((p) => [p.entry, p.exit] as [number, number]);
  }

  injectCustomMechanics(rs, path, plan, rng, portalCells);

  // 写回 grid
  for (let i = 0; i < rs.n; i++) {
    const flat = rs.flatOf[i];
    grid[flat] = packCell(rs.typeOf[i], rs.dirOf[i], rs.groupOf[i]);
  }
  if (startAt >= 0) grid[rs.flatOf[startAt]] = packCell(CoverCell.START);
  if (endAt >= 0) grid[rs.flatOf[endAt]] = packCell(CoverCell.END);

  // 完整规则下回放校验
  let rs2 = buildRuleSet(cells, grid, w, h);
  rs2.startAt = startAt;
  rs2.endAt = endAt;
  const rp = replay(rs2, path);
  if (!rp.ok) {
    /**
     * **传送门关卡不能退化成无机制盘面** ——
     * 那等于「这一关名义上有传送门、实际没有」。
     * 宁可丢掉候选。
     */
    if (plan.portal > 0) return null;
    // 机制注入破坏了参考解 → 清空机制重来一遍。
    // **必须重建规则集**，否则拿旧的 rs2 回放仍会失败。
    for (let i = 0; i < rs.n; i++) {
      rs.typeOf[i] = CoverCell.BRICK;
      rs.dirOf[i] = 0;
      rs.groupOf[i] = 0;
    }
    for (const c of cells) grid[c] = packCell(CoverCell.BRICK);
    for (const c of finalBlocks) grid[c] = packCell(CoverCell.BLOCK);
    if (startAt >= 0) grid[rs.flatOf[startAt]] = packCell(CoverCell.START);
    if (endAt >= 0) grid[rs.flatOf[endAt]] = packCell(CoverCell.END);
    rs2 = buildRuleSet(cells, grid, w, h);
    rs2.startAt = startAt;
    rs2.endAt = endAt;
    const rp2 = replay(rs2, path);
    if (!rp2.ok) return null;
  }

  // 度量 + 打分
  const metrics = measure(rs2, path);
  const est = estimateSolutions(rs2, 2, 0, seed, rs2.localOf[rs2.flatOf[path[0]]], false, path);
  metrics.solutionCount = est.count;

  // 规模归一区间：自定义生成器的尺寸是用户给的，不是世界阶梯。
  const ctx: DiffContext = {
    mechTerm: Math.min(1, (plan.oneway + plan.shard + plan.keygate + plan.portal * 2 + plan.ice) / 10),
    baitTerm: Math.min(1, metrics.maxBaitDepth / 6),
    sizeFloor: params.w.min * params.h.min,
    sizeCeil: params.w.max * params.h.max,
    worldTerm: 0,
  };
  const diff = computeDiff(metrics, ctx);

  return {
    idx,
    seed,
    w,
    h,
    grid,
    required: cells.length,
    solution: path.map((i) => rs2.flatOf[i]),
    startAt: startAt >= 0 ? rs2.flatOf[startAt] : -1,
    endAt: endAt >= 0 ? rs2.flatOf[endAt] : -1,
    diff,
    metrics,
    mechKinds: metrics.mechKinds,
    fingerprint: fingerprintOf(grid, w, h),
    genMs: Date.now() - t0,
  };
}

/**
 * 按指定数量注入机制。
 *
 * 与 `generate.ts` 的 `injectMechanics` **同一套约束**，只是数量来自用户。
 *
 * 铁律（照抄那边的注释，理由完全一样）：
 *   - 机制只能加在已验证存在的解上；
 *   - 一个格只能承载一种机制；
 *   - 冰块必须先放，且整条滑行直线都被占住；
 *   - 钥匙不能落在解的第 0 格（会被 START 标记覆盖）。
 */
function injectCustomMechanics(
  rs: RuleSet,
  path: number[],
  plan: { oneway: number; shard: number; keygate: number; portal: number; ice: number },
  rng: Rng,
  portalCells: ReadonlyArray<readonly [number, number]> = [],
): void {
  const n = rs.n;
  if (n < 10) return;

  // 机制格必须是中间格（deg >= 2）
  const interior: number[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    let deg = 0;
    for (let k = 0; k < 4; k++) if (rs.nbr[path[i] * 4 + k] >= 0) deg++;
    if (deg >= 2) interior.push(path[i]);
  }
  if (interior.length < 4) return;

  const used = new Set<number>();

  /**
   * **传送门格预先占用** —— 理由同 `generate.ts` 的 `injectMechanics`：
   * 传送门格是跳跃边的两端，任何别的机制落上去都会破坏
   * 「走进传送格 → 传送到搭档」的对齐。
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
  const firstCell = path[0];
  const lastCell = path[path.length - 1];
  const claimable = (v: number | undefined): v is number =>
    v !== undefined && !used.has(v) && v !== firstCell && v !== lastCell;

  // --- 冰块（最先放）---
  for (let k = 0; k < plan.ice; k++) {
    const found = findIceSpot(rs, path, rng, used);
    if (!found) break;
    rs.typeOf[found.spot] = CoverCell.ICE;
    for (const c of found.run) used.add(c);
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
    }
  }

  // --- 钥匙门：门在解的位置 i，钥匙在 i 之前 ---
  for (let k = 0; k < plan.keygate; k++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const gatePos = 1 + rng.int(0, Math.max(1, Math.floor(path.length * 0.6)));
      const keyPos = 1 + rng.int(0, Math.max(1, gatePos - 2));
      if (keyPos >= gatePos) continue;
      const gate = path[gatePos];
      const key = path[keyPos];
      if (!claimable(gate) || !claimable(key) || gate === key) continue;
      rs.typeOf[gate] = CoverCell.GATE;
      rs.groupOf[gate] = k % 4;
      rs.typeOf[key] = CoverCell.KEY;
      rs.groupOf[key] = k % 4;
      used.add(gate);
      used.add(key);
      break;
    }
  }

  // --- 传送门：成对格 ---
  //
  // ⚠️ 传送门格**只能来自 `portalCells`**（由 `splicePortals` 预先算好）。
  // 「进入即传送」语义下，走进传送格 A 的一步会一次吃掉 `[A, B]`，
  // 参考解必须**正好**在这一步从 A 跳到 B —— 随便挑两格必然回放失败。
  for (let k = 0; k < plan.portal; k++) {
    const pair = portalCells[k];
    if (!pair) break;
    const [a, b] = pair;
    rs.typeOf[a] = CoverCell.PORTAL;
    rs.groupOf[a] = k % 4;
    rs.typeOf[b] = CoverCell.PORTAL;
    rs.groupOf[b] = k % 4;
    rs.portalOf[a] = b;
    rs.portalOf[b] = a;
  }

  rs.hasIce = rs.typeOf.includes(CoverCell.ICE);
  rs.hasPortal = rs.portalOf.some((v) => v >= 0);
}

// ── 以下三个小工具与 `generate.ts` 同名同义（那边是模块私有的，这里复制一份）──

/** 两个格之间的方向；不相邻返回 -1。 */
function dirBetween(from: number, to: number, w: number): number {
  const dx = (to % w) - (from % w);
  const dy = Math.floor(to / w) - Math.floor(from / w);
  if (dx === 0 && dy === -1) return 0; // UP
  if (dx === 0 && dy === 1) return 1; // DOWN
  if (dx === -1 && dy === 0) return 2; // LEFT
  if (dx === 1 && dy === 0) return 3; // RIGHT
  return -1;
}

/** 星星位置：按解的前 1/4 / 中 / 后 1/4 分散。 */
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

/**
 * 找冰块位置。
 *
 * 约束（与 `generate.ts` 的 `findIceSpot` 完全一致）：
 *   1. 解必须在冰块处**直行**（进入方向 == 离开方向）；
 *   2. 沿进入方向的整条直线必须与解的连续几步完全重合；
 *   3. ICE 不能是解的首/末格。
 */
function findIceSpot(
  rs: RuleSet,
  path: number[],
  rng: Rng,
  used: Set<number>,
): { spot: number; run: number[] } | null {
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
    // **进入方向**（玩家走进冰块后沿这个方向滑行）
    const d = dirBetween(rs.flatOf[path[pos - 1]], rs.flatOf[path[pos]], rs.w);
    if (d < 0) continue;
    if (dirBetween(rs.flatOf[path[pos]], rs.flatOf[path[pos + 1]], rs.w) !== d) continue;

    // 沿 d 的整条直线必须与解的连续几步完全重合
    const run: number[] = [v];
    let idx = pos;
    let cur = rs.flatOf[path[pos]];
    let ok = true;
    while (true) {
      const dx = d === 0 ? 0 : d === 1 ? 0 : d === 2 ? -1 : 1;
      const dy = d === 0 ? -1 : d === 1 ? 1 : 0;
      const nx = (cur % rs.w) + dx;
      const ny = Math.floor(cur / rs.w) + dy;
      if (nx < 0 || nx >= rs.w || ny < 0 || ny >= rs.h) break;
      const after = ny * rs.w + nx;
      const afterLocal = rs.localOf[after];
      if (afterLocal < 0) break;
      idx++;
      if (idx >= path.length || path[idx] !== afterLocal) {
        ok = false;
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
 * 按参数批量生成。
 *
 * @param params 生成参数
 * @param onProgress 进度回调（已完成 / 总数）
 * @returns 生成成功的关卡（失败的关号跳过）
 */
export function generateCustomLevels(
  params: CustomGenParams,
  onProgress?: (done: number, total: number) => void,
): CustomLevel[] {
  const out: CustomLevel[] = [];
  const total = Math.max(1, params.count);
  let idx = 1;

  // 每关最多试 40 次（换种子）—— 形状不可解是常态（小盘 + 少洞）。
  let attempts = 0;
  const maxAttempts = total * 40;

  while (out.length < params.count && attempts < maxAttempts) {
    attempts++;
    // 种子：全局种子 + 关号 + 尝试序号 → 同参数同种子结果完全可复现。
    const seed = (params.seed ^ ((idx * 2654435761) >>> 0) ^ (attempts * 40503)) >>> 0;
    const lv = generateOne(idx, params, seed);
    if (!lv) continue;
    out.push(lv);
    idx++;
    if (onProgress) onProgress(out.length, params.count);
  }
  return out;
}

/** 统计一份生成结果里各机制的实际出现关数（给 UI 显示）。 */
export function mechSummary(levels: CustomLevel[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lv of levels) {
    for (let i = 0; i < lv.grid.length; i++) {
      const t = cellType(lv.grid[i]);
      const key =
        t === CoverCell.ONEWAY ? 'oneway'
        : t === CoverCell.SHARD ? 'shard'
        : t === CoverCell.KEY ? 'key'
        : t === CoverCell.GATE ? 'gate'
        : t === CoverCell.PORTAL ? 'portal'
        : t === CoverCell.ICE ? 'ice'
        : '';
      if (key) out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}
